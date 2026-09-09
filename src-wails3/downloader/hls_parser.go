package downloader

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

// HLSStreamVariant represents a video stream variation in a master playlist.
type HLSStreamVariant struct {
	Bandwidth  int64
	Resolution string
	Codecs     string
	URL        string
}

// HLSSegment represents a single playable audio/video chunk in an HLS playlist.
type HLSSegment struct {
	Index       int
	SequenceNum uint64
	URL         string
	Duration    float64
	KeyURI      string
	IVHex       string
	IsInit      bool // True if this is an EXT-X-MAP initialization fragment
}

// HLSPlaylist contains parsed playlist information.
type HLSPlaylist struct {
	IsMaster       bool
	Variants       []HLSStreamVariant
	Segments       []HLSSegment
	TotalDuration  float64
	TargetDuration float64
	MediaSequence  uint64
	ResolvedURL    string // Final URL of the selected media playlist
}

// HLSKeyCache caches fetched AES encryption keys in memory to prevent duplicate HTTP calls.
type HLSKeyCache struct {
	keys sync.Map // map[string][]byte
}

var globalKeyCache = &HLSKeyCache{}

func (k *HLSKeyCache) GetOrFetchKey(ctx context.Context, client *http.Client, keyURL string) ([]byte, error) {
	if val, ok := k.keys.Load(keyURL); ok {
		return val.([]byte), nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, keyURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch encryption key (HTTP %d)", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if len(data) != 16 {
		return nil, fmt.Errorf("invalid key length %d (expected 16 bytes for AES-128)", len(data))
	}

	k.keys.Store(keyURL, data)
	return data, nil
}

// IsHLSURL checks if the provided URL looks like an HLS manifest.
func IsHLSURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	lowerPath := strings.ToLower(parsed.Path)
	return strings.HasSuffix(lowerPath, ".m3u8") || strings.Contains(lowerPath, ".m3u8")
}

// ResolveRelativeURL converts a relative segment or playlist URL to an absolute URL based on the parent playlist URL.
func ResolveRelativeURL(baseURLStr, refURLStr string) string {
	refURLStr = strings.TrimSpace(refURLStr)
	if strings.HasPrefix(refURLStr, "http://") || strings.HasPrefix(refURLStr, "https://") {
		return refURLStr
	}

	baseURL, err := url.Parse(baseURLStr)
	if err != nil {
		return refURLStr
	}

	refURL, err := url.Parse(refURLStr)
	if err != nil {
		return refURLStr
	}

	return baseURL.ResolveReference(refURL).String()
}

// FetchAndParseHLS fetches an HLS playlist from the network and recursively resolves master playlists.
func FetchAndParseHLS(ctx context.Context, client *http.Client, rawURL string, opts ...string) (*HLSPlaylist, error) {
	if client == nil {
		client = SharedHTTPClient
	}

	var authUser, authPass, userAgent, referer, cookies string
	if len(opts) > 0 {
		authUser = opts[0]
	}
	if len(opts) > 1 {
		authPass = opts[1]
	}
	if len(opts) > 2 {
		userAgent = opts[2]
	}
	if len(opts) > 3 {
		referer = opts[3]
	}
	if len(opts) > 4 {
		cookies = opts[4]
	}

	if parsed, err := url.Parse(rawURL); err == nil && parsed.User != nil {
		if u := parsed.User.Username(); u != "" && authUser == "" {
			authUser = u
		}
		if p, ok := parsed.User.Password(); ok && authPass == "" {
			authPass = p
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}

	if authUser != "" || authPass != "" {
		req.SetBasicAuth(authUser, authPass)
	}
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	} else {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	if cookies != "" {
		req.Header.Set("Cookie", cookies)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch HLS playlist: HTTP %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	finalURL := resp.Request.URL.String()
	if finalURL == "" {
		finalURL = rawURL
	}

	return ParseHLSContent(ctx, client, string(content), finalURL)
}

// ParseHLSContent parses an M3U8 string and resolves master playlists if encountered.
func ParseHLSContent(ctx context.Context, client *http.Client, body, baseURL string) (*HLSPlaylist, error) {
	lines := strings.Split(body, "\n")
	if len(lines) == 0 || !strings.HasPrefix(strings.TrimSpace(lines[0]), "#EXTM3U") {
		return nil, fmt.Errorf("invalid HLS playlist: missing #EXTM3U header")
	}

	// Check if this is a Master Playlist
	isMaster := false
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF") {
			isMaster = true
			break
		}
	}

	if isMaster {
		masterInfo, err := parseMasterPlaylist(lines, baseURL)
		if err != nil {
			return nil, err
		}

		if len(masterInfo.Variants) == 0 {
			return nil, fmt.Errorf("master playlist contained no playable stream variants")
		}

		// Select the highest bandwidth variant stream
		bestVariant := masterInfo.Variants[0]
		for _, v := range masterInfo.Variants {
			if v.Bandwidth > bestVariant.Bandwidth {
				bestVariant = v
			}
		}

		// Recursively fetch media playlist of the selected stream
		mediaPlaylist, err := FetchAndParseHLS(ctx, client, bestVariant.URL)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch media playlist from master: %w", err)
		}
		mediaPlaylist.Variants = masterInfo.Variants
		return mediaPlaylist, nil
	}

	// Parse as Media Playlist
	return parseMediaPlaylist(lines, baseURL)
}

