// task_orchestrator.go runs the chunk worker scheduling loop, dynamic chunk splitting
// (IDM-style work-stealing), dynamic thread count scaling, and automatic chunk retries.
package httptask

import (
	"context"
	"fmt"
	"log"
	"sort"
	"time"

	"ThunderDM/src-wails3/downloader/core"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// OrchestratorLoop monitors chunk states, retries failed chunks up to MaxRetries,
// performs dynamic work-stealing splits, and spawns chunk download workers.
func (tc *TaskController) OrchestratorLoop() {
	tc.TriggerWorkerCheck()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-tc.ctx.Done():
			if tc.targetFile != nil {
				_ = tc.targetFile.Sync()
				_ = tc.targetFile.Close()
			}
			return
		case <-ticker.C:
			tc.TriggerWorkerCheck()
		case <-tc.chunkSignal:
			tc.State.Mu.Lock()
			activeWorkers := 0
			pendingChunks := make([]*core.ChunkState, 0)
			errorChunks := make([]*core.ChunkState, 0)
			allFinished := len(tc.State.Chunks) > 0
			var totalDownloaded int64

			cfg := core.GetEngineConfig()
			maxRetries := cfg.MaxRetries
			if maxRetries <= 0 {
				maxRetries = 3
			}

			for _, c := range tc.State.Chunks {
				_, start, cur, end, status := c.Snapshot()
				if cur > start {
					totalDownloaded += (cur - start)
				}

				isChunkFinished := (status == core.StatusFinished) && (end <= 0 || cur > end)
				if !isChunkFinished {
					allFinished = false
					switch status {
					case core.StatusDownloading:
						activeWorkers++
					case core.StatusError:
						errorChunks = append(errorChunks, c)
					default:
						pendingChunks = append(pendingChunks, c)
					}
				}
			}

			// For fixed-size downloads, require all chunks finished AND total downloaded >= total size
			if tc.State.TotalSize > 0 && totalDownloaded < tc.State.TotalSize {
				allFinished = false
			}

			if allFinished {
				tc.State.Mu.Unlock()
				tc.finalizeDownload()
				return
			}

			// Check if any errorChunks can be retried according to maxRetries setting
			retriedAny := false
			for _, ec := range errorChunks {
				if ec.GetRetryCount() < maxRetries {
					attemptNum := ec.IncrementRetryCount()
					ec.SetStatus(core.StatusPending)
					pendingChunks = append(pendingChunks, ec)
					retriedAny = true
					log.Printf("[TaskController] Auto-retrying chunk %d (attempt %d/%d) for task %s", ec.ID+1, attemptNum, maxRetries, tc.State.ID)
				}
			}
			if retriedAny {
				tc.State.Status = core.StatusDownloading
				if len(errorChunks) > 0 {
					tc.State.ErrorMessage = fmt.Sprintf("Reconnecting (attempt %d/%d)...", errorChunks[0].GetRetryCount(), maxRetries)
				}
				time.AfterFunc(1000*time.Millisecond, func() {
					tc.TriggerWorkerCheck()
				})
			}

			// If no workers active, no pending chunks, and not all finished, all retries are exhausted
			if activeWorkers == 0 && len(pendingChunks) == 0 && !allFinished {
				tc.failTaskAfterRetriesLocked(maxRetries)
				return
			}

			threadCount := tc.State.ThreadCount
			tc.State.Mu.Unlock()

			// IDM Dynamic File Relocation: split largest remaining chunk when idle threads are available
			if core.GetEngineConfig().DynamicPartCreation && activeWorkers < threadCount && len(errorChunks) == 0 && tc.State.TotalSize > 0 {
				tc.State.Mu.Lock()
				if len(errorChunks) == 0 && len(tc.State.Chunks) < threadCount {
					slotsNeeded := threadCount - (activeWorkers + len(pendingChunks))
					for s := 0; s < slotsNeeded && len(tc.State.Chunks) < threadCount; s++ {
						if !tc.SplitLargestChunk() {
							break
						}
					}
					pendingChunks = make([]*core.ChunkState, 0)
					for _, c := range tc.State.Chunks {
						if c.GetStatus() == core.StatusPending {
							pendingChunks = append(pendingChunks, c)
						}
					}
				}
				tc.State.Mu.Unlock()
			}

			// Spawn workers up to threadCount limit
			for i := 0; i < len(pendingChunks) && activeWorkers < threadCount; i++ {
				c := pendingChunks[i]
				c.SetStatus(core.StatusDownloading)
				activeWorkers++
				tc.workers.Add(1)

				workerCtx, workerCancel := context.WithCancel(tc.ctx)
				tc.cancelsMu.Lock()
				tc.workerCancels[c] = workerCancel
				tc.cancelsMu.Unlock()

				go tc.runChunkWorker(c, workerCtx)
			}
		}
	}
}

// failTaskAfterRetriesLocked transitions the task to StatusError and releases the container file.
// Caller must hold tc.State.Mu lock; this method unlocks tc.State.Mu before returning.
func (tc *TaskController) failTaskAfterRetriesLocked(maxRetries int) {
	tc.State.Status = core.StatusError
	if tc.State.ErrorMessage == "" {
		tc.State.ErrorMessage = fmt.Sprintf("Download failed after %d retry attempts", maxRetries)
	}
	errMsg := tc.State.ErrorMessage
	taskID := tc.State.ID
	filename := tc.State.Filename
	tc.State.Mu.Unlock()

	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
		_ = tc.targetFile.Close()
		tc.targetFile = nil
	}

	log.Printf("[TaskController] Task %s (%s) failed with error: %s", taskID, filename, errMsg)
	tc.emitCurrentProgress()
	if application.Get() != nil {
		application.Get().Event.Emit("download-error", map[string]interface{}{
			"task_id": taskID,
			"id":      taskID,
			"error":   errMsg,
		})
	}
	tc.cancel()
}

