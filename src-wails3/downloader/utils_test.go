package downloader

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeSavePath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("Cannot get user home dir")
	}

	defaultDL := filepath.Join(home, "Downloads")

	// Test 1: Empty path defaults to base download dir
	p1 := NormalizeSavePath("")
	if !filepath.IsAbs(p1) {
		t.Errorf("Expected absolute path, got: %s", p1)
	}

	// Test 2: Relative "Pictures" category gets resolved against base dir
	p2 := NormalizeSavePath("Pictures")
	if !filepath.IsAbs(p2) {
		t.Errorf("Expected absolute path for 'Pictures', got: %s", p2)
	}
	if !strings.HasSuffix(p2, "Pictures") {
		t.Errorf("Expected path ending with 'Pictures', got: %s", p2)
	}

	// Test 3: Relative "Videos" category gets resolved against base dir
	p3 := NormalizeSavePath("Videos")
	if !filepath.IsAbs(p3) {
		t.Errorf("Expected absolute path for 'Videos', got: %s", p3)
	}
	if !strings.HasSuffix(p3, "Videos") {
		t.Errorf("Expected path ending with 'Videos', got: %s", p3)
	}

	// Test 4: Already absolute path remains preserved
	p4 := NormalizeSavePath(defaultDL)
	if filepath.Clean(p4) != filepath.Clean(defaultDL) {
		t.Errorf("Expected %s, got: %s", defaultDL, p4)
	}
}
