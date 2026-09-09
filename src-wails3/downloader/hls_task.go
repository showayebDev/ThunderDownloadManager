package downloader

import (
	"context"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type HLSSegmentState struct {
	Segment         HLSSegment
	Status          DownloadStatus
	DownloadedBytes int64
	TempPath        string
	mu              sync.Mutex
}

func (s *HLSSegmentState) GetStatus() DownloadStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Status
}

func (s *HLSSegmentState) SetStatus(status DownloadStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
}

func (s *HLSSegmentState) GetDownloadedBytes() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.DownloadedBytes
}

func (s *HLSSegmentState) SetDownloadedBytes(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.DownloadedBytes = n
}

type HLSTaskController struct {
	wailsCtx    context.Context
	ctx         context.Context
	cancel      context.CancelFunc
	State       *TaskState
	limiter     *SpeedLimiter
	playlist    *HLSPlaylist
	workers     sync.WaitGroup
	chunkSignal chan struct{}
	speedEMA    float64

	segMu        sync.Mutex
	segStates    []*HLSSegmentState
	activeCount  int
	totalBytesDl atomic.Int64
}

func NewHLSTaskController(wailsCtx context.Context, id, rawURL, savePath, filename string, threadCount int, opts ...interface{}) *HLSTaskController {
	savePath = NormalizeSavePath(savePath)
	ctx, cancel := context.WithCancel(context.Background())

	// Normalize filename to video extension if .m3u8 is passed
	lowerFilename := strings.ToLower(filename)
	if strings.HasSuffix(lowerFilename, ".m3u8") {
		filename = strings.TrimSuffix(filename, filepath.Ext(filename)) + ".mp4"
	}
	if filename == "" {
		filename = "video.mp4"
	}

	var spLimit *int64
	var limitBytes int64 = 0
	var authUser, authPass, userAgent, referer, cookies string
	showCompletion := true

	for _, opt := range opts {
		if opt == nil {
			continue
		}
		switch v := opt.(type) {
		case *int64:
			spLimit = v
			if v != nil && *v > 0 {
				limitBytes = *v
			}
		case DownloadExtraOptions:
			if v.ShowCompletion != nil {
				showCompletion = *v.ShowCompletion
			}
			if v.Username != "" {
				authUser = v.Username
			}
			if v.Password != "" {
				authPass = v.Password
			}
			if v.UserAgent != "" {
				userAgent = v.UserAgent
			}
			if v.Referer != "" {
				referer = v.Referer
			}
			if v.Cookies != "" {
				cookies = v.Cookies
			}
		}
	}

	// Auto-lookup vault credentials from download_engine.json if not explicitly provided
	vItem := MatchVaultItem(rawURL)
	if vItem != nil {
		if authUser == "" && authPass == "" {
			if vItem.User != "" || vItem.Pass != "" {
				authUser = vItem.User
				authPass = vItem.Pass
			}
		}
		if userAgent == "" && vItem.UserAgent != "" {
			userAgent = vItem.UserAgent
		}
		if threadCount <= 0 && vItem.ThreadCount > 0 {
			threadCount = vItem.ThreadCount
		}
		if spLimit == nil && vItem.SpeedLimit > 0 {
			sl := vItem.SpeedLimit
			spLimit = &sl
			limitBytes = sl
		}
	}

	engineCfg := GetEngineConfig()
	if userAgent == "" && engineCfg.UserAgent != "" {
		userAgent = engineCfg.UserAgent
	}
	if threadCount <= 0 {
		threadCount = engineCfg.DefaultThreadCount
		if threadCount <= 0 {
			threadCount = 8
		}
	}

	cacheDir := filepath.Join(savePath, fmt.Sprintf(".thunderdm_hls_%s", id))

	taskLimiter := NewSpeedLimiter(limitBytes)
	if spLimit != nil {
		taskLimiter.SetExplicitLimit(limitBytes)
	} else {
		taskLimiter.SetDefaultLimit(0)
	}

	return &HLSTaskController{
		wailsCtx:    wailsCtx,
		ctx:         ctx,
		cancel:      cancel,
		limiter:     taskLimiter,
		chunkSignal: make(chan struct{}, 50),
		State: &TaskState{
			ID:           id,
			URL:          rawURL,
			SavePath:     savePath,
			Filename:     filename,
			DestFilePath: filepath.Join(savePath, filename),
			CacheDir:     cacheDir,
			ThreadCount:  threadCount,
			SpeedLimit:   spLimit,
			AuthUsername: authUser,
			AuthPassword: authPass,
			UserAgent:    userAgent,
			Referer:      referer,
			Cookies:      cookies,
			Status:       StatusPending,
			IsHLS:        true,
			Protocol:     "HLS",
			ShowCompletion: showCompletion,
			Chunks:       make([]*ChunkState, 0),
		},
	}
}

