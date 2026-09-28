// task.go defines the core HTTP TaskController struct, constructor (NewTaskController),
// and lifecycle methods (Start, Pause, Cancel, GetState).
package httptask

import (
	"context"
	"net/url"
	"os"
	"strings"
	"sync"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/limiter"
	"ThunderDM/src-wails3/downloader/proxy"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TaskController manages a multi-threaded HTTP/HTTPS download task.
type TaskController struct {
	wailsCtx      context.Context
	ctx           context.Context
	cancel        context.CancelFunc
	State         *core.TaskState
	limiter       *limiter.SpeedLimiter
	workers       sync.WaitGroup
	chunkSignal   chan struct{}
	speedEMA      float64
	targetFile    *os.File
	workerCancels map[*core.ChunkState]context.CancelFunc
	cancelsMu     sync.Mutex
}

// NewTaskController creates and configures a new HTTP download task controller.
func NewTaskController(wailsCtx context.Context, id, rawURL, savePath, filename string, threadCount int, opts ...interface{}) *TaskController {
	savePath = core.NormalizeSavePath(savePath)
	ctx, cancel := context.WithCancel(context.Background())
	var spLimit *int64
	var limitBytes int64
	var checksumStr string
	var authUser, authPass, userAgent, referer, cookies string
	var forceCookie bool
	showCompletion := true
	protoStr := "Auto"

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
			if v.Protocol != "" {
				protoStr = v.Protocol
			}
			if v.ShowCompletion != nil {
				showCompletion = *v.ShowCompletion
			}
			if v.Checksum != "" && checksumStr == "" {
				checksumStr = v.Checksum
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
		case string:
			if v != "" && checksumStr == "" {
				checksumStr = v
			}
		}
	}

	// Extract credentials embedded in URL (http://user:pass@host/path)
	cleanURL := strings.TrimSpace(rawURL)
	if parsed, err := url.Parse(cleanURL); err == nil && parsed.User != nil {
		if u := parsed.User.Username(); u != "" && authUser == "" {
			authUser = u
		}
		if p, ok := parsed.User.Password(); ok && authPass == "" {
			authPass = p
		}
	}

	// Auto-lookup per-host settings from vault if not explicitly provided
	if vItem := core.MatchVaultItem(cleanURL); vItem != nil {
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

	taskLimiter := limiter.NewSpeedLimiter(limitBytes)
	if spLimit != nil {
		taskLimiter.SetExplicitLimit(limitBytes)
	} else {
		taskLimiter.SetDefaultLimit(0)
	}

	return &TaskController{
		wailsCtx:      wailsCtx,
		ctx:           ctx,
		cancel:        cancel,
		limiter:       taskLimiter,
		chunkSignal:   make(chan struct{}, 10),
		workerCancels: make(map[*core.ChunkState]context.CancelFunc),
		State: &core.TaskState{
			ID:               id,
			URL:              cleanURL,
			SavePath:         savePath,
			Filename:         filename,
			ThreadCount:      threadCount,
			SpeedLimit:       spLimit,
			GivenCheckSum:    checksumStr,
			ExpectedChecksum: checksumStr,
			AuthUsername:     authUser,
			AuthPassword:     authPass,
			UserAgent:        userAgent,
			Referer:          referer,
			Cookies:          cookies,
			ForceCookie:      forceCookie,
			Status:           core.StatusPending,
			ShowCompletion:   showCompletion,
			Protocol:         protoStr,
			Chunks:           make([]*core.ChunkState, 0),
		},
	}
}

// Start runs the HTTP pre-check probe and launches the worker orchestrator and progress emitter.
func (tc *TaskController) Start() {
	if err := tc.preCheck(); err != nil {
		tc.changeStatusWithError(core.StatusError, err)
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	tc.changeStatus(core.StatusDownloading)
	tc.emitCurrentProgress()
	go tc.OrchestratorLoop()
	go tc.progressEmitter()
}

// Pause gracefully stops all active chunk workers, flushes the container file, and saves the checkpoint.
func (tc *TaskController) Pause() error {
	tc.State.Mu.RLock()
	st := tc.State.Status
	tc.State.Mu.RUnlock()
	if st == core.StatusFinished || st == core.StatusError || st == core.StatusCanceled || st == core.StatusPaused {
		return nil
	}

	tc.cancel()
	tc.changeStatus(core.StatusPaused)

	// Wait for workers to cleanly stop writing
	tc.workers.Wait()

	// Reset all non-finished chunks to StatusPending
	tc.State.Mu.Lock()
	for _, c := range tc.State.Chunks {
		if c.GetStatus() != core.StatusFinished {
			c.SetStatus(core.StatusPending)
		}
	}
	tc.State.Mu.Unlock()

	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
	}

	// Save final checkpoint to OS local app storage on pause
	tc.SaveCheckpoint()

	if application.Get() != nil {
		state := tc.GetState()
		if state != nil {
			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}
			application.Get().Event.Emit("download-progress", core.ProgressPayload{
				ID:               tc.State.ID,
				TaskID:           tc.State.ID,
				URL:              tc.State.URL,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Protocol:         tc.State.Protocol,
				Status:           core.StatusPaused,
				DownloadedBytes:  state["downloaded"].(int64),
				Downloaded:       state["downloaded"].(int64),
				TotalBytes:       state["total_size"].(int64),
				TotalSize:        state["total_size"].(int64),
				ThreadCount:      tc.State.ThreadCount,
				Speed:            0,
				SpeedLimit:       tc.getEffectiveSpeedLimit(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              0,
				Chunks:           state["chunks"].([]core.ChunkPayload),
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
			})
		}
	}
	return nil
}

// Cancel terminates all active chunk workers, closes the container file, and optionally deletes partial files.
func (tc *TaskController) Cancel() error {
	tc.State.Mu.RLock()
	st := tc.State.Status
	tc.State.Mu.RUnlock()
	if st == core.StatusFinished {
		return nil
	}

	tc.cancel()
	tc.changeStatus(core.StatusCanceled)

	// Cancel all worker contexts immediately
	tc.cancelsMu.Lock()
	for _, cancelFn := range tc.workerCancels {
		if cancelFn != nil {
			cancelFn()
		}
	}
	tc.cancelsMu.Unlock()

	// Wait for workers to stop writing to release the OS file descriptor
	tc.workers.Wait()

	tc.closeTargetFile()

	if application.Get() != nil {
		state := tc.GetState()
		if state != nil {
			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}
			application.Get().Event.Emit("download-progress", core.ProgressPayload{
				ID:               tc.State.ID,
				TaskID:           tc.State.ID,
				URL:              tc.State.URL,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Protocol:         tc.State.Protocol,
				Status:           core.StatusCanceled,
				DownloadedBytes:  state["downloaded"].(int64),
				Downloaded:       state["downloaded"].(int64),
				TotalBytes:       state["total_size"].(int64),
				TotalSize:        state["total_size"].(int64),
				Speed:            0,
				SpeedLimit:       tc.getEffectiveSpeedLimit(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              0,
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
			})
		}
	}

	// Delete partial files & clean up checkpoint ONLY IF enabled
	if core.GetEngineConfig().DeletePartialOnFileCancel {
		tc.CleanupCheckpoint()
		if tc.State.TempFilePath != "" {
			_ = os.Remove(tc.State.TempFilePath)
		}
		if tc.State.CacheDir != "" {
			_ = os.RemoveAll(tc.State.CacheDir)
		}
	} else {
		// When keeping partial files on cancel, save the current checkpoint so it can be resumed
		tc.SaveCheckpoint()
	}
	return nil
}

// GetState returns a thread-safe map snapshot of the task's current progress, chunks, and metadata.
func (tc *TaskController) GetState() map[string]interface{} {
	tc.State.Mu.RLock()
	defer tc.State.Mu.RUnlock()

	totalDownloaded, chunkPayloads := tc.snapshotChunksLocked()

	resumeSupportStr := "No"
	if tc.State.Resumable {
		resumeSupportStr = "Yes"
	}

	return map[string]interface{}{
		"id":                tc.State.ID,
		"task_id":           tc.State.ID,
		"status":            tc.State.Status,
		"downloaded":        totalDownloaded,
		"downloaded_bytes":  totalDownloaded,
		"total_size":        tc.State.TotalSize,
		"total_bytes":       tc.State.TotalSize,
		"url":               tc.State.URL,
		"filename":          tc.State.Filename,
		"save_path":         tc.State.SavePath,
		"error_message":     tc.State.ErrorMessage,
		"thread_count":      tc.State.ThreadCount,
		"given_checksum":    tc.State.GivenCheckSum,
		"givenCheckSum":     tc.State.GivenCheckSum,
		"expected_checksum": tc.State.ExpectedChecksum,
		"expectedChecksum":  tc.State.ExpectedChecksum,
		"chunks":            chunkPayloads,
		"is_hls":            false,
		"speed_limit":       tc.getEffectiveSpeedLimitLocked(),
		"resumable":         tc.State.Resumable,
		"resume_support":    resumeSupportStr,
		"accept_ranges":     tc.State.Resumable,
		"proxy_used":        proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}
}

func (tc *TaskController) changeStatus(s core.DownloadStatus) {
	tc.State.Mu.Lock()
	tc.State.Status = s
	tc.State.Mu.Unlock()
}

func (tc *TaskController) changeStatusWithError(s core.DownloadStatus, err error) {
	tc.State.Mu.Lock()
	tc.State.Status = s
	if err != nil {
		tc.State.ErrorMessage = err.Error()
	}
	tc.State.Mu.Unlock()
}
