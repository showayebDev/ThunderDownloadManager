// hls_task.go manages the HLSTaskController lifecycle (Start, Pause, Cancel, GetState),
// playlist initialization, and real-time progress reporting.
package hls

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/limiter"
	"ThunderDM/src-wails3/downloader/proxy"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// HLSTaskController orchestrates multi-threaded HLS stream downloading and remuxing.
type HLSTaskController struct {
	wailsCtx    context.Context
	ctx         context.Context
	cancel      context.CancelFunc
	State       *core.TaskState
	limiter     *limiter.SpeedLimiter
	playlist    *HLSPlaylist
	workers     sync.WaitGroup
	chunkSignal chan struct{}
	speedEMA    float64

	segMu        sync.Mutex
	segStates    []*HLSSegmentState
	activeCount  int
	totalBytesDl atomic.Int64
}

// NewHLSTaskController constructs a new HLS download controller for the given stream URL.
func NewHLSTaskController(wailsCtx context.Context, id, rawURL, savePath, filename string, threadCount int, opts ...interface{}) *HLSTaskController {
	savePath = core.NormalizeSavePath(savePath)
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
	var limitBytes int64
	var authUser, authPass, userAgent, referer, cookies string
	var forceCookie bool
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
		case core.DownloadExtraOptions:
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
			if v.ForceCookie {
				forceCookie = true
			}
		}
	}

	// Auto-lookup per-host settings from vault if not explicitly provided
	if vItem := core.MatchVaultItem(rawURL); vItem != nil {
		if authUser == "" && authPass == "" && (vItem.User != "" || vItem.Pass != "") {
			authUser = vItem.User
			authPass = vItem.Pass
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

	engineCfg := core.GetEngineConfig()
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

	taskLimiter := limiter.NewSpeedLimiter(limitBytes)
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
		State: &core.TaskState{
			ID:             id,
			URL:            rawURL,
			SavePath:       savePath,
			Filename:       filename,
			DestFilePath:   filepath.Join(savePath, filename),
			CacheDir:       cacheDir,
			ThreadCount:    threadCount,
			SpeedLimit:     spLimit,
			AuthUsername:   authUser,
			AuthPassword:   authPass,
			UserAgent:      userAgent,
			Referer:        referer,
			Cookies:        cookies,
			ForceCookie:    forceCookie,
			Status:         core.StatusPending,
			IsHLS:          true,
			Protocol:       "HLS",
			ShowCompletion: showCompletion,
			Chunks:         make([]*core.ChunkState, 0),
		},
	}
}