func (tc *HLSTaskController) Start() {
	err := tc.preCheck()
	if err != nil {
		log.Printf("[HLSTaskController] preCheck failed: %v", err)
		tc.changeStatusWithError(StatusError, err)
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	tc.changeStatus(StatusDownloading)
	go tc.orchestratorLoop()
	go tc.progressEmitter()
}

func (tc *HLSTaskController) preCheck() error {
	tc.State.SavePath = NormalizeSavePath(tc.State.SavePath)
	if err := os.MkdirAll(tc.State.SavePath, 0755); err != nil {
		return fmt.Errorf("failed to create save path directory: %w", err)
	}

	if err := os.MkdirAll(tc.State.CacheDir, 0755); err != nil {
		return fmt.Errorf("failed to create HLS segment cache directory: %w", err)
	}

	// Fetch & Parse M3U8 Playlist
	ctxProbe, cancelProbe := context.WithTimeout(tc.ctx, 25*time.Second)
	defer cancelProbe()

	playlist, err := FetchAndParseHLS(ctxProbe, SharedHTTPClient, tc.State.URL, tc.State.AuthUsername, tc.State.AuthPassword, tc.State.UserAgent, tc.State.Referer, tc.State.Cookies)
	if err != nil {
		return fmt.Errorf("failed to parse HLS manifest: %w", err)
	}

	if len(playlist.Segments) == 0 {
		return fmt.Errorf("no playable media segments found in HLS playlist")
	}

	tc.playlist = playlist

	tc.State.mu.Lock()
	tc.State.TotalSegments = len(playlist.Segments)
	tc.State.Duration = playlist.TotalDuration
	tc.State.mu.Unlock()

	tc.segMu.Lock()
	tc.segStates = make([]*HLSSegmentState, len(playlist.Segments))
	var existingBytes int64 = 0

	// Clean up any stale partial .tmp files left behind by sudden crash/termination
	if entries, err := os.ReadDir(tc.State.CacheDir); err == nil {
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".tmp") {
				_ = os.Remove(filepath.Join(tc.State.CacheDir, entry.Name()))
			}
		}
	}

	for i, seg := range playlist.Segments {
		segFilename := fmt.Sprintf("seg_%06d.part", seg.Index)
		segPath := filepath.Join(tc.State.CacheDir, segFilename)

		status := StatusPending
		var dlBytes int64 = 0

		// Check if segment was already completely downloaded and decrypted
		if fi, err := os.Stat(segPath); err == nil && fi.Size() > 0 {
			status = StatusFinished
			dlBytes = fi.Size()
			existingBytes += dlBytes
		}

		tc.segStates[i] = &HLSSegmentState{
			Segment:         seg,
			Status:          status,
			DownloadedBytes: dlBytes,
			TempPath:        segPath,
		}
	}
	tc.segMu.Unlock()

	tc.totalBytesDl.Store(existingBytes)
	return nil
}

