// task_progress.go handles periodic progress event emission, exponential moving average (EMA)
// speed and ETA calculation, and per-task/global bandwidth speed limit management.
package httptask

import (
	"time"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/proxy"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// UpdateSpeedLimit dynamically updates the per-task bandwidth limit and persists the checkpoint.
func (tc *TaskController) UpdateSpeedLimit(speedLimit *int64) {
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
	go tc.SaveCheckpoint()
}

func (tc *TaskController) getEffectiveSpeedLimitLocked() *int64 {
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

func (tc *TaskController) getEffectiveSpeedLimit() *int64 {
	tc.State.Mu.RLock()
	defer tc.State.Mu.RUnlock()
	return tc.getEffectiveSpeedLimitLocked()
}

// snapshotChunksLocked returns the aggregate downloaded bytes and per-chunk UI payloads.
// Caller must hold at least a read lock on tc.State.Mu.
func (tc *TaskController) snapshotChunksLocked() (int64, []core.ChunkPayload) {
	var totalDownloaded int64
	chunkPayloads := make([]core.ChunkPayload, 0, len(tc.State.Chunks))
	for _, c := range tc.State.Chunks {
		id, start, cur, end, st := c.Snapshot()
		dl := cur - start
		total := end - start + 1
		if end <= 0 || total < 0 {
			total = 0
		}
		totalDownloaded += dl
		chunkPayloads = append(chunkPayloads, core.ChunkPayload{
			ID:         id + 1,
			Status:     st,
			Downloaded: dl,
			Total:      total,
		})
	}
	return totalDownloaded, chunkPayloads
}

// emitCurrentProgress immediately broadcasts the current download state to the Wails frontend.
func (tc *TaskController) emitCurrentProgress() {
	tc.State.Mu.RLock()
	status := tc.State.Status
	totalSize := tc.State.TotalSize
	taskID := tc.State.ID
	threadCount := tc.State.ThreadCount
	totalDownloaded, chunkPayloads := tc.snapshotChunksLocked()

	resumeSupportStr := "No"
	if tc.State.Resumable {
		resumeSupportStr = "Yes"
	}

	payload := core.ProgressPayload{
		ID:              taskID,
		TaskID:          taskID,
		URL:             tc.State.URL,
		Filename:        tc.State.Filename,
		SavePath:        tc.State.SavePath,
		Protocol:        tc.State.Protocol,
		Status:          status,
		DownloadedBytes: totalDownloaded,
		Downloaded:      totalDownloaded,
		TotalBytes:      totalSize,
		TotalSize:       totalSize,
		ThreadCount:     threadCount,
		Speed:           tc.speedEMA,
		SpeedLimit:      tc.getEffectiveSpeedLimitLocked(),
		ETA:             0,
		ProxyUsed:       proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
		Chunks:          chunkPayloads,
		Resumable:       tc.State.Resumable,
		ResumeSupport:   resumeSupportStr,
	}
	tc.State.Mu.RUnlock()

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", payload)
	}
	core.EmitProgressUpdate(taskID, tc.State.Filename, totalDownloaded, totalSize)
}

// progressEmitter periodically computes smoothed download speed (EMA), flushes checkpoints,
// and emits progress payloads to the UI.
func (tc *TaskController) progressEmitter() {
	ticker := time.NewTicker(core.GetProgressInterval())
	defer ticker.Stop()

	var lastDownloaded int64 = -1
	lastTime := time.Now()
	lastCheckpointTime := time.Now()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-ticker.C:
			tc.State.Mu.RLock()
			status := tc.State.Status
			totalSize := tc.State.TotalSize
			taskID := tc.State.ID

			if status == core.StatusFinished || status == core.StatusError {
				tc.State.Mu.RUnlock()
				return
			}

			totalDownloaded, chunkPayloads := tc.snapshotChunksLocked()
			tc.State.Mu.RUnlock()

			now := time.Now()
			duration := now.Sub(lastTime).Seconds()

			// Update speed moving average over 0.5s window for responsive and smooth UI updates
			if duration >= 0.5 {
				if lastDownloaded != -1 && totalDownloaded >= lastDownloaded && duration > 0 {
					instantSpeed := float64(totalDownloaded-lastDownloaded) / duration
					if instantSpeed >= 0 {
						if tc.speedEMA <= 0 {
							tc.speedEMA = instantSpeed
						} else {
							tc.speedEMA = (instantSpeed * 0.3) + (tc.speedEMA * 0.7)
						}
					}
				}
				lastDownloaded = totalDownloaded
				lastTime = now
			}

			// Periodic checkpoint flush to OS app storage every 500 milliseconds
			if now.Sub(lastCheckpointTime).Milliseconds() >= 500 {
				tc.SaveCheckpoint()
				lastCheckpointTime = now
			}

			var eta float64
			if tc.speedEMA > 0 && totalSize > totalDownloaded {
				eta = float64(totalSize-totalDownloaded) / tc.speedEMA
			}

			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}

			payload := core.ProgressPayload{
				ID:               taskID,
				TaskID:           taskID,
				URL:              tc.State.URL,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Protocol:         tc.State.Protocol,
				Status:           status,
				DownloadedBytes:  totalDownloaded,
				Downloaded:       totalDownloaded,
				TotalBytes:       totalSize,
				TotalSize:        totalSize,
				ThreadCount:      tc.State.ThreadCount,
				Speed:            tc.speedEMA,
				SpeedLimit:       tc.getEffectiveSpeedLimitLocked(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              eta,
				Chunks:           chunkPayloads,
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
				ProxyUsed:        proxy.GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
			}

			if application.Get() != nil {
				application.Get().Event.Emit("download-progress", payload)
			}
			core.EmitProgressUpdate(taskID, tc.State.Filename, totalDownloaded, totalSize)
		}
	}
}
