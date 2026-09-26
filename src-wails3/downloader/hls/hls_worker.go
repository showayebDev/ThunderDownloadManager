// hls_worker.go handles HLS segment download workers, AES-128 key caching and decryption,
// on-disk segment checkpoint restoration, and TS-to-MP4 FFmpeg remuxing/merging.
package hls

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/limiter"
	"ThunderDM/src-wails3/downloader/ytdlp"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// HLSSegmentState tracks the download state and on-disk temporary file of a single HLS segment.
type HLSSegmentState struct {
	Segment         HLSSegment
	Status          core.DownloadStatus
	DownloadedBytes int64
	TempPath        string
	RetryCount      int
	mu              sync.Mutex
}

// GetStatus returns the thread-safe status of the segment.
func (s *HLSSegmentState) GetStatus() core.DownloadStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Status
}

// SetStatus updates the thread-safe status of the segment.
func (s *HLSSegmentState) SetStatus(status core.DownloadStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
}

// GetDownloadedBytes returns the byte count written for the segment.
func (s *HLSSegmentState) GetDownloadedBytes() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.DownloadedBytes
}

// SetDownloadedBytes sets the byte count written for the segment.
func (s *HLSSegmentState) SetDownloadedBytes(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.DownloadedBytes = n
}

// HLSKeyCache caches fetched AES-128 encryption keys in memory to avoid redundant HTTP requests.
type HLSKeyCache struct {
	keys sync.Map // map[string][]byte
}

var globalKeyCache = &HLSKeyCache{}

// GetOrFetchKey retrieves a 16-byte AES-128 key from memory cache or fetches it over HTTP.
func (k *HLSKeyCache) GetOrFetchKey(ctx context.Context, client *http.Client, keyURL string) ([]byte, error) {
	if val, ok := k.keys.Load(keyURL); ok {
		return val.([]byte), nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, keyURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch encryption key (HTTP %d)", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if len(data) != 16 {
		return nil, fmt.Errorf("invalid key length %d (expected 16 bytes for AES-128)", len(data))
	}

	k.keys.Store(keyURL, data)
	return data, nil
}

// ParseIV generates the 16-byte AES-128 IV from an IV hex string or the segment sequence number.
func ParseIV(ivHex string, sequenceNum uint64) []byte {
	ivHex = strings.TrimSpace(ivHex)
	if strings.HasPrefix(ivHex, "0x") || strings.HasPrefix(ivHex, "0X") {
		ivHex = ivHex[2:]
	}

	if len(ivHex) > 0 {
		// Pad to 32 hex chars (16 bytes) if necessary
		if len(ivHex) < 32 {
			ivHex = strings.Repeat("0", 32-len(ivHex)) + ivHex
		}
		if ivBytes, err := hex.DecodeString(ivHex); err == nil && len(ivBytes) == 16 {
			return ivBytes
		}
	}

	// Default RFC 8216: Sequence number as 16-byte big-endian integer
	iv := make([]byte, 16)
	binary.BigEndian.PutUint64(iv[8:], sequenceNum)
	return iv
}

// DecryptAES128Segment decrypts AES-128-CBC encrypted data using the given key and IV with PKCS7 unpadding.
func DecryptAES128Segment(ciphertext, key, iv []byte) ([]byte, error) {
	if len(key) != 16 {
		return nil, fmt.Errorf("invalid AES key length %d (expected 16)", len(key))
	}
	if len(iv) != 16 {
		return nil, fmt.Errorf("invalid IV length %d (expected 16)", len(iv))
	}
	if len(ciphertext) == 0 {
		return ciphertext, nil
	}
	if len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("encrypted segment size (%d) is not a multiple of AES block size (%d)", len(ciphertext), aes.BlockSize)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	plaintext := make([]byte, len(ciphertext))
	mode.CryptBlocks(plaintext, ciphertext)

	// Strip PKCS7 padding if present
	if len(plaintext) > 0 {
		padLen := int(plaintext[len(plaintext)-1])
		if padLen > 0 && padLen <= aes.BlockSize && padLen <= len(plaintext) {
			validPad := true
			for i := len(plaintext) - padLen; i < len(plaintext); i++ {
				if plaintext[i] != byte(padLen) {
					validPad = false
					break
				}
			}
			if validPad {
				plaintext = plaintext[:len(plaintext)-padLen]
			}
		}
	}

	return plaintext, nil
}