func (tc *HLSTaskController) orchestratorLoop() {
	tc.triggerWorkerCheck()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-tc.chunkSignal:
			tc.segMu.Lock()
			tc.State.mu.RLock()
			maxWorkers := tc.State.ThreadCount
			tc.State.mu.RUnlock()

			allFinished := true
			pendingSegs := make([]*HLSSegmentState, 0)
			errorSegs := make([]*HLSSegmentState, 0)

			for _, ss := range tc.segStates {
				st := ss.GetStatus()
				if st == StatusDownloading {
					allFinished = false
				} else if st == StatusError {
					allFinished = false
					errorSegs = append(errorSegs, ss)
				} else if st == StatusPending {
					allFinished = false
					pendingSegs = append(pendingSegs, ss)
				}
			}

			if allFinished {
				tc.segMu.Unlock()
				tc.finalizeDownload()
				return
			}

			if tc.activeCount == 0 && len(pendingSegs) == 0 && !allFinished {
				tc.segMu.Unlock()
				tc.changeStatusWithError(StatusError, fmt.Errorf("HLS download failed: segment error"))
				tc.emitCurrentProgress()
				if application.Get() != nil {
					application.Get().Event.Emit("download-error", map[string]interface{}{
						"task_id": tc.State.ID,
						"id":      tc.State.ID,
						"error":   "HLS download failed: segment error",
					})
				}
				tc.cancel()
				return
			}

			// Launch workers up to maxWorkers limit
			for _, ss := range pendingSegs {
				if tc.activeCount >= maxWorkers {
					break
				}
				ss.SetStatus(StatusDownloading)
				tc.activeCount++
				tc.workers.Add(1)

				go func(segState *HLSSegmentState) {
					defer func() {
						tc.workers.Done()
						tc.segMu.Lock()
						tc.activeCount--
						tc.segMu.Unlock()
						tc.triggerWorkerCheck()
					}()
					tc.downloadSegment(segState)
				}(ss)
			}
			tc.segMu.Unlock()
		}
	}
}

func (tc *HLSTaskController) downloadSegment(segState *HLSSegmentState) {
	seg := segState.Segment
	client := SharedHTTPClient

	cfg := GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}
	for attempt := 0; attempt < maxRetries; attempt++ {
		select {
		case <-tc.ctx.Done():
			return
		default:
		}

		if attempt > 0 {
			backoff := time.Duration(1<<attempt)*150*time.Millisecond + time.Duration(rand.Intn(100))*time.Millisecond
			select {
			case <-tc.ctx.Done():
				return
			case <-time.After(backoff):
			}
		}

		req, err := http.NewRequestWithContext(tc.ctx, http.MethodGet, seg.URL, nil)
		if err != nil {
			segState.SetStatus(StatusError)
			return
		}

		if tc.State.AuthUsername != "" || tc.State.AuthPassword != "" {
			req.SetBasicAuth(tc.State.AuthUsername, tc.State.AuthPassword)
		}
		if tc.State.UserAgent != "" {
			req.Header.Set("User-Agent", tc.State.UserAgent)
		} else {
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		}
		if tc.State.Referer != "" {
			req.Header.Set("Referer", tc.State.Referer)
		}
		if tc.State.Cookies != "" {
			req.Header.Set("Cookie", tc.State.Cookies)
		}

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
				continue
			}
			segState.SetStatus(StatusError)
			return
		}

		data, err := io.ReadAll(LimitReader(tc.ctx, resp.Body, tc.limiter))
		resp.Body.Close()
		if err != nil {
			continue
		}

		// Check if AES-128 decryption is required
		if seg.KeyURI != "" {
			key, err := globalKeyCache.GetOrFetchKey(tc.ctx, client, seg.KeyURI)
			if err != nil {
				log.Printf("[HLSTaskController] Failed to fetch encryption key: %v", err)
				segState.SetStatus(StatusError)
				return
			}
			iv := ParseIV(seg.IVHex, seg.SequenceNum)
			decrypted, err := DecryptAES128Segment(data, key, iv)
			if err != nil {
				log.Printf("[HLSTaskController] Failed to decrypt segment %d: %v", seg.Index, err)
				segState.SetStatus(StatusError)
				return
			}
			data = decrypted
		}

		// Write to temporary segment file first to ensure atomic write
		tmpPath := segState.TempPath + ".tmp"
		err = os.WriteFile(tmpPath, data, 0644)
		if err != nil {
			log.Printf("[HLSTaskController] Failed to write segment file: %v", err)
			segState.SetStatus(StatusError)
			return
		}

		_ = os.Remove(segState.TempPath)
		if err := os.Rename(tmpPath, segState.TempPath); err != nil {
			log.Printf("[HLSTaskController] Failed to rename segment temp file: %v", err)
			segState.SetStatus(StatusError)
			return
		}

		segState.SetDownloadedBytes(int64(len(data)))
		tc.totalBytesDl.Add(int64(len(data)))
		segState.SetStatus(StatusFinished)
		return
	}

	segState.SetStatus(StatusError)
}

func (tc *HLSTaskController) triggerWorkerCheck() {
	select {
	case tc.chunkSignal <- struct{}{}:
	default:
	}
}

