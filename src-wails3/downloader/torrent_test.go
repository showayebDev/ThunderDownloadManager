package downloader

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsTorrentURL(t *testing.T) {
	tests := []struct {
		url      string
		expected bool
	}{
		{"magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335380dc1f74c26&dn=Ubuntu", true},
		{"MAGNET:?XT=URN:BTIH:12345", true},
		{"https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso.torrent", true},
		{"http://example.com/file.torrent?token=abc", true},
		{"https://example.com/video.mp4", false},
		{"https://example.com/stream.m3u8", false},
		{"", false},
	}

	for _, tt := range tests {
		result := IsTorrentURL(tt.url)
		if result != tt.expected {
			t.Errorf("IsTorrentURL(%q) = %v; expected %v", tt.url, result, tt.expected)
		}
	}
}

func TestIsTorrentFile(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"C:/Downloads/ubuntu.torrent", true},
		{"/home/user/file.TORRENT", true},
		{"file:///C:/Downloads/file.torrent", true},
		{"C:/Downloads/file.iso", false},
		{"", false},
	}

	for _, tt := range tests {
		result := IsTorrentFile(tt.path)
		if result != tt.expected {
			t.Errorf("IsTorrentFile(%q) = %v; expected %v", tt.path, result, tt.expected)
		}
	}
}

func TestParseTorrentMagnetInfo(t *testing.T) {
	magnet := "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=TestTorrentName&tr=http%3A%2F%2Ftracker.example.com%3A80%2Fannounce"

	info, err := ParseTorrentInfo(magnet)
	if err != nil {
		t.Fatalf("ParseTorrentInfo failed on magnet: %v", err)
	}

	if info == nil {
		t.Fatal("expected non-nil TorrentInfo")
	}

	if info.Name != "TestTorrentName" {
		t.Errorf("expected name 'TestTorrentName', got %q", info.Name)
	}

	if !info.IsMagnet {
		t.Errorf("expected IsMagnet to be true")
	}

	if len(info.Trackers) == 0 {
		t.Errorf("expected at least 1 tracker")
	}
}

func TestTorrentClientInitialization(t *testing.T) {
	client, err := GetGlobalTorrentClient()
	if err != nil {
		t.Fatalf("GetGlobalTorrentClient returned error: %v", err)
	}

	if client == nil {
		t.Fatal("expected non-nil client")
	}
}

func TestNormalizeSavePathForTorrent(t *testing.T) {
	p := NormalizeSavePath("", "Torrents")
	if p == "" {
		t.Error("expected non-empty save path")
	}

	home, _ := os.UserHomeDir()
	expectedSub := filepath.Join(home, "Downloads", "Torrents")
	if filepath.Clean(p) != filepath.Clean(expectedSub) && !filepath.IsAbs(p) {
		t.Errorf("unexpected save path: %s", p)
	}
}
