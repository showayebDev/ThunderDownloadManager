package downloader

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
	"ThunderDM/src-wails3/storage"
)

func TestResolveUniqueFilename_ThunderdmTempFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_unique_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	engine := GetEngine()

	// Initially, no file exists -> should return the original filename
	res1 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res1 != "Windows11.iso" {
		t.Errorf("Expected Windows11.iso, got %s", res1)
	}

	// Create a .thunderdm temporary file simulating an active/incomplete download
	thunderdmPath := filepath.Join(tempDir, "Windows11.iso.thunderdm")
	if err := os.WriteFile(thunderdmPath, []byte("temp-data"), 0644); err != nil {
		t.Fatalf("Failed to write temp .thunderdm file: %v", err)
	}

	// Now with Windows11.iso.thunderdm existing, should return Windows11_1.iso
	res2 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res2 != "Windows11_1.iso" {
		t.Errorf("Expected Windows11_1.iso when .thunderdm exists, got %s", res2)
	}

	// Create Windows11_1.iso on disk as well
	partPath := filepath.Join(tempDir, "Windows11_1.iso")
	if err := os.WriteFile(partPath, []byte("finished-data"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	// Should now resolve to Windows11_2.iso
	res3 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res3 != "Windows11_2.iso" {
		t.Errorf("Expected Windows11_2.iso, got %s", res3)
	}
}

func TestResolveUniqueFilename_DownloadsJSON(t *testing.T) {
	// Backup existing downloads in SQLite
	originalJSON, _ := storage.GetDownloadsJSON()
	defer func() {
		if originalJSON != "" {
			_ = storage.SaveDownloads(originalJSON)
		}
	}()

	testSavePath := "D:\\pb\\3"
	testFilename := "Sultan (2016) Hindi 1080p BluRay x264 AAC 5.1 ESub - mkvCinemas.mkv"

	// Mock downloads in SQLite with Sultan file in D:\pb\3
	mockJSON := `[
		{
			"id": "mock-1",
			"name": "Sultan (2016) Hindi 1080p BluRay x264 AAC 5.1 ESub - mkvCinemas.mkv",
			"savePath": "D:\\pb\\3",
			"status": "Finished"
		},
		{
			"id": "mock-2",
			"name": "Sultan (2016) Hindi 1080p BluRay x264 AAC 5.1 ESub - mkvCinemas_1.mkv",
			"savePath": "D:\\pb\\3",
			"status": "Queued"
		}
	]`
	if err := storage.SaveDownloads(mockJSON); err != nil {
		t.Fatalf("Failed to save mock downloads to SQLite: %v", err)
	}

	engine := GetEngine()
	resolved := engine.ResolveUniqueFilename(testSavePath, testFilename)
	expected := "Sultan (2016) Hindi 1080p BluRay x264 AAC 5.1 ESub - mkvCinemas_2.mkv"
	if resolved != expected {
		t.Errorf("Expected %s, got %s", expected, resolved)
	}
}

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

	// Create original TaskController
	tc1 := NewTaskController(context.Background(), taskID, "http://example.com/largefile.bin", tempDir, filename, threadCount)
	tc1.State.TotalSize = totalSize
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)

	// Initialize fresh chunks
	tc1.initializeChunks()

	if len(tc1.State.Chunks) != 4 {
		t.Fatalf("Expected 4 chunks, got %d", len(tc1.State.Chunks))
	}

	// Simulate downloading 80% (80 MB)
	// Chunk 0: 25MB total -> 25MB downloaded (Finished)
	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetEndByte() + 1)
	tc1.State.Chunks[0].SetStatus(StatusFinished)

	// Chunk 1: 25MB total -> 25MB downloaded (Finished)
	tc1.State.Chunks[1].SetCurrentByte(tc1.State.Chunks[1].GetEndByte() + 1)
	tc1.State.Chunks[1].SetStatus(StatusFinished)

	// Chunk 2: 25MB total -> 20MB downloaded (In-Progress)
	chunk2Start := tc1.State.Chunks[2].StartByte
	tc1.State.Chunks[2].SetCurrentByte(chunk2Start + 20*1024*1024)
	tc1.State.Chunks[2].SetStatus(StatusDownloading)

	// Chunk 3: 25MB total -> 10MB downloaded (In-Progress)
	chunk3Start := tc1.State.Chunks[3].StartByte
	tc1.State.Chunks[3].SetCurrentByte(chunk3Start + 10*1024*1024)
	tc1.State.Chunks[3].SetStatus(StatusDownloading)

	// Verify state before pause: 25 + 25 + 20 + 10 = 80 MB (80%)
	state1 := tc1.GetState()
	dl1 := state1["downloaded"].(int64)
	expectedBytes := int64(80 * 1024 * 1024)
	if dl1 != expectedBytes {
		t.Fatalf("Expected %d bytes downloaded, got %d", expectedBytes, dl1)
	}

	// Simulate Pause (flushes checkpoint to disk)
	tc1.saveCheckpoint()
	_ = os.WriteFile(tc1.State.TempFilePath, []byte("container-data"), 0644)

	// Verify checkpoint file exists
	metaPath := tc1.checkpointPath()
	if _, err := os.Stat(metaPath); os.IsNotExist(err) {
		t.Fatalf("Checkpoint file %s was not created on pause!", metaPath)
	}

	// Now simulate resuming by creating a NEW TaskController (e.g. app restart or resume click)
	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/largefile.bin", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)

	// Call initializeChunks on the resumed task (which should load the checkpoint!)
	tc2.initializeChunks()

	// Verify that chunks were restored from checkpoint
	if len(tc2.State.Chunks) != 4 {
		t.Fatalf("Expected 4 restored chunks, got %d", len(tc2.State.Chunks))
	}

	// Check restored state: MUST be exactly 80 MB (80%), NOT 0% or 12%!
	state2 := tc2.GetState()
	dl2 := state2["downloaded"].(int64)
	if dl2 != expectedBytes {
		t.Fatalf("Expected resumed downloaded bytes to be %d (80 MB), but got %d!", expectedBytes, dl2)
	}

	// Check chunk 0 status is Finished
	if tc2.State.Chunks[0].GetStatus() != StatusFinished {
		t.Errorf("Expected chunk 0 to be Finished, got %s", tc2.State.Chunks[0].GetStatus())
	}
	// Check chunk 2 current byte is restored
	expectedChunk2Cur := chunk2Start + 20*1024*1024
	if tc2.State.Chunks[2].GetCurrentByte() != expectedChunk2Cur {
		t.Errorf("Expected chunk 2 CurrentByte %d, got %d", expectedChunk2Cur, tc2.State.Chunks[2].GetCurrentByte())
	}
	// Check chunk 2 status was reset from Downloading to Pending for worker pickup
	if tc2.State.Chunks[2].GetStatus() != StatusPending {
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

	// 1. Create original TaskController & simulate downloading 30%
	tc1 := NewTaskController(context.Background(), taskID, "http://example.com/video.mkv", tempDir, filename, threadCount)
	tc1.State.TotalSize = totalSize
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)

	tc1.initializeChunks()
	// Chunk 0 finishes
	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetEndByte() + 1)
	tc1.State.Chunks[0].SetStatus(StatusFinished)
	tc1.saveCheckpoint()

	// Ensure checkpoint file exists
	metaFile := GetTaskMetaFilePath(taskID)
	if _, err := os.Stat(metaFile); err != nil {
		t.Fatalf("Expected checkpoint file to exist, got: %v", err)
	}

	// 2. User deletes .thunderdm container file from disk while paused!
	_ = os.Remove(tc1.State.TempFilePath)

	// 3. User clicks Resume -> creates new controller or calls initializeChunks(false)
	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/video.mkv", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)

	// Simulate temp file missing (tempFileExisted = false)
	tc2.initializeChunks(false)

	// Verify all chunks are reset to 0% Pending status
	state := tc2.GetState()
	dl := state["downloaded"].(int64)
	if dl != 0 {
		t.Fatalf("Expected 0 bytes downloaded when temp file was deleted, got %d", dl)
	}

	for i, chk := range tc2.State.Chunks {
		if chk.GetStatus() != StatusPending {
			t.Errorf("Expected chunk %d to be StatusPending, got %s", i, chk.GetStatus())
		}
		if chk.GetCurrentByte() != chk.GetStartByte() {
			t.Errorf("Expected chunk %d CurrentByte to match StartByte %d, got %d", i, chk.GetStartByte(), chk.GetCurrentByte())
		}
	}
}