// Start probes the HLS playlist, restores cached segments, and launches download workers.
func (tc *HLSTaskController) Start() {
	if err := tc.preCheck(); err != nil {
		log.Printf("[HLSTaskController] preCheck failed: %v", err)
		tc.changeStatusWithError(core.StatusError, err)
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	tc.changeStatus(core.StatusDownloading)
	go tc.orchestratorLoop()
	go tc.progressEmitter()
}

// preCheck fetches the M3U8 manifest, prepares cache directories, and initializes segment checkpoint states.
func (tc *HLSTaskController) preCheck() error {
	tc.State.SavePath = core.NormalizeSavePath(tc.State.SavePath)
	if err := os.MkdirAll(tc.State.SavePath, 0755); err != nil {
		return fmt.Errorf("failed to create save path directory: %w", err)
	}

	if err := os.MkdirAll(tc.State.CacheDir, 0755); err != nil {
		return fmt.Errorf("failed to create HLS segment cache directory: %w", err)
	}

	// Fetch & Parse M3U8 Playlist
	ctxProbe, cancelProbe := context.WithTimeout(tc.ctx, 25*time.Second)
	defer cancelProbe()

	fcStr := "false"
	if tc.State.ForceCookie {
		fcStr = "true"
	}
	playlist, err := FetchAndParseHLS(
		ctxProbe,
		core.SharedHTTPClient,
		tc.State.URL,
		tc.State.AuthUsername,
		tc.State.AuthPassword,
		tc.State.UserAgent,
		tc.State.Referer,
		tc.State.Cookies,
		fcStr,
	)
	if err != nil {
		return fmt.Errorf("failed to parse HLS manifest: %w", err)
	}

	if len(playlist.Segments) == 0 {
		return fmt.Errorf("no playable media segments found in HLS playlist")
	}

	tc.playlist = playlist

	tc.State.Mu.Lock()
	tc.State.TotalSegments = len(playlist.Segments)
	tc.State.Duration = playlist.TotalDuration
	tc.State.Mu.Unlock()

	tc.initializeSegmentCheckpoints(playlist.Segments)
	return nil
}

func (tc *HLSTaskController) progressEmitter() {
	ticker := time.NewTicker(core.GetProgressInterval())
	defer ticker.Stop()

	var lastDownloaded int64 = -1
	lastTime := time.Now()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-ticker.C:
			tc.State.Mu.RLock()
			status := tc.State.Status
			taskID := tc.State.ID
			totalSegments := tc.State.TotalSegments
			threadCount := tc.State.ThreadCount
			tc.State.Mu.RUnlock()

			if status == core.StatusFinished || status == core.StatusError || status == core.StatusCanceled {
				return
			}

			totalDownloaded := tc.totalBytesDl.Load()
			completedSegs := tc.countCompletedSegments()

			tc.State.Mu.Lock()
			tc.State.CompletedSegments = completedSegs
			tc.State.Mu.Unlock()

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
			var estimatedTotal int64
			var eta float64
			if completedSegs > 0 && totalSegments > 0 {
				avgSegSize := totalDownloaded / int64(completedSegs)
				estimatedTotal = avgSegSize * int64(totalSegments)
				if tc.speedEMA > 0 && estimatedTotal > totalDownloaded {
					eta = float64(estimatedTotal-totalDownloaded) / tc.speedEMA
				}
			}

			chunkPayloads := tc.buildWorkerChunkPayloads(threadCount, totalSegments)

			payload := core.ProgressPayload{
				ID:              taskID,
				TaskID:          taskID,
				URL:             tc.State.URL,
				Filename:        tc.State.Filename,
				SavePath:        tc.State.SavePath,
				Protocol:        "HLS",
				IsHLS:           true,
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
				ProxyUsed:       proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
			}

			if application.Get() != nil {
				application.Get().Event.Emit("download-progress", payload)
			}
			core.EmitProgressUpdate(taskID, tc.State.Filename, totalDownloaded, estimatedTotal)
		}
	}
}

func (tc *HLSTaskController) countCompletedSegments() int {
	tc.segMu.Lock()
	defer tc.segMu.Unlock()
	completedSegs := 0
	for _, ss := range tc.segStates {
		if ss.GetStatus() == core.StatusFinished {
			completedSegs++
		}
	}
	return completedSegs
}

func (tc *HLSTaskController) buildWorkerChunkPayloads(threadCount, totalSegments int) []core.ChunkPayload {
	chunkPayloads := make([]core.ChunkPayload, 0, threadCount)
	workerSegSize := int64(0)
	if totalSegments > 0 && threadCount > 0 {
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
			if tc.segStates[idx].GetStatus() == core.StatusFinished {
				workerDl++
			}
		}
		tc.segMu.Unlock()

		workerStatus := core.StatusPending
		if workerDl >= workerTot {
			workerStatus = core.StatusFinished
		} else if workerDl > 0 {
			workerStatus = core.StatusDownloading
		}

		chunkPayloads = append(chunkPayloads, core.ChunkPayload{
			ID:         i + 1,
			Status:     workerStatus,
			Downloaded: workerDl,
			Total:      workerTot,
		})
	}
	return chunkPayloads
}

func (tc *HLSTaskController) getEffectiveSpeedLimitLocked() *int64 {
	if tc.limiter != nil && tc.limiter.IsExplicit() {
		return tc.State.SpeedLimit
	}

	cfg := core.GetEngineConfig()
	if cfg.GlobalSpeedLimiter && cfg.GlobalSpeedLimit > 0 {
		limit := cfg.GlobalSpeedLimit
		return &limit
	}

	return nil
}

func (tc *HLSTaskController) getEffectiveSpeedLimit() *int64 {
	tc.State.Mu.RLock()
	defer tc.State.Mu.RUnlock()
	return tc.getEffectiveSpeedLimitLocked()
}

func (tc *HLSTaskController) emitCurrentProgress() {
	tc.State.Mu.RLock()
	status := tc.State.Status
	taskID := tc.State.ID
	threadCount := tc.State.ThreadCount
	totalSegments := tc.State.TotalSegments
	tc.State.Mu.RUnlock()

	completedSegs := tc.countCompletedSegments()
	totalDownloaded := tc.totalBytesDl.Load()
	var estimatedTotal int64
	if completedSegs > 0 && totalSegments > 0 {
		avgSegSize := totalDownloaded / int64(completedSegs)
		estimatedTotal = avgSegSize * int64(totalSegments)
	}

	chunkPayloads := tc.buildWorkerChunkPayloads(threadCount, totalSegments)

	payload := core.ProgressPayload{
		ID:              taskID,
		TaskID:          taskID,
		URL:             tc.State.URL,
		Filename:        tc.State.Filename,
		SavePath:        tc.State.SavePath,
		Protocol:        "HLS",
		IsHLS:           true,
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
		ProxyUsed:       proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", payload)
	}
	core.EmitProgressUpdate(taskID, tc.State.Filename, totalDownloaded, estimatedTotal)
}