func parseMasterPlaylist(lines []string, baseURL string) (*HLSPlaylist, error) {
	playlist := &HLSPlaylist{
		IsMaster:    true,
		Variants:    make([]HLSStreamVariant, 0),
		ResolvedURL: baseURL,
	}

	var currentVariant *HLSStreamVariant

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			tags := parseAttributeList(strings.TrimPrefix(line, "#EXT-X-STREAM-INF:"))
			variant := HLSStreamVariant{}
			if bw, ok := tags["BANDWIDTH"]; ok {
				variant.Bandwidth, _ = strconv.ParseInt(bw, 10, 64)
			}
			if res, ok := tags["RESOLUTION"]; ok {
				variant.Resolution = res
			}
			if cod, ok := tags["CODECS"]; ok {
				variant.Codecs = cod
			}
			currentVariant = &variant
		} else if !strings.HasPrefix(line, "#") && currentVariant != nil {
			currentVariant.URL = ResolveRelativeURL(baseURL, line)
			playlist.Variants = append(playlist.Variants, *currentVariant)
			currentVariant = nil
		}
	}

	return playlist, nil
}

func parseMediaPlaylist(lines []string, baseURL string) (*HLSPlaylist, error) {
	playlist := &HLSPlaylist{
		IsMaster:    false,
		Segments:    make([]HLSSegment, 0),
		ResolvedURL: baseURL,
	}

	var curKeyURI string
	var curIVHex string
	var curDuration float64
	var mediaSeq uint64 = 0
	var segIndex int = 0

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:") {
			val := strings.TrimPrefix(line, "#EXT-X-MEDIA-SEQUENCE:")
			mediaSeq, _ = strconv.ParseUint(strings.TrimSpace(val), 10, 64)
			playlist.MediaSequence = mediaSeq
		} else if strings.HasPrefix(line, "#EXT-X-TARGETDURATION:") {
			val := strings.TrimPrefix(line, "#EXT-X-TARGETDURATION:")
			playlist.TargetDuration, _ = strconv.ParseFloat(strings.TrimSpace(val), 64)
		} else if strings.HasPrefix(line, "#EXT-X-KEY:") {
			attrs := parseAttributeList(strings.TrimPrefix(line, "#EXT-X-KEY:"))
			method := strings.ToUpper(attrs["METHOD"])
			if method == "NONE" || method == "" {
				curKeyURI = ""
				curIVHex = ""
			} else if method == "AES-128" {
				if uri, ok := attrs["URI"]; ok {
					curKeyURI = ResolveRelativeURL(baseURL, uri)
				}
				curIVHex = attrs["IV"]
			}
		} else if strings.HasPrefix(line, "#EXT-X-MAP:") {
			attrs := parseAttributeList(strings.TrimPrefix(line, "#EXT-X-MAP:"))
			if uri, ok := attrs["URI"]; ok {
				initSeg := HLSSegment{
					Index:       segIndex,
					SequenceNum: mediaSeq + uint64(segIndex),
					URL:         ResolveRelativeURL(baseURL, uri),
					Duration:    0,
					KeyURI:      curKeyURI,
					IVHex:       curIVHex,
					IsInit:      true,
				}
				segIndex++
				playlist.Segments = append(playlist.Segments, initSeg)
			}
		} else if strings.HasPrefix(line, "#EXTINF:") {
			inf := strings.TrimPrefix(line, "#EXTINF:")
			parts := strings.Split(inf, ",")
			dur, _ := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			curDuration = dur
		} else if !strings.HasPrefix(line, "#") {
			segURL := ResolveRelativeURL(baseURL, line)
			seg := HLSSegment{
				Index:       segIndex,
				SequenceNum: mediaSeq + uint64(segIndex),
				URL:         segURL,
				Duration:    curDuration,
				KeyURI:      curKeyURI,
				IVHex:       curIVHex,
				IsInit:      false,
			}
			playlist.TotalDuration += curDuration
			playlist.Segments = append(playlist.Segments, seg)
			segIndex++
			curDuration = 0
		}
	}

	return playlist, nil
}