func (tc *HLSTaskController) finalizeDownload() {
	tc.workers.Wait()

	tc.segMu.Lock()
	// Strict verification: ensure every single segment has finished and exists on disk
	for _, ss := range tc.segStates {
		if ss.GetStatus() != StatusFinished {
			tc.segMu.Unlock()
			tc.changeStatusWithError(StatusError, fmt.Errorf("cannot merge: segment %d is not finished", ss.Segment.Index))
			return
		}
		if fi, err := os.Stat(ss.TempPath); err != nil || fi.Size() == 0 {
			tc.segMu.Unlock()
			tc.changeStatusWithError(StatusError, fmt.Errorf("cannot merge: segment %d is missing or empty", ss.Segment.Index))
			return
		}
	}
	tc.segMu.Unlock()

	tc.changeStatus(StatusMerging)

	destPath := tc.State.DestFilePath
	tempDestPath := destPath + ".merging"

	out, err := os.OpenFile(tempDestPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		tc.changeStatusWithError(StatusError, fmt.Errorf("failed to create merged video file: %w", err))
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	buf := make([]byte, 1024*1024) // 1MB streaming buffer
	var finalSize int64 = 0

	for _, ss := range tc.segStates {
		select {
		case <-tc.ctx.Done():
			out.Close()
			_ = os.Remove(tempDestPath)
			return
		default:
		}

		in, err := os.Open(ss.TempPath)
		if err != nil {
			out.Close()
			_ = os.Remove(tempDestPath)
			tc.changeStatusWithError(StatusError, fmt.Errorf("missing segment %d on merge: %w", ss.Segment.Index, err))
			return
		}

		n, err := io.CopyBuffer(out, in, buf)
		in.Close()
		if err != nil {
			out.Close()
			_ = os.Remove(tempDestPath)
			tc.changeStatusWithError(StatusError, fmt.Errorf("failed during segment %d merge: %w", ss.Segment.Index, err))
			return
		}
		finalSize += n
	}

	_ = out.Sync()
	out.Close()

	// If FFmpeg is available and destination is .mp4, remux stream into standard ISO MP4 for 100% playable video
	remuxSucceeded := false
	ffmpegExe := GetFFmpegExecutable()
	if ffmpegExe != "" && strings.HasSuffix(strings.ToLower(destPath), ".mp4") {
		remuxTempPath := destPath + ".remux.mp4"
		_ = os.Remove(remuxTempPath)
		cmd := exec.CommandContext(tc.ctx, ffmpegExe, "-y", "-i", tempDestPath, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", remuxTempPath)
		if err := cmd.Run(); err == nil {
			if fi, err := os.Stat(remuxTempPath); err == nil && fi.Size() > 0 {
				_ = os.Remove(tempDestPath)
				_ = os.Remove(destPath)
				if err := os.Rename(remuxTempPath, destPath); err == nil {
					finalSize = fi.Size()
					remuxSucceeded = true
				}
			}
		}
		_ = os.Remove(remuxTempPath)
	}

	if !remuxSucceeded {
		_ = os.Remove(destPath)
		if err := os.Rename(tempDestPath, destPath); err != nil {
			tc.changeStatusWithError(StatusError, fmt.Errorf("failed to finalize video file: %w", err))
			return
		}
	}

	// Clean up segment cache directory
	if tc.State.CacheDir != "" {
		_ = os.RemoveAll(tc.State.CacheDir)
	}

	tc.State.mu.Lock()
	tc.State.TotalSize = finalSize
	tc.State.Status = StatusFinished
	tc.State.mu.Unlock()

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Status:          StatusFinished,
			DownloadedBytes: finalSize,
			Downloaded:      finalSize,
			TotalBytes:      finalSize,
			TotalSize:       finalSize,
			Resumable:       true,
			ResumeSupport:   "Yes",
		})
	}

	payload := map[string]interface{}{
		"id":               tc.State.ID,
		"task_id":          tc.State.ID,
		"filename":         tc.State.Filename,
		"save_path":        tc.State.SavePath,
		"dest_file_path":   tc.State.DestFilePath,
		"filePath":         tc.State.DestFilePath,
		"total_size":       finalSize,
		"total_bytes":      finalSize,
		"downloaded":       finalSize,
		"downloaded_bytes": finalSize,
		"status":           StatusFinished,
		"is_hls":           true,
		"showCompletion":   tc.State.ShowCompletion,
	}

	LatestDownloadCompletedPayload = payload

	if OnDownloadCompleted != nil {
		OnDownloadCompleted(payload)
	}
}