func (tc *TaskController) runChunkWorker(chk *core.ChunkState, wCtx context.Context) {
	defer func() {
		tc.cancelsMu.Lock()
		delete(tc.workerCancels, chk)
		tc.cancelsMu.Unlock()
		tc.workers.Done()
	}()

	fcStr := "false"
	if tc.State.ForceCookie {
		fcStr = "true"
	}
	startCur := chk.GetCurrentByte()
	err := DownloadChunk(
		wCtx,
		tc.State.URL,
		chk,
		tc.targetFile,
		core.SharedHTTPClient,
		tc.limiter,
		func(c0 *core.ChunkState) {
			tc.FallbackToSingleStream(c0)
		},
		tc.State.AuthUsername,
		tc.State.AuthPassword,
		tc.State.UserAgent,
		tc.State.Referer,
		tc.State.Cookies,
		fcStr,
	)
	if chk.GetCurrentByte() > startCur+64*1024 {
		chk.ResetRetryCount()
	}
	if err != nil && wCtx.Err() == nil {
		tc.State.Mu.Lock()
		if tc.State.ErrorMessage == "" {
			tc.State.ErrorMessage = err.Error()
		}
		tc.State.Mu.Unlock()
	}
	tc.TriggerWorkerCheck()
}

// FallbackToSingleStream collapses a multi-chunk download into a single non-resumable stream
// when a server rejects HTTP Range requests mid-flight (e.g. returns HTTP 200 instead of 206).
func (tc *TaskController) FallbackToSingleStream(chunk0 *core.ChunkState) {
	tc.State.Mu.Lock()
	tc.State.ThreadCount = 1
	tc.State.Resumable = false
	if tc.State.TotalSize > 0 {
		chunk0.SetEndByte(tc.State.TotalSize - 1)
	} else {
		chunk0.SetEndByte(-1)
	}
	// Cancel other chunk workers
	for _, c := range tc.State.Chunks {
		if c != chunk0 {
			tc.cancelWorker(c)
		}
	}
	tc.State.Chunks = []*core.ChunkState{chunk0}
	tc.State.Mu.Unlock()

	go tc.SaveCheckpoint()
}

// TriggerWorkerCheck signals the orchestrator loop to re-evaluate chunk workers.
func (tc *TaskController) TriggerWorkerCheck() {
	select {
	case tc.chunkSignal <- struct{}{}:
	default:
	}
}

func (tc *TaskController) cancelWorker(chk *core.ChunkState) {
	tc.cancelsMu.Lock()
	if cancel, exists := tc.workerCancels[chk]; exists {
		cancel()
		delete(tc.workerCancels, chk)
	}
	tc.cancelsMu.Unlock()
}

// UpdateThreadCount dynamically scales the number of active worker threads without losing downloaded progress.
func (tc *TaskController) UpdateThreadCount(newCount int) {
	tc.State.Mu.Lock()

	if newCount <= 0 {
		newCount = 1
	}

	tc.State.ThreadCount = newCount

	// When decreasing threads: gracefully pause excess active downloading workers back to StatusPending.
	// Never delete chunks that have downloaded bytes, preventing any data loss or percentage drop.
	activeCount := 0
	for _, c := range tc.State.Chunks {
		if c.GetStatus() == core.StatusDownloading {
			activeCount++
			if activeCount > newCount {
				c.SetStatus(core.StatusPending)
				tc.cancelWorker(c)
			}
		}
	}

	// When increasing threads and we have fewer chunks than threads, split largest chunk to utilize available threads
	if newCount > len(tc.State.Chunks) && tc.State.TotalSize > 0 {
		diff := newCount - len(tc.State.Chunks)
		for i := 0; i < diff; i++ {
			tc.SplitLargestChunk()
		}
	}

	tc.State.Mu.Unlock()

	tc.TriggerWorkerCheck()
	go tc.SaveCheckpoint()

	// Real-time notification to frontend so UI thread table updates immediately
	tc.emitCurrentProgress()
}

// SplitLargestChunk finds the chunk with the largest remaining byte range (>= 256KB)
// and divides its uncompleted portion in half for work-stealing.
// Caller must hold tc.State.Mu lock.
func (tc *TaskController) SplitLargestChunk() bool {
	var largestChunk *core.ChunkState
	var maxRemaining int64

	for _, c := range tc.State.Chunks {
		if c.GetStatus() == core.StatusDownloading || c.GetStatus() == core.StatusPending {
			remaining := c.GetEndByte() - c.GetCurrentByte()
			if remaining > maxRemaining {
				maxRemaining = remaining
				largestChunk = c
			}
		}
	}

	// Only split if reasonable size left (>= 256KB)
	if largestChunk != nil && maxRemaining >= 256*1024 {
		cur := largestChunk.GetCurrentByte()
		end := largestChunk.GetEndByte()
		midPoint := cur + (end-cur)/2

		newChunk := &core.ChunkState{
			ID:          len(tc.State.Chunks),
			StartByte:   midPoint + 1,
			CurrentByte: midPoint + 1,
			EndByte:     end,
			Status:      core.StatusPending,
		}

		largestChunk.SetEndByte(midPoint)
		tc.State.Chunks = append(tc.State.Chunks, newChunk)

		// Keep chunks sorted by StartByte and re-index IDs
		sort.Slice(tc.State.Chunks, func(i, j int) bool {
			return tc.State.Chunks[i].StartByte < tc.State.Chunks[j].StartByte
		})
		for idx, chk := range tc.State.Chunks {
			chk.ID = idx
		}
		go tc.SaveCheckpoint()
		return true
	}
	return false
}
