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
