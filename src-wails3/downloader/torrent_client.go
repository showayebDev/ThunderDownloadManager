package downloader

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// TorrentInfo stores extracted metadata from a magnet link or .torrent file.
type TorrentInfo struct {
	Name        string   `json:"name"`
	InfoHash    string   `json:"info_hash"`
	TotalSize   int64    `json:"total_size"`
	PieceLength int64    `json:"piece_length,omitempty"`
	PieceCount  int      `json:"piece_count,omitempty"`
	FileCount   int      `json:"file_count,omitempty"`
	Files       []string `json:"files,omitempty"`
	IsMagnet    bool     `json:"is_magnet"`
	Trackers    []string `json:"trackers,omitempty"`
	Comment     string   `json:"comment,omitempty"`
	CreatedBy   string   `json:"created_by,omitempty"`
}

var (
	globalTorrentClient *torrent.Client
	torrentClientOnce   sync.Once
	torrentClientMu     sync.Mutex
)

// GetGlobalTorrentClient returns or initializes the singleton BitTorrent client instance.
func GetGlobalTorrentClient() (*torrent.Client, error) {
	torrentClientMu.Lock()
	defer torrentClientMu.Unlock()

	if globalTorrentClient != nil {
		return globalTorrentClient, nil
	}

	var initErr error
	torrentClientOnce.Do(func() {
		cfg := torrent.NewDefaultClientConfig()
		
		// Set cache/data dir
		cacheDir := filepath.Join(os.TempDir(), "ThunderDM_TorrentCache")
		_ = os.MkdirAll(cacheDir, 0755)
		cfg.DataDir = cacheDir

		cfg.NoDHT = false
		cfg.DisableUTP = false
		cfg.ListenPort = 0 // Pick random available port
		cfg.NoUpload = false
		cfg.ExtendedHandshakeClientVersion = "ThunderDM/1.0"
		cfg.HTTPUserAgent = "ThunderDM/1.0"

		client, err := torrent.NewClient(cfg)
		if err != nil {
			initErr = fmt.Errorf("failed to create torrent client: %w", err)
			log.Printf("[TorrentClient] Error initializing client: %v\n", err)
			return
		}

		globalTorrentClient = client
		log.Printf("[TorrentClient] Global BitTorrent client initialized successfully (Port: %d)\n", client.ListenAddrs())
	})

	return globalTorrentClient, initErr
}

// ParseTorrentInfo parses metadata from a magnet URI, local .torrent file path, or remote .torrent URL.
func ParseTorrentInfo(source string) (*TorrentInfo, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return nil, fmt.Errorf("empty torrent source")
	}

	// 1. Handle Magnet URI
	if strings.HasPrefix(strings.ToLower(source), "magnet:") {
		spec, err := torrent.TorrentSpecFromMagnetUri(source)
		if err != nil {
			return nil, fmt.Errorf("invalid magnet link: %w", err)
		}

		name := spec.DisplayName
		if name == "" {
			name = spec.InfoHash.HexString()
		}

		var trackers []string
		for _, tier := range spec.Trackers {
			for _, tr := range tier {
				if tr != "" {
					trackers = append(trackers, tr)
				}
			}
		}

		info := &TorrentInfo{
			Name:     name,
			InfoHash: spec.InfoHash.HexString(),
			IsMagnet: true,
			Trackers: trackers,
		}

		// Also try to query global client if available with a short timeout to see if metadata is already known
		if client, err := GetGlobalTorrentClient(); err == nil && client != nil {
			if t, ok := client.Torrent(spec.InfoHash); ok && t.Info() != nil {
				info.TotalSize = t.Length()
				info.PieceLength = t.Info().PieceLength
				info.PieceCount = t.NumPieces()
				info.FileCount = len(t.Files())
				for _, f := range t.Files() {
					info.Files = append(info.Files, f.DisplayPath())
				}
			}
		}

		return info, nil
	}

	// 2. Handle remote HTTP/HTTPS .torrent file
	if strings.HasPrefix(strings.ToLower(source), "http://") || strings.HasPrefix(strings.ToLower(source), "https://") {
		req, err := http.NewRequest(http.MethodGet, source, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request for torrent file: %w", err)
		}
		req.Header.Set("User-Agent", "ThunderDM/1.0 (BitTorrent Client)")

		resp, err := SharedHTTPClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to download torrent file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("server returned status %d when fetching torrent file", resp.StatusCode)
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 15*1024*1024))
		if err != nil {
			return nil, fmt.Errorf("failed to read torrent data: %w", err)
		}

		return ParseTorrentBytes(bodyBytes)
	}

	// 3. Handle local .torrent file path
	cleanPath := filepath.Clean(source)
	if strings.HasPrefix(cleanPath, "file://") {
		cleanPath = strings.TrimPrefix(cleanPath, "file://")
		if strings.HasPrefix(cleanPath, "/") && len(cleanPath) > 2 && cleanPath[2] == ':' {
			cleanPath = cleanPath[1:] // Clean Windows /C:/... to C:/...
		}
		cleanPath = filepath.Clean(cleanPath)
	}

	if _, err := os.Stat(cleanPath); err == nil {
		mi, err := metainfo.LoadFromFile(cleanPath)
		if err != nil {
			return nil, fmt.Errorf("failed to parse local torrent file: %w", err)
		}

		return parseMetaInfo(mi)
	}

	return nil, fmt.Errorf("unrecognized torrent source: %s", source)
}

