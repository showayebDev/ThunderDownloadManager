package downloader

import (
	"os"
	"path/filepath"
	"testing"

	"ThunderDM/src-wails3/storage"
)

func TestResolveUniqueFilename_ThunderdmTempFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_unique_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	engine := GetEngine()

	res1 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res1 != "Windows11.iso" {
		t.Errorf("Expected Windows11.iso, got %s", res1)
	}

	thunderdmPath := filepath.Join(tempDir, "Windows11.iso.thunderdm")
	if err := os.WriteFile(thunderdmPath, []byte("temp-data"), 0644); err != nil {
		t.Fatalf("Failed to write temp .thunderdm file: %v", err)
	}

	res2 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res2 != "Windows11_1.iso" {
		t.Errorf("Expected Windows11_1.iso when .thunderdm exists, got %s", res2)
	}

	partPath := filepath.Join(tempDir, "Windows11_1.iso")
	if err := os.WriteFile(partPath, []byte("finished-data"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	res3 := engine.ResolveUniqueFilename(tempDir, "Windows11.iso")
	if res3 != "Windows11_2.iso" {
		t.Errorf("Expected Windows11_2.iso, got %s", res3)
	}
}

func TestResolveUniqueFilename_DownloadsJSON(t *testing.T) {
	originalJSON, _ := storage.GetDownloadsJSON()
	defer func() {
		if originalJSON != "" {
			_ = storage.SaveDownloads(originalJSON)
		}
	}()

	testSavePath := "D:\\pb\\3"
	testFilename := "Sultan (2016) Hindi 1080p BluRay x264 AAC 5.1 ESub - mkvCinemas.mkv"

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
