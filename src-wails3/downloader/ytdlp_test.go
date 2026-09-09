package downloader

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsYTDLPURL(t *testing.T) {
	tests := []struct {
		url      string
		expected bool
	}{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", true},
		{"https://youtu.be/dQw4w9WgXcQ", true},
		{"https://vimeo.com/76979871", true},
		{"https://www.tiktok.com/@user/video/123456789", true},
		{"https://www.facebook.com/watch/?v=10153231379946729", true},
		{"https://x.com/user/status/123456789", true},
		{"https://example.com/file.iso", false},
		{"https://example.com/stream/index.m3u8", false},
	}

	for _, tt := range tests {
		res := IsYTDLPURL(tt.url)
		if res != tt.expected {
			t.Errorf("IsYTDLPURL(%q) = %v; expected %v", tt.url, res, tt.expected)
		}
	}
}

func TestParseYTDLPLine(t *testing.T) {
	line1 := "[download]  45.5% of  120.50MiB at  4.50MiB/s ETA 00:15"
	percent, total, dl, speed, eta, isMerging, matched := parseYTDLPLine(line1)

	if !matched {
		t.Fatalf("Expected line1 to match regex, got false")
	}
	if percent != 45.5 {
		t.Errorf("Expected percent 45.5, got %v", percent)
	}
	if total != 120*1024*1024+int64(0.50*1024*1024) {
		t.Errorf("Expected total around 126353408, got %v", total)
	}
	if dl == 0 {
		t.Errorf("Expected dl > 0, got %v", dl)
	}
	if math.Abs(speed-4.50*1024*1024) > 1 {
		t.Errorf("Expected speed ~4718592, got %v", speed)
	}
	if eta != 15 {
		t.Errorf("Expected ETA 15s, got %v", eta)
	}
	if isMerging {
		t.Errorf("Expected isMerging false for download line")
	}

	line2 := "[Merger] Merging formats into \"C:\\Users\\User\\Downloads\\video.mp4\""
	_, _, _, _, _, isMerging2, matched2 := parseYTDLPLine(line2)
	if !matched2 || !isMerging2 {
		t.Errorf("Expected merger line to be recognized, matched=%v, isMerging=%v", matched2, isMerging2)
	}

	line3 := "[download] Resuming download at byte 16166725"
	_, _, dl3, _, _, isMerging3, matched3 := parseYTDLPLine(line3)
	if !matched3 || dl3 != 16166725 || isMerging3 {
		t.Errorf("Expected resume byte line to be recognized with dl=16166725, got dl=%v, matched=%v", dl3, matched3)
	}
}

func TestCleanYTDLPTempFiles(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ytdlp_cleanup_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create dummy temp files
	f1 := filepath.Join(tempDir, "video_1.f623.mp4.part")
	f2 := filepath.Join(tempDir, "video_1.f623.mp4.part-Frag6.part")
	f3 := filepath.Join(tempDir, "video_1.f623.mp4.ytdl")
	fOther := filepath.Join(tempDir, "other_file.txt")

	_ = os.WriteFile(f1, []byte("part1"), 0644)
	_ = os.WriteFile(f2, []byte("frag6"), 0644)
	_ = os.WriteFile(f3, []byte("ytdl"), 0644)
	_ = os.WriteFile(fOther, []byte("keep"), 0644)

	CleanYTDLPTempFiles(tempDir, "video_1.mp4")

	if _, err := os.Stat(f1); err == nil {
		t.Errorf("Expected %s to be deleted", f1)
	}
	if _, err := os.Stat(f2); err == nil {
		t.Errorf("Expected %s to be deleted", f2)
	}
	if _, err := os.Stat(f3); err == nil {
		t.Errorf("Expected %s to be deleted", f3)
	}
	if _, err := os.Stat(fOther); err != nil {
		t.Errorf("Expected %s to be preserved", fOther)
	}
}

func TestSanitizeFilename(t *testing.T) {
	// Test the exact Facebook reel title with emojis and invalid Windows characters
	fbTitle := `1.6K views · 296 reactions ｜ NSU,BRAC,IUB,AIUB,EWU,DIU and other university students-you can earn upto lakhs in the next 1 year if you decide to take up this course🎯 You are spending lakhs every semester,why not change your fate with this small investment？ Check comments for group ⤵️💬 ｜ Tamjid Al Islam [1051163614181879].mp4`
	sanitized := SanitizeFilename(fbTitle)

	if strings.ContainsAny(sanitized, `<>:"/\|?*`) {
		t.Errorf("Sanitized filename still contains invalid characters: %s", sanitized)
	}
	if strings.Contains(sanitized, "｜") || strings.Contains(sanitized, "？") {
		t.Errorf("Sanitized filename still contains full-width characters: %s", sanitized)
	}
	if len(sanitized) > 120 {
		t.Errorf("Sanitized filename length exceeds 120 chars: %d (%s)", len(sanitized), sanitized)
	}
	if !strings.HasSuffix(sanitized, ".mp4") {
		t.Errorf("Expected .mp4 extension preserved, got %s", sanitized)
	}

	// Test filename with typographic quote
	ytTitle := `Inside one of the world’s most efficient Data Centers.mp4`
	ytSanitized := SanitizeFilename(ytTitle)
	if strings.Contains(ytSanitized, "’") {
		t.Errorf("Expected typographic quote to be replaced, got %s", ytSanitized)
	}
	if ytSanitized != "Inside one of the world's most efficient Data Centers.mp4" {
		t.Errorf("Expected Inside one of the world's most efficient Data Centers.mp4, got %s", ytSanitized)
	}

	// Test normal filenames
	if res := SanitizeFilename("test:file?.mkv"); res != "test_file_.mkv" {
		t.Errorf("Expected test_file_.mkv, got %s", res)
	}
	if res := SanitizeFilename(""); res != "download" {
		t.Errorf("Expected download for empty string, got %s", res)
	}
}