// parseAttributeList parses key=value or key="value" from HLS tag attributes.
func parseAttributeList(attrStr string) map[string]string {
	result := make(map[string]string)
	var key, val bytes.Buffer
	inKey := true
	inQuote := false

	r := bufio.NewReader(strings.NewReader(attrStr))
	for {
		c, _, err := r.ReadRune()
		if err != nil {
			break
		}

		if inQuote {
			if c == '"' {
				inQuote = false
			} else {
				val.WriteRune(c)
			}
			continue
		}

		if c == '"' {
			inQuote = true
			continue
		}

		if inKey {
			if c == '=' {
				inKey = false
			} else if c != ' ' && c != '\t' {
				key.WriteRune(c)
			}
		} else {
			if c == ',' {
				if key.Len() > 0 {
					result[strings.ToUpper(strings.TrimSpace(key.String()))] = strings.TrimSpace(val.String())
					key.Reset()
					val.Reset()
				}
				inKey = true
			} else {
				val.WriteRune(c)
			}
		}
	}

	if key.Len() > 0 {
		result[strings.ToUpper(strings.TrimSpace(key.String()))] = strings.TrimSpace(val.String())
	}

	return result
}

// ParseIV generates the 16-byte AES-128 IV from an IV hex string or the segment sequence number.
func ParseIV(ivHex string, sequenceNum uint64) []byte {
	ivHex = strings.TrimSpace(ivHex)
	if strings.HasPrefix(ivHex, "0x") || strings.HasPrefix(ivHex, "0X") {
		ivHex = ivHex[2:]
	}

	if len(ivHex) > 0 {
		// Pad to 32 hex chars (16 bytes) if necessary
		if len(ivHex) < 32 {
			ivHex = strings.Repeat("0", 32-len(ivHex)) + ivHex
		}
		if ivBytes, err := hex.DecodeString(ivHex); err == nil && len(ivBytes) == 16 {
			return ivBytes
		}
	}

	// Default RFC 8216: Sequence number as 16-byte big-endian integer
	iv := make([]byte, 16)
	binary.BigEndian.PutUint64(iv[8:], sequenceNum)
	return iv
}

// DecryptAES128Segment decrypts AES-128-CBC encrypted data using the given key and IV with PKCS7 unpadding.
func DecryptAES128Segment(ciphertext, key, iv []byte) ([]byte, error) {
	if len(key) != 16 {
		return nil, fmt.Errorf("invalid AES key length %d (expected 16)", len(key))
	}
	if len(iv) != 16 {
		return nil, fmt.Errorf("invalid IV length %d (expected 16)", len(iv))
	}
	if len(ciphertext) == 0 {
		return ciphertext, nil
	}
	if len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("encrypted segment size (%d) is not a multiple of AES block size (%d)", len(ciphertext), aes.BlockSize)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	plaintext := make([]byte, len(ciphertext))
	mode.CryptBlocks(plaintext, ciphertext)

	// Strip PKCS7 padding if present
	if len(plaintext) > 0 {
		padLen := int(plaintext[len(plaintext)-1])
		if padLen > 0 && padLen <= aes.BlockSize && padLen <= len(plaintext) {
			validPad := true
			for i := len(plaintext) - padLen; i < len(plaintext); i++ {
				if plaintext[i] != byte(padLen) {
					validPad = false
					break
				}
			}
			if validPad {
				plaintext = plaintext[:len(plaintext)-padLen]
			}
		}
	}

	return plaintext, nil
}