// initializeSegmentCheckpoints scans the segment cache directory, purges stale .tmp files,
// and restores finished segment states for seamless resume.
func (tc *HLSTaskController) initializeSegmentCheckpoints(segments []HLSSegment) {
	tc.segMu.Lock()
	defer tc.segMu.Unlock()

	tc.segStates = make([]*HLSSegmentState, len(segments))
	var existingBytes int64

	// Clean up any stale partial .tmp files left behind by sudden crash/termination
	if entries, err := os.ReadDir(tc.State.CacheDir); err == nil {
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".tmp") {
				_ = os.Remove(filepath.Join(tc.State.CacheDir, entry.Name()))
			}
		}
	}

	for i, seg := range segments {
		segFilename := fmt.Sprintf("seg_%06d.part", seg.Index)
		segPath := filepath.Join(tc.State.CacheDir, segFilename)

		status := core.StatusPending
		var dlBytes int64

		// Check if segment was already completely downloaded and decrypted
		if fi, err := os.Stat(segPath); err == nil && fi.Size() > 0 {
			status = core.StatusFinished
			dlBytes = fi.Size()
			existingBytes += dlBytes
		}

		tc.segStates[i] = &HLSSegmentState{
			Segment:         seg,
			Status:          status,
			DownloadedBytes: dlBytes,
			TempPath:        segPath,
		}
	}

	tc.totalBytesDl.Store(existingBytes)
}

func (tc *HLSTaskController) orchestratorLoop() {
	tc.triggerWorkerCheck()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-tc.chunkSignal:
			tc.segMu.Lock()
			tc.State.Mu.RLock()
			maxWorkers := tc.State.ThreadCount
			tc.State.Mu.RUnlock()

			allFinished := true
			pendingSegs := make([]*HLSSegmentState, 0)
			errorSegs := make([]*HLSSegmentState, 0)

			for _, ss := range tc.segStates {
				switch ss.GetStatus() {
				case core.StatusDownloading:
					allFinished = false
				case core.StatusError:
					allFinished = false
					errorSegs = append(errorSegs, ss)
				case core.StatusPending:
					allFinished = false
					pendingSegs = append(pendingSegs, ss)
				}
			}

			if allFinished {
				tc.segMu.Unlock()
				tc.finalizeDownload()
				return
			}

			cfg := core.GetEngineConfig()
			maxRetries := cfg.MaxRetries
			if maxRetries <= 0 {
				maxRetries = 3
			}

			// Check if any errorSegs can be retried according to maxRetries setting
			retriedAny := false
			for _, es := range errorSegs {
				es.mu.Lock()
				if es.RetryCount < maxRetries {
					es.RetryCount++
					es.Status = core.StatusPending
					pendingSegs = append(pendingSegs, es)
					retriedAny = true
					log.Printf("[HLSTaskController] Auto-retrying segment %d (attempt %d/%d) for task %s", es.Segment.Index, es.RetryCount, maxRetries, tc.State.ID)
				}
				es.mu.Unlock()
			}
			if retriedAny {
				tc.State.Mu.Lock()
				tc.State.Status = core.StatusDownloading
				tc.State.ErrorMessage = fmt.Sprintf("Reconnecting segment (attempt %d/%d)...", errorSegs[0].RetryCount, maxRetries)
				tc.State.Mu.Unlock()
				time.AfterFunc(1000*time.Millisecond, func() {
					tc.triggerWorkerCheck()
				})
			}

			if tc.activeCount == 0 && len(pendingSegs) == 0 && !allFinished {
				tc.segMu.Unlock()
				tc.changeStatusWithError(core.StatusError, fmt.Errorf("HLS download failed after %d retry attempts", maxRetries))
				tc.emitCurrentProgress()
				if application.Get() != nil {
					application.Get().Event.Emit("download-error", map[string]interface{}{
						"task_id": tc.State.ID,
						"id":      tc.State.ID,
						"error":   fmt.Sprintf("HLS download failed after %d retry attempts", maxRetries),
					})
				}
				tc.cancel()
				return
			}

			// Launch workers up to maxWorkers limit
			for _, ss := range pendingSegs {
				if tc.activeCount >= maxWorkers {
					break
				}
				ss.SetStatus(core.StatusDownloading)
				tc.activeCount++
				tc.workers.Add(1)

				go func(segState *HLSSegmentState) {
					defer func() {
						tc.workers.Done()
						tc.segMu.Lock()
						tc.activeCount--
						tc.segMu.Unlock()
						tc.triggerWorkerCheck()
					}()
					tc.downloadSegment(segState)
				}(ss)
			}
			tc.segMu.Unlock()
		}
	}
}