// UpdateSpeedLimit dynamically updates the bandwidth limit for the HLS download task.
func (tc *HLSTaskController) UpdateSpeedLimit(speedLimit *int64) {
	tc.State.Mu.Lock()
	tc.State.SpeedLimit = speedLimit
	tc.State.Mu.Unlock()

	var limit int64
	if speedLimit != nil && *speedLimit > 0 {
		limit = *speedLimit
	}
	if tc.limiter != nil {
		tc.limiter.SetExplicitLimit(limit)
	}
}

// UpdateThreadCount dynamically updates the worker concurrency count for the HLS download task.
func (tc *HLSTaskController) UpdateThreadCount(newCount int) {
	if newCount <= 0 {
		return
	}
	tc.State.Mu.Lock()
	tc.State.ThreadCount = newCount
	tc.State.Mu.Unlock()
	tc.triggerWorkerCheck()
	tc.emitCurrentProgress()
}

// Pause stops active segment workers while preserving downloaded segments in CacheDir.
func (tc *HLSTaskController) Pause() error {
	tc.State.Mu.RLock()
	st := tc.State.Status
	tc.State.Mu.RUnlock()
	if st == core.StatusFinished || st == core.StatusError || st == core.StatusCanceled || st == core.StatusPaused {
		return nil
	}

	tc.cancel()
	tc.changeStatus(core.StatusPaused)

	tc.workers.Wait()

	tc.segMu.Lock()
	for _, ss := range tc.segStates {
		if ss.GetStatus() != core.StatusFinished {
			ss.SetStatus(core.StatusPending)
		}
	}
	tc.segMu.Unlock()

	if application.Get() != nil {
		state := tc.GetState()
		application.Get().Event.Emit("download-progress", core.ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			URL:             tc.State.URL,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Protocol:        "HLS",
			IsHLS:           true,
			Status:          core.StatusPaused,
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

// Cancel stops the HLS download and removes partial segment caches if configured.
func (tc *HLSTaskController) Cancel() error {
	tc.State.Mu.RLock()
	st := tc.State.Status
	tc.State.Mu.RUnlock()
	if st == core.StatusFinished {
		return nil
	}

	tc.cancel()
	tc.changeStatus(core.StatusCanceled)

	if application.Get() != nil {
		state := tc.GetState()
		application.Get().Event.Emit("download-progress", core.ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			URL:             tc.State.URL,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Protocol:        "HLS",
			IsHLS:           true,
			Status:          core.StatusCanceled,
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

	if core.GetEngineConfig().DeletePartialOnFileCancel {
		if tc.State.CacheDir != "" {
			_ = os.RemoveAll(tc.State.CacheDir)
		}
	}
	return nil
}

// GetState returns a snapshot map of the HLS download task's current progress and state.
func (tc *HLSTaskController) GetState() map[string]interface{} {
	tc.State.Mu.RLock()
	defer tc.State.Mu.RUnlock()

	completedSegs := tc.countCompletedSegments()
	totalDownloaded := tc.totalBytesDl.Load()
	var estimatedTotal int64
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
		"speed_limit":        tc.getEffectiveSpeedLimitLocked(),
		"thread_count":       tc.State.ThreadCount,
		"total_segments":     tc.State.TotalSegments,
		"completed_segments": completedSegs,
		"duration":           tc.State.Duration,
		"resumable":          true,
		"resume_support":     "Yes",
		"accept_ranges":      true,
		"proxy_used":         proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}
}

func (tc *HLSTaskController) changeStatus(s core.DownloadStatus) {
	tc.State.Mu.Lock()
	tc.State.Status = s
	tc.State.Mu.Unlock()
}

func (tc *HLSTaskController) changeStatusWithError(s core.DownloadStatus, err error) {
	tc.State.Mu.Lock()
	tc.State.Status = s
	if err != nil {
		tc.State.ErrorMessage = err.Error()
	}
	tc.State.Mu.Unlock()
}
