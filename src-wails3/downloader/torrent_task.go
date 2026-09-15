package downloader

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/storage"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
	torstorage "github.com/anacrolix/torrent/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type TorrentTaskController struct {
	ctx          context.Context
	cancel       context.CancelFunc
	id           string
	url          string
	savePath     string
	filename     string
	totalSize    int64
	downloaded   int64
	speed        float64
	eta          float64
	speedLimit   *int64
	status       DownloadStatus
	errorMessage string
	options      DownloadExtraOptions
	torrent      *torrent.Torrent
	chunks       []ChunkPayload
	mu           sync.RWMutex
}

// NewTorrentTaskController creates a new Torrent download task runner.
func NewTorrentTaskController(
	ctx context.Context,
	id, urlStr, savePath, filename string,
	threadCount int,
	speedLimit *int64,
	options DownloadExtraOptions,
) *TorrentTaskController {
	if ctx == nil {
		ctx = context.Background()
	}
	taskCtx, cancel := context.WithCancel(ctx)

	return &TorrentTaskController{
		ctx:        taskCtx,
		cancel:     cancel,
		id:         id,
		url:        urlStr,
		savePath:   NormalizeSavePath(savePath),
		filename:   SanitizeFilename(filename),
		speedLimit: speedLimit,
		options:    options,
		status:     StatusPending,
		chunks:     make([]ChunkPayload, 0),
	}
}