func (tc *HLSTaskController) downloadSegment(segState *HLSSegmentState) {
	seg := segState.Segment
	client := core.SharedHTTPClient

	cfg := core.GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}
	for attempt := 0; attempt < maxRetries; attempt++ {
		select {
		case <-tc.ctx.Done():
			return
		default:
		}

		if attempt > 0 {
			backoff := time.Duration(1<<attempt)*150*time.Millisecond + time.Duration(rand.Intn(100))*time.Millisecond
			select {
			case <-tc.ctx.Done():
				return
			case <-time.After(backoff):
			}
		}

		req, err := http.NewRequestWithContext(tc.ctx, http.MethodGet, seg.URL, nil)
		if err != nil {
			segState.SetStatus(core.StatusError)
			return
		}

		if tc.State.AuthUsername != "" || tc.State.AuthPassword != "" {
			req.SetBasicAuth(tc.State.AuthUsername, tc.State.AuthPassword)
		}
		if tc.State.UserAgent != "" {
			req.Header.Set("User-Agent", tc.State.UserAgent)
		} else {
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
		}
		if tc.State.Referer != "" {
			req.Header.Set("Referer", tc.State.Referer)
		}
		if tc.State.Cookies != "" && (tc.State.ForceCookie || !core.ShouldBypassCookies(tc.State.URL, "hls")) {
			req.Header.Set("Cookie", tc.State.Cookies)
		}

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			resp.Body.Close()
			if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
				continue
			}
			segState.SetStatus(core.StatusError)
			return
		}

		data, err := io.ReadAll(limiter.LimitReader(tc.ctx, resp.Body, tc.limiter))
		resp.Body.Close()
		if err != nil {
			continue
		}

		// Decrypt segment if AES-128 key URI is present
		if seg.KeyURI != "" {
			key, err := globalKeyCache.GetOrFetchKey(tc.ctx, client, seg.KeyURI)
			if err != nil {
				log.Printf("[HLSTaskController] Failed to fetch encryption key: %v", err)
				segState.SetStatus(core.StatusError)
				return
			}
			iv := ParseIV(seg.IVHex, seg.SequenceNum)
			decrypted, err := DecryptAES128Segment(data, key, iv)
			if err != nil {
				log.Printf("[HLSTaskController] Failed to decrypt segment %d: %v", seg.Index, err)
				segState.SetStatus(core.StatusError)
				return
			}
			data = decrypted
		}

		// Write to temporary segment file first to ensure atomic write
		tmpPath := segState.TempPath + ".tmp"
		if err := os.WriteFile(tmpPath, data, 0644); err != nil {
			log.Printf("[HLSTaskController] Failed to write segment file: %v", err)
			segState.SetStatus(core.StatusError)
			return
		}

		_ = os.Remove(segState.TempPath)
		if err := os.Rename(tmpPath, segState.TempPath); err != nil {
			log.Printf("[HLSTaskController] Failed to rename segment temp file: %v", err)
			segState.SetStatus(core.StatusError)
			return
		}

		segState.SetDownloadedBytes(int64(len(data)))
		tc.totalBytesDl.Add(int64(len(data)))
		segState.mu.Lock()
		segState.RetryCount = 0
		segState.Status = core.StatusFinished
		segState.mu.Unlock()
		return
	}

	segState.SetStatus(core.StatusError)
}

func (tc *HLSTaskController) triggerWorkerCheck() {
	select {
	case tc.chunkSignal <- struct{}{}:
	default:
	}
}