func (tc *HLSTaskController) progressEmitter() {
	ticker := time.NewTicker(GetProgressInterval())
	defer ticker.Stop()

	var lastDownloaded int64 = -1
	lastTime := time.Now()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-ticker.C:
			tc.State.mu.RLock()
			status := tc.State.Status
			taskID := tc.State.ID
			totalSegments := tc.State.TotalSegments
			threadCount := tc.State.ThreadCount
			tc.State.mu.RUnlock()

			if status == StatusFinished || status == StatusError || status == StatusCanceled {
				return
			}

			totalDownloaded := tc.totalBytesDl.Load()

			// Calculate completed segments
			tc.segMu.Lock()
			completedSegs := 0
			for _, ss := range tc.segStates {
				if ss.GetStatus() == StatusFinished {
					completedSegs++
				}
			}
			tc.segMu.Unlock()

			tc.State.mu.Lock()
			tc.State.CompletedSegments = completedSegs
			tc.State.mu.Unlock()

			now := time.Now()
			duration := now.Sub(lastTime).Seconds()

			if duration >= 1.0 {
				if lastDownloaded != -1 {
					instantSpeed := float64(totalDownloaded-lastDownloaded) / duration
					if tc.speedEMA == 0 {
						tc.speedEMA = instantSpeed
					} else {
						tc.speedEMA = (instantSpeed * 0.2) + (tc.speedEMA * 0.8)
					}
				}
				lastDownloaded = totalDownloaded
				lastTime = now
			}

			// Estimate total size and ETA based on completed segments
			var estimatedTotal int64 = 0
			var eta float64 = 0
			if completedSegs > 0 && totalSegments > 0 {
				avgSegSize := totalDownloaded / int64(completedSegs)
				estimatedTotal = avgSegSize * int64(totalSegments)
				if tc.speedEMA > 0 && estimatedTotal > totalDownloaded {
					eta = float64(estimatedTotal-totalDownloaded) / tc.speedEMA
				}
			}

			// Build visual worker chunk representations for frontend
			chunkPayloads := make([]ChunkPayload, 0, threadCount)
			workerSegSize := int64(0)
			if totalSegments > 0 {
				workerSegSize = int64(totalSegments / threadCount)
				if workerSegSize == 0 {
					workerSegSize = 1
				}
			}

			for i := 0; i < threadCount; i++ {
				workerStartSeg := i * int(workerSegSize)
				workerEndSeg := (i + 1) * int(workerSegSize)
				if i == threadCount-1 || workerEndSeg > totalSegments {
					workerEndSeg = totalSegments
				}

				workerDl := int64(0)
				workerTot := int64(workerEndSeg - workerStartSeg)
				if workerTot <= 0 {
					workerTot = 1
				}

				tc.segMu.Lock()
				for idx := workerStartSeg; idx < workerEndSeg && idx < len(tc.segStates); idx++ {
					if tc.segStates[idx].GetStatus() == StatusFinished {
						workerDl++
					}
				}
				tc.segMu.Unlock()

				workerStatus := StatusPending
				if workerDl >= workerTot {
					workerStatus = StatusFinished
				} else if workerDl > 0 {
					workerStatus = StatusDownloading
				}

				chunkPayloads = append(chunkPayloads, ChunkPayload{
					ID:         i,
					Status:     workerStatus,
					Downloaded: workerDl,
					Total:      workerTot,
				})
			}

			payload := ProgressPayload{
				ID:              taskID,
				TaskID:          taskID,
				Filename:        tc.State.Filename,
				SavePath:        tc.State.SavePath,
				Status:          status,
				DownloadedBytes: totalDownloaded,
				Downloaded:      totalDownloaded,
				TotalBytes:      estimatedTotal,
				TotalSize:       estimatedTotal,
				ThreadCount:     threadCount,
				Speed:           tc.speedEMA,
				SpeedLimit:      tc.getEffectiveSpeedLimitLocked(),
				ETA:             eta,
				Chunks:          chunkPayloads,
				Resumable:       true,
				ResumeSupport:   "Yes",
				ProxyUsed:       GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
			}

			if application.Get() != nil {
				application.Get().Event.Emit("download-progress", payload)
			}
			if OnProgressUpdate != nil {
				OnProgressUpdate(taskID, tc.State.Filename, totalDownloaded, estimatedTotal)
			}
		}
	}
}

