package httptask

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ThunderDM/src-wails3/downloader/core"
)

func TestPauseAndResume_CheckpointPersistence(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_resume_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := "test-resume-task-123"
	filename := "largefile.bin"
	totalSize := int64(100 * 1024 * 1024) // 100 MB
	threadCount := 4

	tc1 := NewTaskController(context.Background(), taskID, "http://example.com/largefile.bin", tempDir, filename, threadCount)
	tc1.State.TotalSize = totalSize
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)

	tc1.InitializeChunks()

	if len(tc1.State.Chunks) != 4 {
		t.Fatalf("Expected 4 chunks, got %d", len(tc1.State.Chunks))
	}

	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetEndByte() + 1)
	tc1.State.Chunks[0].SetStatus(core.StatusFinished)

	tc1.State.Chunks[1].SetCurrentByte(tc1.State.Chunks[1].GetEndByte() + 1)
	tc1.State.Chunks[1].SetStatus(core.StatusFinished)

	chunk2Start := tc1.State.Chunks[2].StartByte
	tc1.State.Chunks[2].SetCurrentByte(chunk2Start + 20*1024*1024)
	tc1.State.Chunks[2].SetStatus(core.StatusDownloading)

	chunk3Start := tc1.State.Chunks[3].StartByte
	tc1.State.Chunks[3].SetCurrentByte(chunk3Start + 10*1024*1024)
	tc1.State.Chunks[3].SetStatus(core.StatusDownloading)

	state1 := tc1.GetState()
	dl1 := state1["downloaded"].(int64)
	expectedBytes := int64(80 * 1024 * 1024)
	if dl1 != expectedBytes {
		t.Fatalf("Expected %d bytes downloaded, got %d", expectedBytes, dl1)
	}

	tc1.SaveCheckpoint()
	_ = os.WriteFile(tc1.State.TempFilePath, []byte("container-data"), 0644)

	metaPath := tc1.CheckpointPath()
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Fatalf("Checkpoint file %s was not created on pause!", metaPath)
	}

	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/largefile.bin", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)

	tc2.InitializeChunks()

	if len(tc2.State.Chunks) != 4 {
		t.Fatalf("Expected 4 restored chunks, got %d", len(tc2.State.Chunks))
	}

	state2 := tc2.GetState()
	dl2 := state2["downloaded"].(int64)
	if dl2 != expectedBytes {
		t.Fatalf("Expected resumed downloaded bytes to be %d (80 MB), but got %d!", expectedBytes, dl2)
	}

	if tc2.State.Chunks[0].GetStatus() != core.StatusFinished {
		t.Errorf("Expected chunk 0 to be Finished, got %s", tc2.State.Chunks[0].GetStatus())
	}
	expectedChunk2Cur := chunk2Start + 20*1024*1024
	if tc2.State.Chunks[2].GetCurrentByte() != expectedChunk2Cur {
		t.Errorf("Expected chunk 2 CurrentByte %d, got %d", expectedChunk2Cur, tc2.State.Chunks[2].GetCurrentByte())
	}
	if tc2.State.Chunks[2].GetStatus() != core.StatusPending {
		t.Errorf("Expected chunk 2 to be Pending for worker pickup, got %s", tc2.State.Chunks[2].GetStatus())
	}
}

func TestResumeWithDeletedTempFile_ResetsToBeginning(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_deleted_temp_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-del-temp-task-%d", time.Now().UnixNano())
	filename := "deleted_test_video.mkv"
	totalSize := int64(50 * 1024 * 1024) // 50 MB
	threadCount := 4

	tc1 := NewTaskController(context.Background(), taskID, "http://example.com/video.mkv", tempDir, filename, threadCount)
	tc1.State.TotalSize = totalSize
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)

	tc1.InitializeChunks()
	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetEndByte() + 1)
	tc1.State.Chunks[0].SetStatus(core.StatusFinished)
	tc1.SaveCheckpoint()

	metaFile := core.GetTaskMetaFilePath(taskID)
	if _, err := os.Stat(metaFile); err != nil {
		t.Fatalf("Expected checkpoint file to exist, got: %v", err)
	}

	_ = os.Remove(tc1.State.TempFilePath)

	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/video.mkv", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)

	tc2.InitializeChunks(false)

	state := tc2.GetState()
	dl := state["downloaded"].(int64)
	if dl != 0 {
		t.Fatalf("Expected 0 bytes downloaded when temp file was deleted, got %d", dl)
	}

	for i, chk := range tc2.State.Chunks {
		if chk.GetStatus() != core.StatusPending {
			t.Errorf("Expected chunk %d to be StatusPending, got %s", i, chk.GetStatus())
		}
		if chk.GetCurrentByte() != chk.GetStartByte() {
			t.Errorf("Expected chunk %d CurrentByte to match StartByte %d, got %d", i, chk.GetStartByte(), chk.GetCurrentByte())
		}
	}
}