// ParseTorrentBytes parses metadata from raw .torrent bytes.
func ParseTorrentBytes(data []byte) (*TorrentInfo, error) {
	mi, err := metainfo.Load(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to decode torrent bencode: %w", err)
	}
	return parseMetaInfo(mi)
}

func parseMetaInfo(mi *metainfo.MetaInfo) (*TorrentInfo, error) {
	info, err := mi.UnmarshalInfo()
	if err != nil {
		return nil, fmt.Errorf("failed to parse torrent info section: %w", err)
	}

	infoHash := mi.HashInfoBytes().HexString()
	name := info.Name
	if name == "" {
		name = infoHash
	}

	totalSize := info.TotalLength()
	var fileList []string
	if len(info.Files) > 0 {
		for _, f := range info.Files {
			fileList = append(fileList, strings.Join(f.Path, "/"))
		}
	} else if totalSize > 0 {
		fileList = append(fileList, name)
	}

	var trackers []string
	for _, tier := range mi.AnnounceList {
		for _, tr := range tier {
			if tr != "" {
				trackers = append(trackers, tr)
			}
		}
	}
	if len(trackers) == 0 && mi.Announce != "" {
		trackers = append(trackers, mi.Announce)
	}

	return &TorrentInfo{
		Name:        name,
		InfoHash:    infoHash,
		TotalSize:   totalSize,
		PieceLength: info.PieceLength,
		PieceCount:  info.NumPieces(),
		FileCount:   len(fileList),
		Files:       fileList,
		IsMagnet:    false,
		Trackers:    trackers,
		Comment:     mi.Comment,
		CreatedBy:   mi.CreatedBy,
	}, nil
}

// DownloadTorrentFileToTemp downloads a remote .torrent URL to a temporary local file.
func DownloadTorrentFileToTemp(remoteURL string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, remoteURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "ThunderDM/1.0 (BitTorrent Client)")

	resp, err := SharedHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP error %d", resp.StatusCode)
	}

	tempDir := filepath.Join(os.TempDir(), "ThunderDM_Torrents")
	_ = os.MkdirAll(tempDir, 0755)

	parsedURL, _ := url.Parse(remoteURL)
	base := "download.torrent"
	if parsedURL != nil && parsedURL.Path != "" {
		b := filepath.Base(parsedURL.Path)
		if strings.HasSuffix(strings.ToLower(b), ".torrent") {
			base = b
		}
	}

	tempFile := filepath.Join(tempDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), base))
	out, err := os.Create(tempFile)
	if err != nil {
		return "", err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		_ = os.Remove(tempFile)
		return "", err
	}

	return tempFile, nil
}
