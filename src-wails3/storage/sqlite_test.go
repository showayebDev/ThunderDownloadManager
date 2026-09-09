package storage

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestSQLiteRelationalStorage(t *testing.T) {
	tempDB := filepath.Join(t.TempDir(), "test_thunderdm.db")
	SetCustomDBPath(tempDB)
	defer SetCustomDBPath("")

	db, err := InitStorage()
	if err != nil {
		t.Fatalf("Failed to initialize SQLite storage: %v", err)
	}
	if db == nil {
		t.Fatal("Expected non-nil db instance")
	}

	// 1. Test KV Store
	testKey := "test_settings_key"
	testVal := `{"theme":"Dark","storageMode":"sqlite"}`

	err = SetKV(testKey, testVal)
	if err != nil {
		t.Fatalf("SetKV failed: %v", err)
	}

	val, err := GetKV(testKey)
	if err != nil {
		t.Fatalf("GetKV failed: %v", err)
	}
	if val != testVal {
		t.Fatalf("Expected '%s', got '%s'", testVal, val)
	}

	// 2. Test Relational Downloads Table
	sampleDownloads := `[
		{
			"id": "dl_101",
			"name": "Ubuntu_24.04.iso",
			"category": "Programs",
			"url": "https://releases.ubuntu.com/24.04/ubuntu.iso",
			"size": 4294967296.5,
			"downloaded": 2147483648.25,
			"status": "Downloading",
			"speed": 10038535.811290465,
			"speedLimit": 5242880.0,
			"timeLeft": "03:20",
			"dateAdded": "2026-09-08 09:00:00",
			"savePath": "C:\\Downloads",
			"resumeSupport": "Yes",
			"threadCount": 16,
			"orderIndex": 1,
			"chunks": [{"id": 1, "status": "Downloading", "downloaded": 1000, "total": 2000}]
		},
		{
			"id": "dl_102",
			"name": "Tutorial.mp4",
			"category": "Videos",
			"url": "https://example.com/video.mp4",
			"size": 52428800,
			"downloaded": 52428800,
			"status": "Finished",
			"speed": 0,
			"timeLeft": "Finished",
			"dateAdded": "2026-09-08 08:30:00",
			"savePath": "C:\\Downloads",
			"resumeSupport": "Yes",
			"threadCount": 8,
			"orderIndex": 2,
			"chunks": []
		}
	]`

	err = SaveDownloads(sampleDownloads)
	if err != nil {
		t.Fatalf("SaveDownloads failed: %v", err)
	}

	// Verify querying from relational table
	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM downloads WHERE status = 'Downloading';`).Scan(&count)
	if err != nil {
		t.Fatalf("QueryRow on downloads failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("Expected 1 downloading item in downloads table, got %d", count)
	}

	// Test GetDownloadsJSON
	retrievedJSON, err := GetDownloadsJSON()
	if err != nil {
		t.Fatalf("GetDownloadsJSON failed: %v", err)
	}

	var parsedItems []DBDownloadItem
	err = json.Unmarshal([]byte(retrievedJSON), &parsedItems)
	if err != nil {
		t.Fatalf("Failed to parse retrieved downloads JSON: %v", err)
	}
	if len(parsedItems) != 2 {
		t.Fatalf("Expected 2 items, got %d", len(parsedItems))
	}
	if parsedItems[0].ID != "dl_101" || parsedItems[0].Name != "Ubuntu_24.04.iso" {
		t.Fatalf("Item data mismatch in retrieved downloads: %+v", parsedItems[0])
	}

	// 3. Test Relational Queues Table
	sampleQueues := `[
		{
			"id": "main",
			"name": "Main",
			"maxConcurrent": 3,
			"scheduleEnabled": true,
			"activeDays": ["Monday", "Wednesday", "Friday"],
			"enableAutoStartTime": true,
			"autoStartTime": "01:00",
			"enableAutoStopTime": true,
			"autoStopTime": "06:00",
			"isRunning": false,
			"showRealTimeProgress": true,
			"showCompletionWindow": false
		}
	]`

	err = SaveQueues(sampleQueues)
	if err != nil {
		t.Fatalf("SaveQueues failed: %v", err)
	}

	var queueCount int
	err = db.QueryRow(`SELECT COUNT(*) FROM queues WHERE id = 'main';`).Scan(&queueCount)
	if err != nil {
		t.Fatalf("QueryRow on queues failed: %v", err)
	}
	if queueCount != 1 {
		t.Fatalf("Expected 1 queue, got %d", queueCount)
	}

	retrievedQueuesJSON, err := GetQueuesJSON()
	if err != nil {
		t.Fatalf("GetQueuesJSON failed: %v", err)
	}

	var parsedQueues []DBQueueItem
	err = json.Unmarshal([]byte(retrievedQueuesJSON), &parsedQueues)
	if err != nil {
		t.Fatalf("Failed to parse retrieved queues JSON: %v", err)
	}
	if len(parsedQueues) != 1 || parsedQueues[0].MaxConcurrent != 3 || !parsedQueues[0].ShowRealTimeProgress || parsedQueues[0].ShowCompletionWindow {
		t.Fatalf("Queue data mismatch: %+v", parsedQueues[0])
	}
}