func TestDynamicPartCreation_ChunkSplitting(t *testing.T) {
	taskId := fmt.Sprintf("test-dpc-task-%d", time.Now().UnixNano())
	_ = os.Remove(core.GetTaskMetaFilePath(taskId))
	defer func() {
		_ = os.Remove(core.GetTaskMetaFilePath(taskId))
	}()

	tc := NewTaskController(context.Background(), taskId, "http://example.com/file.zip", "", "file.zip", 2)
	tc.State.TotalSize = 10 * 1024 * 1024 // 10MB
	tc.InitializeChunks()

	if len(tc.State.Chunks) != 2 {
		t.Fatalf("Expected 2 chunks initially, got %d", len(tc.State.Chunks))
	}

	tc.State.Chunks[0].SetCurrentByte(tc.State.Chunks[0].GetEndByte() + 1)
	tc.State.Chunks[0].SetStatus(core.StatusFinished)
	tc.State.Chunks[1].SetStatus(core.StatusDownloading)

	didSplit := tc.SplitLargestChunk()
	if !didSplit {
		t.Fatalf("Expected SplitLargestChunk to return true for 5MB remaining chunk")
	}

	if len(tc.State.Chunks) != 3 {
		t.Fatalf("Expected 3 chunks after split, got %d", len(tc.State.Chunks))
	}

	newChunk := tc.State.Chunks[2]
	if newChunk.GetStatus() != core.StatusPending {
		t.Errorf("Expected new chunk to be StatusPending, got %s", newChunk.GetStatus())
	}
	if newChunk.GetStartByte() <= tc.State.Chunks[1].GetStartByte() {
		t.Errorf("Expected new chunk StartByte %d to be greater than chunk 1 StartByte %d", newChunk.GetStartByte(), tc.State.Chunks[1].GetStartByte())
	}
}

func TestCancelAndResume_KeepPartialFile_CheckpointPersistence(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_cancel_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-cancel-task-%d", time.Now().UnixNano())
	filename := fmt.Sprintf("test_partial_%d.bin", time.Now().UnixNano())
	totalSize := int64(40 * 1024 * 1024) // 40 MB
	threadCount := 4

	tc1 := NewTaskController(context.Background(), taskID, "http://example.com/test_partial.bin", tempDir, filename, threadCount)
	tc1.CleanupCheckpoint()
	defer tc1.CleanupCheckpoint()

	cfg := core.GetEngineConfig()
	cfg.DeletePartialOnFileCancel = false
	core.UpdateEngineConfig(cfg)

	tc1.State.TotalSize = totalSize
	tc1.State.Resumable = true
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)
	_ = os.WriteFile(tc1.State.TempFilePath, []byte("partial-container-data"), 0644)
	tc1.InitializeChunks()

	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetStartByte() + 5*1024*1024)
	tc1.State.Chunks[1].SetCurrentByte(tc1.State.Chunks[1].GetEndByte() + 1)
	tc1.State.Chunks[1].SetStatus(core.StatusFinished)

	if err := tc1.Cancel(); err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	metaFile := core.GetTaskMetaFilePath(taskID)
	if _, err := os.Stat(metaFile); err != nil {
		t.Fatalf("Expected checkpoint file to exist on disk after Cancel, got error: %v", err)
	}

	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/test_partial.bin", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.Resumable = true
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)
	tc2.InitializeChunks()

	if len(tc2.State.Chunks) != threadCount {
		t.Fatalf("Expected %d chunks restored on resume, got %d", threadCount, len(tc2.State.Chunks))
	}

	expectedChunk0Cur := tc2.State.Chunks[0].GetStartByte() + 5*1024*1024
	if tc2.State.Chunks[0].GetCurrentByte() != expectedChunk0Cur {
		t.Errorf("Expected chunk 0 CurrentByte %d, got %d", expectedChunk0Cur, tc2.State.Chunks[0].GetCurrentByte())
	}

	if tc2.State.Chunks[1].GetStatus() != core.StatusFinished {
		t.Errorf("Expected chunk 1 to be Finished, got %s", tc2.State.Chunks[1].GetStatus())
	}
}

