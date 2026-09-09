package downloader

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseHLSContent_Master(t *testing.T) {
	lines := []string{
		"#EXTM3U",
		"#EXT-X-VERSION:3",
		"#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
		"360p.m3u8",
		"#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=842x480",
		"480p.m3u8",
		"#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
		"720p.m3u8",
	}

	res, err := parseMasterPlaylist(lines, "https://example.com/hls/master.m3u8")
	if err != nil {
		t.Fatalf("Failed to parse master playlist: %v", err)
	}

	if len(res.Variants) != 3 {
		t.Fatalf("Expected 3 variants, got %d", len(res.Variants))
	}

	if res.Variants[2].Bandwidth != 2800000 {
		t.Errorf("Expected bandwidth 2800000, got %d", res.Variants[2].Bandwidth)
	}

	if res.Variants[2].URL != "https://example.com/hls/720p.m3u8" {
		t.Errorf("Expected resolved URL https://example.com/hls/720p.m3u8, got %s", res.Variants[2].URL)
	}
}

func TestParseHLSContent_Media(t *testing.T) {
	lines := []string{
		"#EXTM3U",
		"#EXT-X-VERSION:3",
		"#EXT-X-TARGETDURATION:10",
		"#EXT-X-MEDIA-SEQUENCE:100",
		"#EXTINF:9.009,",
		"segment_100.ts",
		"#EXTINF:9.009,",
		"segment_101.ts",
		"#EXTINF:4.500,",
		"segment_102.ts",
		"#EXT-X-ENDLIST",
	}

	res, err := parseMediaPlaylist(lines, "https://example.com/videos/index.m3u8")
	if err != nil {
		t.Fatalf("Failed to parse media playlist: %v", err)
	}

	if len(res.Segments) != 3 {
		t.Fatalf("Expected 3 segments, got %d", len(res.Segments))
	}

	if res.Segments[0].SequenceNum != 100 {
		t.Errorf("Expected sequence 100, got %d", res.Segments[0].SequenceNum)
	}

	if res.Segments[0].URL != "https://example.com/videos/segment_100.ts" {
		t.Errorf("Expected URL https://example.com/videos/segment_100.ts, got %s", res.Segments[0].URL)
	}

	if res.TotalDuration < 22.5 {
		t.Errorf("Expected total duration ~22.518, got %f", res.TotalDuration)
	}
}

func TestAES128Decryption(t *testing.T) {
	key := []byte("0123456789abcdef")
	iv := ParseIV("0x00000000000000000000000000000001", 1)

	plaintext := []byte("Hello ThunderDM HLS Video Streaming System! 1234567890")

	// PKCS7 pad plaintext to multiple of 16
	padLen := aes.BlockSize - (len(plaintext) % aes.BlockSize)
	padded := make([]byte, len(plaintext)+padLen)
	copy(padded, plaintext)
	for i := len(plaintext); i < len(padded); i++ {
		padded[i] = byte(padLen)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("Cipher creation failed: %v", err)
	}

	ciphertext := make([]byte, len(padded))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, padded)

	// Decrypt using our HLS decryptor
	decrypted, err := DecryptAES128Segment(ciphertext, key, iv)
	if err != nil {
		t.Fatalf("Decryption failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Errorf("Decrypted data mismatch. Got %s, expected %s", string(decrypted), string(plaintext))
	}
}

func TestLiveMuxStream(t *testing.T) {
	url := "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	playlist, err := FetchAndParseHLS(ctx, SharedHTTPClient, url)
	if err != nil {
		t.Skipf("Skipping live stream test (network/proxy unreachable): %v", err)
		return
	}

	if len(playlist.Segments) == 0 {
		t.Fatalf("No segments parsed from live stream")
	}

	t.Logf("Successfully parsed live Mux HLS stream! Segments: %d, Duration: %.2f seconds", len(playlist.Segments), playlist.TotalDuration)
}

func TestLiveMuxStreamDownloadSample(t *testing.T) {
	url := "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
	tempDir, err := os.MkdirTemp("", "thunderdm_test_hls_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	task := NewHLSTaskController(context.Background(), "test_mux", url, tempDir, "mux_sample.mp4", 8)
	err = task.preCheck()
	if err != nil {
		t.Skipf("Skipping live stream download sample (network/proxy unreachable): %v", err)
		return
	}

	// Limit test to downloading first 2 segments to test segment downloading & merging quickly
	if len(task.segStates) > 2 {
		task.segStates = task.segStates[:2]
		task.State.TotalSegments = 2
	}

	for _, ss := range task.segStates {
		task.downloadSegment(ss)
		if ss.GetStatus() != StatusFinished {
			t.Fatalf("Segment download failed for %s", ss.Segment.URL)
		}
	}

	task.finalizeDownload()

	destFile := filepath.Join(tempDir, "mux_sample.mp4")
	fi, err := os.Stat(destFile)
	if err != nil {
		t.Fatalf("Merged video file not found: %v", err)
	}

	if fi.Size() == 0 {
		t.Fatalf("Merged video file is empty")
	}

	t.Logf("Successfully downloaded & merged sample HLS video file! Size: %d bytes", fi.Size())
}