func (c *TorrentTaskController) Start() {
	c.mu.Lock()
	c.status = StatusDownloading
	c.errorMessage = ""
	c.mu.Unlock()

	client, err := GetGlobalTorrentClient()
	if err != nil {
		c.failTask(fmt.Sprintf("Failed to initialize BitTorrent engine: %v", err))
		return
	}

	saveDir := c.savePath
	_ = os.MkdirAll(saveDir, 0755)

	var t *torrent.Torrent
	var addErr error

	rawSource := CleanTorrentSource(c.options.CleanURL)
	if rawSource == "" {
		rawSource = CleanTorrentSource(c.url)
	}

	if strings.HasPrefix(strings.ToLower(rawSource), "magnet:") {
		spec, err := torrent.TorrentSpecFromMagnetUri(rawSource)
		if err != nil {
			c.failTask(fmt.Sprintf("Invalid magnet URI: %v", err))
			return
		}
		spec.Storage = torstorage.NewFile(saveDir)
		spec.Trackers = append(spec.Trackers, DefaultPublicTrackers...)
		t, _, addErr = client.AddTorrentSpec(spec)
	} else if strings.HasPrefix(strings.ToLower(rawSource), "http://") || strings.HasPrefix(strings.ToLower(rawSource), "https://") {
		// Download remote .torrent to temporary file first
		tempPath, err := DownloadTorrentFileToTemp(rawSource)
		if err != nil {
			c.failTask(fmt.Sprintf("Failed to fetch .torrent file: %v", err))
			return
		}
		mi, err := metainfo.LoadFromFile(tempPath)
		if err != nil {
			c.failTask(fmt.Sprintf("Failed to parse .torrent metadata: %v", err))
			return
		}
		spec := torrent.TorrentSpecFromMetaInfo(mi)
		spec.Storage = torstorage.NewFile(saveDir)
		spec.Trackers = append(spec.Trackers, DefaultPublicTrackers...)
		t, _, addErr = client.AddTorrentSpec(spec)
	} else {
		// Local .torrent file
		cleanPath := rawSource
		mi, err := metainfo.LoadFromFile(cleanPath)
		if err != nil {
			c.failTask(fmt.Sprintf("Failed to read torrent file: %v", err))
			return
		}
		spec := torrent.TorrentSpecFromMetaInfo(mi)
		spec.Storage = torstorage.NewFile(saveDir)
		spec.Trackers = append(spec.Trackers, DefaultPublicTrackers...)
		t, _, addErr = client.AddTorrentSpec(spec)
	}

	if addErr != nil || t == nil {
		c.failTask(fmt.Sprintf("Failed to add torrent to download client: %v", addErr))
		return
	}

	// Tell client to start peer search and piece download if metadata is already available
	t.AddTrackers(DefaultPublicTrackers)
	if t.Info() != nil {
		t.DownloadAll()
	}

	c.mu.Lock()
	c.torrent = t
	c.mu.Unlock()

	// Launch background goroutine to handle metadata completion when ready
	gotInfoCh := t.GotInfo()
	go func() {
		select {
		case <-c.ctx.Done():
			return
		case <-gotInfoCh:
			info := t.Info()
			if info != nil {
				c.mu.Lock()
				if c.filename == "" || c.filename == "download" || strings.HasSuffix(c.filename, ".torrent") || strings.HasPrefix(c.filename, "Torrent_") {
					if t.Name() != "" {
						c.filename = SanitizeFilename(t.Name())
					}
				}
				c.totalSize = t.Length()
				c.mu.Unlock()

				_ = storage.UpdateDownloadMetadata(c.id, c.filename, c.totalSize)
				t.DownloadAll()
				c.emitProgress()
				log.Printf("[TorrentTask] Metadata resolved for %s: %s (Total: %d bytes, Pieces: %d)\n", c.id, c.filename, c.totalSize, t.NumPieces())
			}
		}
	}()

	log.Printf("[TorrentTask] Started downloading torrent %s (%s)\n", c.id, c.filename)

	// Emit initial progress
	c.emitProgress()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var lastBytes int64 = 0
	if t.Info() != nil {
		lastBytes = t.BytesCompleted()
	}
	var lastTime = time.Now()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			c.mu.RLock()
			currentStatus := c.status
			c.mu.RUnlock()

			if currentStatus != StatusDownloading {
				return
			}

			now := time.Now()
			elapsed := now.Sub(lastTime).Seconds()
			if elapsed <= 0 {
				elapsed = 1.0
			}

			var curBytes int64 = 0
			var total int64 = 0
			var calcSpeed float64 = 0
			var calcETA float64 = 0
			var chunkPayloads []ChunkPayload

			if t.Info() != nil {
				curBytes = t.BytesCompleted()
				delta := curBytes - lastBytes
				if delta < 0 {
					delta = 0
				}

				calcSpeed = float64(delta) / elapsed
				lastBytes = curBytes
				lastTime = now

				total = t.Length()
				if calcSpeed > 0 && total > curBytes {
					calcETA = float64(total-curBytes) / calcSpeed
					if calcETA > 864000 {
						calcETA = 864000
					}
				}

				// Generate chunk segments from pieces for UI visualizer
				numPieces := t.NumPieces()
				if numPieces > 0 {
					numChunks := 16
					if numPieces < numChunks {
						numChunks = int(math.Max(1, float64(numPieces)))
					}
					chunkPayloads = make([]ChunkPayload, numChunks)
					piecesPerChunk := float64(numPieces) / float64(numChunks)
					for i := 0; i < numChunks; i++ {
						startP := int(float64(i) * piecesPerChunk)
						endP := int(float64(i+1) * piecesPerChunk)
						if endP > numPieces {
							endP = numPieces
						}
						completedInChunk := 0
						totalInChunk := endP - startP
						for p := startP; p < endP; p++ {
							if t.Piece(p).State().Complete {
								completedInChunk++
							}
						}

						var chunkStatus DownloadStatus = StatusPending
						if completedInChunk == totalInChunk && totalInChunk > 0 {
							chunkStatus = StatusFinished
						} else if completedInChunk > 0 {
							chunkStatus = StatusDownloading
						}

						chunkPayloads[i] = ChunkPayload{
							ID:         i + 1,
							Status:     chunkStatus,
							Downloaded: int64(completedInChunk),
							Total:      int64(totalInChunk),
						}
					}
				}
			} else {
				// While fetching metadata, show 8 connecting pseudo-chunks reflecting peer connectivity
				lastTime = now
				numChunks := 8
				chunkPayloads = make([]ChunkPayload, numChunks)
				activePeers := len(t.PeerConns())
				for i := 0; i < numChunks; i++ {
					var st DownloadStatus = StatusPending
					if i < activePeers {
						st = StatusDownloading
					}
					chunkPayloads[i] = ChunkPayload{
						ID:         i + 1,
						Status:     st,
						Downloaded: 0,
						Total:      100,
					}
				}
			}

			c.mu.Lock()
			c.downloaded = curBytes
			if total > 0 {
				c.totalSize = total
			}
			c.speed = calcSpeed
			c.eta = calcETA
			c.chunks = chunkPayloads
			c.mu.Unlock()

			c.emitProgress()

			// Check completion
			if total > 0 && curBytes >= total {
				c.completeTask()
				return
			}
		}
	}
}