func (tc *HLSTaskController) getEffectiveSpeedLimitLocked() *int64 {
	if tc.limiter != nil && tc.limiter.IsExplicit() {
		return tc.State.SpeedLimit
	}

	cfg := GetEngineConfig()
	if cfg.GlobalSpeedLimiter && cfg.GlobalSpeedLimit > 0 {
		limit := cfg.GlobalSpeedLimit
		return &limit
	}

	return nil
}

func (tc *HLSTaskController) getEffectiveSpeedLimit() *int64 {
	tc.State.mu.RLock()
	defer tc.State.mu.RUnlock()
	return tc.getEffectiveSpeedLimitLocked()
}

func (tc *HLSTaskController) emitCurrentProgress() {
	tc.State.mu.RLock()
	status := tc.State.Status
	taskID := tc.State.ID
	threadCount := tc.State.ThreadCount
	totalSegments := tc.State.TotalSegments
	tc.State.mu.RUnlock()

	tc.segMu.Lock()
	completedSegs := 0
	for _, ss := range tc.segStates {
		if ss.GetStatus() == StatusFinished {
			completedSegs++
		}
	}
	tc.segMu.Unlock()

	totalDownloaded := tc.totalBytesDl.Load()
	var estimatedTotal int64 = 0
	if completedSegs > 0 && totalSegments > 0 {
		avgSegSize := totalDownloaded / int64(completedSegs)
		estimatedTotal = avgSegSize * int64(totalSegments)
	}

	chunkPayloads := make([]ChunkPayload, 0, threadCount)
	workerSegSize := int64(0)
	if totalSegments > 0 {
		workerSegSize = int64(totalSegments / threadCount)
		if workerSegSize == 0 {
			workerSegSize = 1
		}
	}

	for i := 0; i < threadCount; i++ {
		workerStartSeg := i * int(workerSegSize)
		workerEndSeg := (i + 1) * int(workerSegSize)
		if i == threadCount-1 || workerEndSeg > totalSegments {
			workerEndSeg = totalSegments
		}

		workerDl := int64(0)
		workerTot := int64(workerEndSeg - workerStartSeg)
		if workerTot <= 0 {
			workerTot = 1
		}

		tc.segMu.Lock()
		for idx := workerStartSeg; idx < workerEndSeg && idx < len(tc.segStates); idx++ {
			if tc.segStates[idx].GetStatus() == StatusFinished {
				workerDl++
			}
		}
		tc.segMu.Unlock()

		workerStatus := StatusPending
		if workerDl >= workerTot {
			workerStatus = StatusFinished
		} else if workerDl > 0 {
			workerStatus = StatusDownloading
		}

		chunkPayloads = append(chunkPayloads, ChunkPayload{
			ID:         i,
			Status:     workerStatus,
			Downloaded: workerDl,
			Total:      workerTot,
		})
	}

	payload := ProgressPayload{
		ID:              taskID,
		TaskID:          taskID,
		Filename:        tc.State.Filename,
		SavePath:        tc.State.SavePath,
		Status:          status,
		DownloadedBytes: totalDownloaded,
		Downloaded:      totalDownloaded,
		TotalBytes:      estimatedTotal,
		TotalSize:       estimatedTotal,
		ThreadCount:     threadCount,
		Speed:           tc.speedEMA,
		SpeedLimit:      tc.getEffectiveSpeedLimit(),
		ETA:             0,
		Chunks:          chunkPayloads,
		Resumable:       true,
		ResumeSupport:   "Yes",
		ProxyUsed:       GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", payload)
	}
	if OnProgressUpdate != nil {
		OnProgressUpdate(taskID, tc.State.Filename, totalDownloaded, estimatedTotal)
	}
}

func (tc *HLSTaskController) UpdateSpeedLimit(speedLimit *int64) {
	tc.State.mu.Lock()
	tc.State.SpeedLimit = speedLimit
	tc.State.mu.Unlock()

	var limit int64 = 0
	if speedLimit != nil && *speedLimit > 0 {
		limit = *speedLimit
	}
	if tc.limiter != nil {
		tc.limiter.SetExplicitLimit(limit)
	}
}

