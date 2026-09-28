package utils

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveExistingFilePath_SanitizedColon(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_resolve_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create actual file on disk with underscore instead of colon
	actualName := "4K ULtra HD _ SAMSUNG UHD Demo_ LED TV.mp4"
	actualPath := filepath.Join(tempDir, actualName)
	if err := os.WriteFile(actualPath, []byte("dummy video content"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Request path with colon (as received from YouTube/UI title)
	queryPath := filepath.Join(tempDir, "4K ULtra HD _ SAMSUNG UHD Demo: LED TV.mp4")
	resolved := ResolveExistingFilePath(queryPath)

	if resolved != actualPath {
		t.Errorf("Expected resolved path %s, got %s", actualPath, resolved)
	}
}

func TestResolveExistingFilePath_FuzzySpacesAndFullWidth(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_resolve_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	actualName := "Reel video _ test description.mp4"
	actualPath := filepath.Join(tempDir, actualName)
	if err := os.WriteFile(actualPath, []byte("dummy"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	queryPath := filepath.Join(tempDir, "Reel video ｜ test description？.mp4")
	resolved := ResolveExistingFilePath(queryPath)

	if resolved != actualPath {
		t.Errorf("Expected resolved path %s, got %s", actualPath, resolved)
	}
}

func TestResolveExistingFilePath_DirectoryTorrent(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_dir_torrent_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a multi-file torrent folder with files inside
	torrentDirName := "The Long Drive.v2024.11.26b.Test"
	torrentDirPath := filepath.Join(tempDir, torrentDirName)
	if err := os.MkdirAll(torrentDirPath, 0755); err != nil {
		t.Fatalf("Failed to create torrent directory: %v", err)
	}
	file1 := filepath.Join(torrentDirPath, "TheLongDrive.exe")
	file2 := filepath.Join(torrentDirPath, "data.bin")
	_ = os.WriteFile(file1, []byte("executable binary data"), 0644)
	_ = os.WriteFile(file2, []byte("game assets and textures"), 0644)

	// 1. Direct directory resolution
	resolved := ResolveExistingFilePath(torrentDirPath)
	if resolved != torrentDirPath {
		t.Errorf("Expected directory path %s, got %s", torrentDirPath, resolved)
	}

	// 2. Directory size calculation
	dirSize := GetDirSize(torrentDirPath)
	expectedSize := int64(len("executable binary data") + len("game assets and textures"))
	if dirSize != expectedSize {
		t.Errorf("Expected directory size %d, got %d", expectedSize, dirSize)
	}
}

func TestResolveExistingFilePath_TorrentsCategorySubfolder(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_torrents_cat_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create Torrents category subfolder
	torrentsSubDir := filepath.Join(tempDir, "Torrents")
	if err := os.MkdirAll(torrentsSubDir, 0755); err != nil {
		t.Fatalf("Failed to create Torrents subfolder: %v", err)
	}

	torrentFile := filepath.Join(torrentsSubDir, "The Long Drive.v2024.11.26b.Test.rar")
	if err := os.WriteFile(torrentFile, []byte("archive contents"), 0644); err != nil {
		t.Fatalf("Failed to create torrent file: %v", err)
	}

	// Query from base directory without "Torrents" in the path
	queryPath := filepath.Join(tempDir, "The Long Drive.v2024.11.26b.Test.rar")
	resolved := ResolveExistingFilePath(queryPath)

	if resolved != torrentFile {
		t.Errorf("Expected resolved path in Torrents subfolder %s, got %s", torrentFile, resolved)
	}
}

func TestResolveExistingFilePath_SiblingCategoryAndNameMismatch(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "thunderdm_test_sibling_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create Compressed category subfolder and save the actual torrent file there
	compressedSubDir := filepath.Join(tempDir, "Compressed")
	_ = os.MkdirAll(compressedSubDir, 0755)

	actualFile := filepath.Join(compressedSubDir, "The Long Drive.v2024.11.26b.Test.rar")
	_ = os.WriteFile(actualFile, []byte("game archive bytes"), 0644)

	// User/UI queries with category "Torrents" and magnet display name "The Long Drive v2024.11.26b" (no .rar, spaces instead of dots)
	torrentsSubDir := filepath.Join(tempDir, "Torrents")
	queryPath := filepath.Join(torrentsSubDir, "The Long Drive v2024.11.26b")

	resolved := ResolveExistingFilePath(queryPath)
	if resolved != actualFile {
		t.Errorf("Expected resolved path %s, got %s", actualFile, resolved)
	}
}