func TestSmallFileAndNonRange200OKFallback(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_fallback_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-fallback-%d", time.Now().UnixNano())
	filename := "test_image.png"
	totalSize := int64(128 * 1024) // 128 KB small file

	tc := NewTaskController(context.Background(), taskID, "http://example.com/test_image.png", tempDir, filename, 8)
	tc.State.TotalSize = totalSize
	tc.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc.State.DestFilePath = filepath.Join(tempDir, filename)

	if tc.State.TotalSize < 512*1024 {
		tc.State.ThreadCount = 1
	}
	tc.InitializeChunks()

	if len(tc.State.Chunks) != 1 {
		t.Fatalf("Expected 1 chunk for small file (< 512KB), got %d", len(tc.State.Chunks))
	}

	multiTaskID := fmt.Sprintf("test-multi-fallback-%d", time.Now().UnixNano())
	multiTC := NewTaskController(context.Background(), multiTaskID, "http://example.com/test_image.png", tempDir, filename, 4)
	multiTC.State.TotalSize = 1024 * 1024 // 1 MB
	multiTC.InitializeChunks()

	if len(multiTC.State.Chunks) != 4 {
		t.Fatalf("Expected 4 chunks initially, got %d", len(multiTC.State.Chunks))
	}

	multiTC.FallbackToSingleStream(multiTC.State.Chunks[0])

	if len(multiTC.State.Chunks) != 1 {
		t.Fatalf("Expected 1 chunk after FallbackToSingleStream, got %d", len(multiTC.State.Chunks))
	}
	if multiTC.State.ThreadCount != 1 {
		t.Fatalf("Expected ThreadCount = 1 after fallback, got %d", multiTC.State.ThreadCount)
	}
	if multiTC.State.Chunks[0].GetEndByte() != multiTC.State.TotalSize-1 {
		t.Fatalf("Expected chunk 0 EndByte %d, got %d", multiTC.State.TotalSize-1, multiTC.State.Chunks[0].GetEndByte())
	}
}

func TestTaskController_ChunkErrorTermination(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_err_term_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-err-task-%d", time.Now().UnixNano())
	filename := "error_file.bin"
	totalSize := int64(1024 * 1024) // 1 MB

	tc := NewTaskController(context.Background(), taskID, "http://127.0.0.1:59999/nonexistent", tempDir, filename, 2)
	tc.State.TotalSize = totalSize
	tc.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc.State.DestFilePath = filepath.Join(tempDir, filename)
	tc.InitializeChunks()

	maxRetries := core.GetEngineConfig().MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}
	for _, c := range tc.State.Chunks {
		c.SetRetryCount(maxRetries)
		c.SetStatus(core.StatusError)
	}

	done := make(chan struct{})
	go func() {
		tc.TriggerWorkerCheck()
		go tc.OrchestratorLoop()

		for i := 0; i < 50; i++ {
			tc.State.RLock()
			st := tc.State.Status
			tc.State.RUnlock()
			if st == core.StatusError {
				close(done)
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()

	select {
	case <-done:
		tc.State.RLock()
		defer tc.State.RUnlock()
		if tc.State.Status != core.StatusError {
			t.Fatalf("Expected StatusError, got %s", tc.State.Status)
		}
	case <-time.After(2 * time.Second):
		tc.cancel()
		t.Fatalf("Timed out waiting for OrchestratorLoop to terminate failed task")
	}
}

func TestTaskController_ChunkAutoRetry(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_err_retry_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-retry-task-%d", time.Now().UnixNano())
	filename := "retry_file.bin"
	totalSize := int64(1024 * 1024)

	tc := NewTaskController(context.Background(), taskID, "http://127.0.0.1:59999/test", tempDir, filename, 2)
	tc.State.TotalSize = totalSize
	tc.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc.State.DestFilePath = filepath.Join(tempDir, filename)
	tc.InitializeChunks()

	tc.State.Chunks[0].SetRetryCount(0)
	tc.State.Chunks[0].SetStatus(core.StatusError)

	if tc.State.Chunks[0].GetRetryCount() != 0 {
		t.Fatalf("Expected 0 retries, got %d", tc.State.Chunks[0].GetRetryCount())
	}
	attempt := tc.State.Chunks[0].IncrementRetryCount()
	if attempt != 1 || tc.State.Chunks[0].GetRetryCount() != 1 {
		t.Fatalf("Expected 1 retry attempt, got %d", attempt)
	}
	tc.State.Chunks[0].ResetRetryCount()
	if tc.State.Chunks[0].GetRetryCount() != 0 {
		t.Fatalf("Expected 0 after reset, got %d", tc.State.Chunks[0].GetRetryCount())
	}
}