func (c *TorrentTaskController) completeTask() {
	c.mu.Lock()
	c.status = StatusFinished
	c.speed = 0
	c.eta = 0
	c.downloaded = c.totalSize
	c.mu.Unlock()

	log.Printf("[TorrentTask] Completed torrent download: %s (%s, %d bytes)\n", c.id, c.filename, c.totalSize)

	_ = storage.UpdateDownloadProgress(c.id, c.totalSize, c.totalSize, string(StatusFinished), "", nil)

	c.emitProgress()

	payload := map[string]interface{}{
		"id":         c.id,
		"taskId":     c.id,
		"task_id":    c.id,
		"filename":   c.filename,
		"savePath":   c.savePath,
		"save_path":  c.savePath,
		"totalSize":  c.totalSize,
		"total_size": c.totalSize,
		"downloaded": c.totalSize,
	}

	if OnDownloadCompleted != nil {
		OnDownloadCompleted(payload)
	}

	if app := application.Get(); app != nil {
		app.Event.Emit("download-completed", payload)
		app.Event.Emit("download-completed-"+c.id, payload)
	}
}

func (c *TorrentTaskController) failTask(msg string) {
	c.mu.Lock()
	c.status = StatusError
	c.errorMessage = msg
	c.speed = 0
	c.mu.Unlock()

	log.Printf("[TorrentTask] Error on task %s: %s\n", c.id, msg)
	_ = storage.UpdateDownloadProgress(c.id, c.downloaded, c.totalSize, string(StatusError), msg, nil)
	c.emitProgress()
}

func (c *TorrentTaskController) emitProgress() {
	c.mu.RLock()
	st := c.status
	dl := c.downloaded
	tot := c.totalSize
	spd := c.speed
	etaVal := c.eta
	fn := c.filename
	id := c.id
	urlStr := c.url
	saveP := c.savePath
	errM := c.errorMessage
	chnks := c.chunks
	c.mu.RUnlock()

	if OnProgressUpdate != nil {
		OnProgressUpdate(id, fn, dl, tot)
	}

	payload := ProgressPayload{
		ID:              id,
		TaskID:          id,
		URL:             urlStr,
		Filename:        fn,
		SavePath:        saveP,
		Status:          st,
		DownloadedBytes: dl,
		Downloaded:      dl,
		TotalBytes:      tot,
		TotalSize:       tot,
		Speed:           spd,
		ETA:             etaVal,
		Protocol:        "Torrent",
		Resumable:       true,
		ResumeSupport:   "Yes",
		ErrorMessage:    errM,
		Chunks:          chnks,
	}

	if app := application.Get(); app != nil {
		app.Event.Emit("download-progress", payload)
		app.Event.Emit("download-progress-"+id, payload)
	}
}

func (c *TorrentTaskController) Pause() error {
	c.mu.Lock()
	if c.status == StatusFinished {
		c.mu.Unlock()
		return nil
	}
	c.status = StatusPaused
	c.speed = 0
	c.eta = 0
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()

	_ = storage.UpdateDownloadProgress(c.id, c.downloaded, c.totalSize, string(StatusPaused), "", nil)
	c.emitProgress()
	return nil
}

func (c *TorrentTaskController) Cancel() error {
	c.mu.Lock()
	c.status = StatusCanceled
	c.speed = 0
	c.eta = 0
	if c.cancel != nil {
		c.cancel()
	}
	if c.torrent != nil {
		c.torrent.Drop()
	}
	c.mu.Unlock()

	_ = storage.UpdateDownloadProgress(c.id, c.downloaded, c.totalSize, string(StatusCanceled), "", nil)
	c.emitProgress()
	return nil
}

func (c *TorrentTaskController) UpdateThreadCount(threads int) {
	// Torrent engine handles peer concurrency automatically
}

func (c *TorrentTaskController) UpdateSpeedLimit(speedLimit *int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.speedLimit = speedLimit
}

func (c *TorrentTaskController) GetState() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return map[string]interface{}{
		"id":             c.id,
		"url":            c.url,
		"filename":       c.filename,
		"save_path":      c.savePath,
		"savePath":       c.savePath,
		"dest_file_path": filepath.Join(c.savePath, c.filename),
		"status":         c.status,
		"downloaded":     c.downloaded,
		"total_size":     c.totalSize,
		"speed":          c.speed,
		"eta":            c.eta,
		"protocol":       "Torrent",
		"resumable":      true,
		"error_message":  c.errorMessage,
		"chunks":         c.chunks,
	}
}