func TestYTDLPMultiStreamProgress(t *testing.T) {
	task := NewYTDLPTaskController(nil, "test-stream-1", "https://example.com/video", "C:\\Downloads", "video.mp4", "best")

	// Stream 1 (Video) starts
	task.processOutputLine("[download] Destination: video.f616.mp4")
	task.processOutputLine("[download]  50.0% of  866.76MiB at  10.00MiB/s ETA 00:43")

	if task.totalBytes.Load() < 860*1024*1024 {
		t.Errorf("Expected totalBytes ~866.76MiB, got %d", task.totalBytes.Load())
	}

	task.processOutputLine("[download] 100% of  866.76MiB in 01:20")

	// Stream 2 (Audio) starts
	task.processOutputLine("[download] Destination: video.f251.webm")
	task.processOutputLine("[download] 100% of   12.05MiB in 00:01")

	vBytes := 866.76 * 1024 * 1024
	aBytes := 12.05 * 1024 * 1024
	expectedCombinedTotal := int64(vBytes) + int64(aBytes)
	actualTotal := task.totalBytes.Load()
	actualDL := task.downloaded.Load()

	// Both combined should be > 870 MiB
	if actualTotal < 870*1024*1024 {
		t.Errorf("Expected combined total ~878.81MiB, got %d bytes", actualTotal)
	}
	if actualDL < 870*1024*1024 {
		t.Errorf("Expected combined downloaded ~878.81MiB, got %d bytes", actualDL)
	}

	t.Logf("Successfully verified multi-stream tracking: Total=%d, DL=%d (expected ~%d)", actualTotal, actualDL, expectedCombinedTotal)
}

func TestCheckAndUpdateStructure(t *testing.T) {
	client := &Client{Executable: "non-existent-binary-12345"}
	res, err := client.CheckAndUpdate()
	if err != nil {
		t.Fatalf("Unexpected error for check client: %v", err)
	}
	if res.Installed != client.IsInstalled() {
		t.Errorf("Expected Installed %v, got %v", client.IsInstalled(), res.Installed)
	}
}

func TestFFmpegHelpers(t *testing.T) {
	loc := GetFFmpegLocation()
	t.Logf("GetFFmpegLocation: %s", loc)
	installed := IsFFmpegInstalled()
	t.Logf("IsFFmpegInstalled: %v", installed)
	if installed {
		ver, err := CheckFFmpegVersion()
		t.Logf("CheckFFmpegVersion: %s (err: %v)", ver, err)
		if ver == "" {
			t.Errorf("Expected non-empty FFmpeg version")
		}
	}
}

func TestOwnToolsIsolation(t *testing.T) {
	// Verify GetYTDLPExecutable strictly checks only ThunderDM own locations
	ytdlpPath := GetYTDLPExecutable()
	if ytdlpPath != "" {
		home, _ := os.UserHomeDir()
		thunderdmBin := filepath.Join(home, ".thunderdm", "bin")
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		isOwnPath := strings.HasPrefix(filepath.Clean(ytdlpPath), filepath.Clean(thunderdmBin)) ||
			strings.HasPrefix(filepath.Clean(ytdlpPath), filepath.Clean(exeDir))
		if !isOwnPath {
			t.Errorf("GetYTDLPExecutable returned path outside ThunderDM dirs: %s", ytdlpPath)
		}
	}

	// Verify GetFFmpegExecutable strictly checks only ThunderDM own locations
	ffmpegPath := GetFFmpegExecutable()
	if ffmpegPath != "" {
		home, _ := os.UserHomeDir()
		thunderdmBin := filepath.Join(home, ".thunderdm", "bin")
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		isOwnPath := strings.HasPrefix(filepath.Clean(ffmpegPath), filepath.Clean(thunderdmBin)) ||
			strings.HasPrefix(filepath.Clean(ffmpegPath), filepath.Clean(exeDir))
		if !isOwnPath {
			t.Errorf("GetFFmpegExecutable returned path outside ThunderDM dirs: %s", ffmpegPath)
		}
	}

	// Verify GetFFprobeExecutable strictly checks only ThunderDM own locations
	ffprobePath := GetFFprobeExecutable()
	if ffprobePath != "" {
		home, _ := os.UserHomeDir()
		thunderdmBin := filepath.Join(home, ".thunderdm", "bin")
		exePath, _ := os.Executable()
		exeDir := filepath.Dir(exePath)

		isOwnPath := strings.HasPrefix(filepath.Clean(ffprobePath), filepath.Clean(thunderdmBin)) ||
			strings.HasPrefix(filepath.Clean(ffprobePath), filepath.Clean(exeDir))
		if !isOwnPath {
			t.Errorf("GetFFprobeExecutable returned path outside ThunderDM dirs: %s", ffprobePath)
		}
	}
}