func (tc *HLSTaskController) UpdateThreadCount(newCount int) {
	if newCount <= 0 {
		return
	}
	tc.State.mu.Lock()
	tc.State.ThreadCount = newCount
	tc.State.mu.Unlock()
	tc.triggerWorkerCheck()
	tc.emitCurrentProgress()
}

func (tc *HLSTaskController) Pause() error {
	tc.State.mu.RLock()
	st := tc.State.Status
	tc.State.mu.RUnlock()
	if st == StatusFinished || st == StatusError || st == StatusCanceled || st == StatusPaused {
		return nil
	}

	tc.cancel()
	tc.changeStatus(StatusPaused)

	tc.workers.Wait()

	tc.segMu.Lock()
	for _, ss := range tc.segStates {
		if ss.GetStatus() != StatusFinished {
			ss.SetStatus(StatusPending)
		}
	}
	tc.segMu.Unlock()

	if application.Get() != nil {
		state := tc.GetState()
		application.Get().Event.Emit("download-progress", ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Status:          StatusPaused,
			DownloadedBytes: state["downloaded"].(int64),
			Downloaded:      state["downloaded"].(int64),
			TotalBytes:      state["total_size"].(int64),
			TotalSize:       state["total_size"].(int64),
			Speed:           0,
			ETA:             0,
			Resumable:       true,
			ResumeSupport:   "Yes",
		})
	}
	return nil
}

func (tc *HLSTaskController) Cancel() error {
	tc.State.mu.RLock()
	st := tc.State.Status
	tc.State.mu.RUnlock()
	if st == StatusFinished {
		return nil
	}

	tc.cancel()
	tc.changeStatus(StatusCanceled)

	if application.Get() != nil {
		state := tc.GetState()
		application.Get().Event.Emit("download-progress", ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Status:          StatusCanceled,
			DownloadedBytes: state["downloaded"].(int64),
			Downloaded:      state["downloaded"].(int64),
			TotalBytes:      state["total_size"].(int64),
			TotalSize:       state["total_size"].(int64),
			Speed:           0,
			ETA:             0,
			Resumable:       true,
			ResumeSupport:   "Yes",
		})
	}

	if GetEngineConfig().DeletePartialOnFileCancel {
		if tc.State.CacheDir != "" {
			_ = os.RemoveAll(tc.State.CacheDir)
		}
	}
	return nil
}

func (tc *HLSTaskController) GetState() map[string]interface{} {
	tc.State.mu.RLock()
	defer tc.State.mu.RUnlock()

	tc.segMu.Lock()
	completedSegs := 0
	for _, ss := range tc.segStates {
		if ss.GetStatus() == StatusFinished {
			completedSegs++
		}
	}
	tc.segMu.Unlock()

	totalDownloaded := tc.totalBytesDl.Load()
	var estimatedTotal int64 = 0
	if completedSegs > 0 && tc.State.TotalSegments > 0 {
		avgSegSize := totalDownloaded / int64(completedSegs)
		estimatedTotal = avgSegSize * int64(tc.State.TotalSegments)
	}

	return map[string]interface{}{
		"id":                 tc.State.ID,
		"task_id":            tc.State.ID,
		"status":             tc.State.Status,
		"downloaded":         totalDownloaded,
		"downloaded_bytes":   totalDownloaded,
		"total_size":         estimatedTotal,
		"total_bytes":        estimatedTotal,
		"url":                tc.State.URL,
		"filename":           tc.State.Filename,
		"save_path":          tc.State.SavePath,
		"error_message":      tc.State.ErrorMessage,
		"is_hls":             true,
		"speed_limit":        tc.getEffectiveSpeedLimit(),
		"thread_count":       tc.State.ThreadCount,
		"total_segments":     tc.State.TotalSegments,
		"completed_segments": completedSegs,
		"duration":           tc.State.Duration,
		"resumable":          true,
		"resume_support":     "Yes",
		"accept_ranges":      true,
		"proxy_used":         GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}
}

func (tc *HLSTaskController) changeStatus(s DownloadStatus) {
	tc.State.mu.Lock()
	tc.State.Status = s
	tc.State.mu.Unlock()
}

func (tc *HLSTaskController) changeStatusWithError(s DownloadStatus, err error) {
	tc.State.mu.Lock()
	tc.State.Status = s
	if err != nil {
		tc.State.ErrorMessage = err.Error()
	}
	tc.State.mu.Unlock()
}
