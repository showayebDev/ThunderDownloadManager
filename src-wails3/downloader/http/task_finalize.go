// task_finalize.go handles post-download verification of chunk completeness,
// atomic container renaming (.thunderdm to final destination), server timestamp
// preservation, checkpoint cleanup, and completion event broadcasting.
package httptask

import (
	"fmt"
	"log"
	"os"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// finalizeDownload waits for all workers to finish, verifies every chunk's byte range,
// atomically renames the temporary container file to the destination path, and emits completion events.
func (tc *TaskController) finalizeDownload() {
	tc.workers.Wait()

	tc.State.Mu.RLock()
	chunks := tc.State.Chunks
	totalSize := tc.State.TotalSize
	tc.State.Mu.RUnlock()

	if len(chunks) == 0 {
		tc.failFinalization("cannot finalize download: no chunks configured", false)
		return
	}

	// Strict verification: ensure every chunk completed its range and calculate cumulative downloaded bytes
	var actualDownloaded int64
	for _, c := range chunks {
		_, start, cur, end, status := c.Snapshot()
		if cur > start {
			actualDownloaded += (cur - start)
		}
		if status != core.StatusFinished || (end > 0 && cur <= end) {
			log.Printf("[TaskController] finalizeDownload rejected: chunk not finished (status=%s, cur=%d, end=%d)", status, cur, end)
			tc.closeTargetFile()
			tc.failFinalization("download verification failed: incomplete chunk data", true)
			return
		}
	}

	if totalSize > 0 && actualDownloaded < totalSize {
		log.Printf("[TaskController] finalizeDownload rejected: total downloaded %d < total size %d", actualDownloaded, totalSize)
		tc.closeTargetFile()
		errMsg := fmt.Sprintf("received %d of %d bytes", actualDownloaded, totalSize)
		tc.changeStatusWithError(core.StatusError, fmt.Errorf("download verification failed: %s", errMsg))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": errMsg})
		}
		tc.cancel()
		return
	}

	tc.closeTargetFile()

	// Instant atomic rename from .thunderdm to final destination
	tempPath := tc.State.TempFilePath
	destPath := tc.State.DestFilePath

	// Validate container on disk before renaming
	if fi, err := os.Stat(tempPath); err != nil || (totalSize > 0 && fi.Size() < totalSize) {
		var currentSize int64
		if fi != nil {
			currentSize = fi.Size()
		}
		errMsg := fmt.Sprintf("container size mismatch (expected %d bytes, got %d)", totalSize, currentSize)
		tc.changeStatusWithError(core.StatusError, fmt.Errorf("cannot finalize: %s", errMsg))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": errMsg})
		}
		tc.cancel()
		return
	}

	// Remove destination if it already exists to ensure rename succeeds
	_ = os.Remove(destPath)
	if err := os.Rename(tempPath, destPath); err != nil {
		tc.changeStatusWithError(core.StatusError, fmt.Errorf("failed to finalize download file: %w", err))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": err.Error()})
		}
		tc.cancel()
		return
	}

	// Apply Server's Last-Modified timestamp to local file if enabled
	if core.GetEngineConfig().UseServersLastModified && !tc.State.LastModified.IsZero() {
		_ = os.Chtimes(destPath, tc.State.LastModified, tc.State.LastModified)
	}

	// Sync and backfill real finished file size on disk
	tc.State.Mu.Lock()
	if fi, err := os.Stat(destPath); err == nil && fi.Size() > 0 {
		tc.State.TotalSize = fi.Size()
		totalSize = fi.Size()
		actualDownloaded = fi.Size()
	}
	tc.State.Mu.Unlock()

	// Clean up checkpoint metadata from OS local app storage upon successful completion
	tc.CleanupCheckpoint()

	tc.changeStatus(core.StatusFinished)

	finalDL := totalSize
	if finalDL <= 0 {
		finalDL = actualDownloaded
	}
	if tc.State.TotalSize <= 0 && finalDL > 0 {
		tc.State.Mu.Lock()
		tc.State.TotalSize = finalDL
		tc.State.Mu.Unlock()
	}

	_ = storage.UpdateDownloadProgress(tc.State.ID, finalDL, tc.State.TotalSize, string(core.StatusFinished), "", nil)

	if application.Get() != nil {
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
			Status:           core.StatusFinished,
			DownloadedBytes:  finalDL,
			Downloaded:       finalDL,
			TotalBytes:       tc.State.TotalSize,
			TotalSize:        tc.State.TotalSize,
			ThreadCount:      tc.State.ThreadCount,
			Speed:            0,
			SpeedLimit:       tc.getEffectiveSpeedLimit(),
			GivenCheckSum:    tc.State.GivenCheckSum,
			ExpectedChecksum: tc.State.ExpectedChecksum,
			ETA:              0,
			Resumable:        tc.State.Resumable,
			ResumeSupport:    resumeSupportStr,
		})
	}

	payload := map[string]interface{}{
		"id":                tc.State.ID,
		"task_id":           tc.State.ID,
		"url":               tc.State.URL,
		"filename":          tc.State.Filename,
		"save_path":         tc.State.SavePath,
		"dest_file_path":    tc.State.DestFilePath,
		"filePath":          tc.State.DestFilePath,
		"total_size":        tc.State.TotalSize,
		"total_bytes":       tc.State.TotalSize,
		"downloaded":        finalDL,
		"downloaded_bytes":  finalDL,
		"status":            core.StatusFinished,
		"given_checksum":    tc.State.GivenCheckSum,
		"givenCheckSum":     tc.State.GivenCheckSum,
		"expected_checksum": tc.State.ExpectedChecksum,
		"expectedChecksum":  tc.State.ExpectedChecksum,
		"showCompletion":    tc.State.ShowCompletion,
	}

	core.EmitDownloadCompleted(payload)

	tc.cancel()
}

func (tc *TaskController) closeTargetFile() {
	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
		_ = tc.targetFile.Close()
		tc.targetFile = nil
	}
}

func (tc *TaskController) failFinalization(errMsg string, emitProgress bool) {
	tc.changeStatusWithError(core.StatusError, fmt.Errorf("%s", errMsg))
	if emitProgress {
		tc.emitCurrentProgress()
	}
	if application.Get() != nil {
		application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": errMsg})
	}
	tc.cancel()
}