func (tc *HLSTaskController) finalizeDownload() {
	tc.workers.Wait()

	tc.segMu.Lock()
	// Strict verification: ensure every single segment has finished and exists on disk
	for _, ss := range tc.segStates {
		if ss.GetStatus() != core.StatusFinished {
			tc.segMu.Unlock()
			tc.changeStatusWithError(core.StatusError, fmt.Errorf("cannot merge: segment %d is not finished", ss.Segment.Index))
			return
		}
		if fi, err := os.Stat(ss.TempPath); err != nil || fi.Size() == 0 {
			tc.segMu.Unlock()
			tc.changeStatusWithError(core.StatusError, fmt.Errorf("cannot merge: segment %d is missing or empty", ss.Segment.Index))
			return
		}
	}
	tc.segMu.Unlock()

	tc.changeStatus(core.StatusMerging)

	destPath := tc.State.DestFilePath
	tempDestPath := destPath + ".merging"

	out, err := os.OpenFile(tempDestPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		tc.changeStatusWithError(core.StatusError, fmt.Errorf("failed to create merged video file: %w", err))
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	buf := make([]byte, 1024*1024) // 1MB streaming buffer
	var finalSize int64

	for _, ss := range tc.segStates {
		select {
		case <-tc.ctx.Done():
			out.Close()
			_ = os.Remove(tempDestPath)
			return
		default:
		}

		in, err := os.Open(ss.TempPath)
		if err != nil {
			out.Close()
			_ = os.Remove(tempDestPath)
			tc.changeStatusWithError(core.StatusError, fmt.Errorf("missing segment %d on merge: %w", ss.Segment.Index, err))
			return
		}

		n, err := io.CopyBuffer(out, in, buf)
		in.Close()
		if err != nil {
			out.Close()
			_ = os.Remove(tempDestPath)
			tc.changeStatusWithError(core.StatusError, fmt.Errorf("failed during segment %d merge: %w", ss.Segment.Index, err))
			return
		}
		finalSize += n
	}

	_ = out.Sync()
	out.Close()

	// If FFmpeg is available and destination is .mp4, remux stream into standard ISO MP4 for 100% playable video
	remuxSucceeded := false
	ffmpegExe := ytdlp.GetFFmpegExecutable()
	if ffmpegExe != "" && strings.HasSuffix(strings.ToLower(destPath), ".mp4") {
		remuxTempPath := destPath + ".remux.mp4"
		_ = os.Remove(remuxTempPath)
		cmd := exec.CommandContext(tc.ctx, ffmpegExe, "-y", "-i", tempDestPath, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", remuxTempPath)
		if err := cmd.Run(); err == nil {
			if fi, err := os.Stat(remuxTempPath); err == nil && fi.Size() > 0 {
				_ = os.Remove(tempDestPath)
				_ = os.Remove(destPath)
				if err := os.Rename(remuxTempPath, destPath); err == nil {
					finalSize = fi.Size()
					remuxSucceeded = true
				}
			}
		}
		_ = os.Remove(remuxTempPath)
	}

	if !remuxSucceeded {
		_ = os.Remove(destPath)
		if err := os.Rename(tempDestPath, destPath); err != nil {
			tc.changeStatusWithError(core.StatusError, fmt.Errorf("failed to finalize video file: %w", err))
			return
		}
	}

	// Clean up segment cache directory
	if tc.State.CacheDir != "" {
		_ = os.RemoveAll(tc.State.CacheDir)
	}

	tc.State.Mu.Lock()
	tc.State.TotalSize = finalSize
	tc.State.Status = core.StatusFinished
	tc.State.Mu.Unlock()

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", core.ProgressPayload{
			ID:              tc.State.ID,
			TaskID:          tc.State.ID,
			URL:             tc.State.URL,
			Filename:        tc.State.Filename,
			SavePath:        tc.State.SavePath,
			Protocol:        "HLS",
			IsHLS:           true,
			Status:          core.StatusFinished,
			DownloadedBytes: finalSize,
			Downloaded:      finalSize,
			TotalBytes:      finalSize,
			TotalSize:       finalSize,
			Resumable:       true,
			ResumeSupport:   "Yes",
		})
	}

	payload := map[string]interface{}{
		"id":               tc.State.ID,
		"task_id":          tc.State.ID,
		"url":              tc.State.URL,
		"filename":         tc.State.Filename,
		"save_path":        tc.State.SavePath,
		"dest_file_path":   tc.State.DestFilePath,
		"filePath":         tc.State.DestFilePath,
		"protocol":         "HLS",
		"total_size":       finalSize,
		"total_bytes":      finalSize,
		"downloaded":       finalSize,
		"downloaded_bytes": finalSize,
		"status":           core.StatusFinished,
		"is_hls":           true,
		"showCompletion":   tc.State.ShowCompletion,
	}

	core.EmitDownloadCompleted(payload)
}