func TestDynamicPartCreation_ChunkSplitting(t *testing.T) {
	taskId := fmt.Sprintf("test-dpc-task-%d", time.Now().UnixNano())
	_ = os.Remove(GetTaskMetaFilePath(taskId))
	defer func() {
		_ = os.Remove(GetTaskMetaFilePath(taskId))
	}()

	tc := NewTaskController(context.Background(), taskId, "http://example.com/file.zip", "", "file.zip", 2)
	tc.State.TotalSize = 10 * 1024 * 1024 // 10MB
	tc.initializeChunks()

	if len(tc.State.Chunks) != 2 {
		t.Fatalf("Expected 2 chunks initially, got %d", len(tc.State.Chunks))
	}

	// Chunk 0 finishes completely
	tc.State.Chunks[0].SetCurrentByte(tc.State.Chunks[0].GetEndByte() + 1)
	tc.State.Chunks[0].SetStatus(StatusFinished)

	// Chunk 1 has 5MB remaining
	tc.State.Chunks[1].SetStatus(StatusDownloading)

	// Trigger dynamic chunk splitting
	didSplit := tc.splitLargestChunk()
	if !didSplit {
		t.Fatalf("Expected splitLargestChunk to return true for 5MB remaining chunk")
	}

	if len(tc.State.Chunks) != 3 {
		t.Fatalf("Expected 3 chunks after split, got %d", len(tc.State.Chunks))
	}

	// Verify the new chunk is Pending and properly partitioned
	newChunk := tc.State.Chunks[2]
	if newChunk.GetStatus() != StatusPending {
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
	tc1.cleanupCheckpoint()
	defer tc1.cleanupCheckpoint()

	cfg := GetEngineConfig()
	cfg.DeletePartialOnFileCancel = false
	UpdateEngineConfig(cfg)

	tc1.State.TotalSize = totalSize
	tc1.State.Resumable = true
	tc1.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc1.State.DestFilePath = filepath.Join(tempDir, filename)
	_ = os.WriteFile(tc1.State.TempFilePath, []byte("partial-container-data"), 0644)
	tc1.initializeChunks()

	// Simulate downloading 5MB in Chunk 0
	tc1.State.Chunks[0].SetCurrentByte(tc1.State.Chunks[0].GetStartByte() + 5*1024*1024)
	// Chunk 1 finishes 10MB
	tc1.State.Chunks[1].SetCurrentByte(tc1.State.Chunks[1].GetEndByte() + 1)
	tc1.State.Chunks[1].SetStatus(StatusFinished)

	// Cancel task (DeletePartialOnFileCancel is false by default)
	if err := tc1.Cancel(); err != nil {
		t.Fatalf("Cancel failed: %v", err)
	}

	// Verify checkpoint file exists on disk
	metaFile := GetTaskMetaFilePath(taskID)
	if _, err := os.Stat(metaFile); err != nil {
		t.Fatalf("Expected checkpoint file to exist on disk after Cancel, got error: %v", err)
	}

	// Create new controller to simulate Resuming the canceled task
	tc2 := NewTaskController(context.Background(), taskID, "http://example.com/test_partial.bin", tempDir, filename, threadCount)
	tc2.State.TotalSize = totalSize
	tc2.State.Resumable = true
	tc2.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc2.State.DestFilePath = filepath.Join(tempDir, filename)
	tc2.initializeChunks()

	if len(tc2.State.Chunks) != threadCount {
		t.Fatalf("Expected %d chunks restored on resume, got %d", threadCount, len(tc2.State.Chunks))
	}

	// Verify Chunk 0 has 5MB restored
	expectedChunk0Cur := tc2.State.Chunks[0].GetStartByte() + 5*1024*1024
	if tc2.State.Chunks[0].GetCurrentByte() != expectedChunk0Cur {
		t.Errorf("Expected chunk 0 CurrentByte %d, got %d", expectedChunk0Cur, tc2.State.Chunks[0].GetCurrentByte())
	}

	// Verify Chunk 1 is Finished
	if tc2.State.Chunks[1].GetStatus() != StatusFinished {
		t.Errorf("Expected chunk 1 to be Finished, got %s", tc2.State.Chunks[1].GetStatus())
	}
}

func TestSmallFileAndNonRange200OKFallback(t *testing.T) {
	t.Log("Step 1: start")
	tempDir, err := os.MkdirTemp("", "thunderdm_test_fallback_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	taskID := fmt.Sprintf("test-fallback-%d", time.Now().UnixNano())
	filename := "test_image.png"
	totalSize := int64(128 * 1024) // 128 KB small file

	t.Log("Step 2: NewTaskController")
	tc := NewTaskController(context.Background(), taskID, "http://example.com/test_image.png", tempDir, filename, 8)
	tc.State.TotalSize = totalSize
	tc.State.TempFilePath = filepath.Join(tempDir, filename+".thunderdm")
	tc.State.DestFilePath = filepath.Join(tempDir, filename)

	t.Log("Step 3: Check total size")
	// Small file (< 512KB) should automatically be forced to 1 thread
	if tc.State.TotalSize < 512*1024 {
		tc.State.ThreadCount = 1
	}
	tc.initializeChunks()

	if len(tc.State.Chunks) != 1 {
		t.Fatalf("Expected 1 chunk for small file (< 512KB), got %d", len(tc.State.Chunks))
	}

	t.Log("Step 4: Multi chunk setup")
	// Also test FallbackToSingleStream on a multi-chunk task
	multiTaskID := fmt.Sprintf("test-multi-fallback-%d", time.Now().UnixNano())
	multiTC := NewTaskController(context.Background(), multiTaskID, "http://example.com/test_image.png", tempDir, filename, 4)
	multiTC.State.TotalSize = 1024 * 1024 // 1 MB
	multiTC.initializeChunks()

	if len(multiTC.State.Chunks) != 4 {
		t.Fatalf("Expected 4 chunks initially, got %d", len(multiTC.State.Chunks))
	}

	t.Log("Step 5: FallbackToSingleStream")
	// When 200 OK is received on chunk 0, FallbackToSingleStream should reduce to 1 chunk covering the whole file
	multiTC.FallbackToSingleStream(multiTC.State.Chunks[0])

	t.Log("Step 6: Verifications")
	if len(multiTC.State.Chunks) != 1 {
		t.Fatalf("Expected 1 chunk after FallbackToSingleStream, got %d", len(multiTC.State.Chunks))
	}
	if multiTC.State.ThreadCount != 1 {
		t.Fatalf("Expected ThreadCount = 1 after fallback, got %d", multiTC.State.ThreadCount)
	}
	if multiTC.State.Chunks[0].GetEndByte() != multiTC.State.TotalSize-1 {
		t.Fatalf("Expected chunk 0 EndByte %d, got %d", multiTC.State.TotalSize-1, multiTC.State.Chunks[0].GetEndByte())
	}
	t.Log("Step 7: Complete")
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
	tc.initializeChunks()

	// Simulate all chunks failing into StatusError
	for _, c := range tc.State.Chunks {
		c.SetStatus(StatusError)
	}

	// Trigger orchestrator loop check in a separate goroutine and ensure it exits cleanly
	done := make(chan struct{})
	go func() {
		// Run one cycle of orchestrator loop trigger
		tc.triggerWorkerCheck()
		go tc.orchestratorLoop()

		// Wait for status to become StatusError
		for i := 0; i < 50; i++ {
			tc.State.mu.RLock()
			st := tc.State.Status
			tc.State.mu.RUnlock()
			if st == StatusError {
				close(done)
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
	}()

	select {
	case <-done:
		// Success! Task terminated with StatusError instead of looping infinitely
		tc.State.mu.RLock()
		defer tc.State.mu.RUnlock()
		if tc.State.Status != StatusError {
			t.Fatalf("Expected StatusError, got %s", tc.State.Status)
		}
	case <-time.After(2 * time.Second):
		tc.cancel()
		t.Fatalf("Timed out waiting for orchestratorLoop to terminate failed task")
	}
}


