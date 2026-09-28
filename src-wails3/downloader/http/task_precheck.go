// task_precheck.go performs HTTP pre-check probing (HEAD with Range GET fallback),
// content size and byte-range resume detection, disk space validation, sparse file
// pre-allocation, and initial chunk partitioning.
package httptask

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/sys"
)

// preCheck probes the remote HTTP server, determines file size and range support,
// opens/allocates the .thunderdm container file, and initializes download chunks.
func (tc *TaskController) preCheck() error {
	ctxProbe, cancelProbe := context.WithTimeout(tc.ctx, 25*time.Second)
	defer cancelProbe()

	applyHeaders := func(r *http.Request) {
		if tc.State.AuthUsername != "" || tc.State.AuthPassword != "" {
			r.SetBasicAuth(tc.State.AuthUsername, tc.State.AuthPassword)
		}
		if tc.State.UserAgent != "" {
			r.Header.Set("User-Agent", tc.State.UserAgent)
		}
		if tc.State.Referer != "" {
			r.Header.Set("Referer", tc.State.Referer)
		}
		if tc.State.Cookies != "" && (tc.State.ForceCookie || !core.ShouldBypassCookies(tc.State.URL, "http")) {
			r.Header.Set("Cookie", tc.State.Cookies)
		}
	}

	var resp *http.Response
	var err error

	cfg := core.GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoffMs := attempt * 1000
			if backoffMs > 4000 {
				backoffMs = 4000
			}
			select {
			case <-ctxProbe.Done():
				return ctxProbe.Err()
			case <-time.After(time.Duration(backoffMs) * time.Millisecond):
			}
		}

		resp, err = tc.probeServerAttempt(ctxProbe, applyHeaders)
		if resp != nil && isFatalHTTPStatus(resp.StatusCode) {
			drainAndCloseBody(resp)
			return fmt.Errorf("HTTP %d (%s)", resp.StatusCode, http.StatusText(resp.StatusCode))
		}

		if err == nil && resp != nil && resp.StatusCode >= 200 && resp.StatusCode < 400 {
			break
		}
	}
	defer drainAndCloseBody(resp)

	if err != nil && resp == nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	if resp == nil {
		return fmt.Errorf("server returned no response")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("server returned status: %s", resp.Status)
	}

	// Capture Last-Modified timestamp from server response
	if lmStr := resp.Header.Get("Last-Modified"); lmStr != "" {
		if parsedTime, parseErr := http.ParseTime(lmStr); parseErr == nil {
			tc.State.LastModified = parsedTime
		}
	}

	totalSize, hasSizeHeader := parseResponseContentSize(resp)

	if !hasSizeHeader || totalSize < 0 {
		// Stream / dynamic content: fallback to 1-thread streaming
		tc.State.TotalSize = -1
		tc.State.ThreadCount = 1
	} else if totalSize == 0 {
		// Empty file (0 bytes)
		tc.State.TotalSize = 0
		tc.State.ThreadCount = 1
	} else {
		tc.State.TotalSize = totalSize
		if ok, spaceErr := sys.CheckFreeDiskSpace(tc.State.SavePath, totalSize); !ok {
			return spaceErr
		}
	}

	acceptRanges := resp.Header.Get("Accept-Ranges")
	isResumable := (acceptRanges == "bytes" || resp.StatusCode == http.StatusPartialContent || resp.Header.Get("Content-Range") != "") && tc.State.TotalSize > 0
	tc.State.Resumable = isResumable
	if !isResumable || (tc.State.TotalSize > 0 && tc.State.TotalSize < 512*1024) {
		// Server does not support ranges or file is small (< 512KB), fallback to 1 thread
		tc.State.ThreadCount = 1
	} else if tc.State.TotalSize > 0 {
		maxThreads := int(tc.State.TotalSize / (64 * 1024))
		if maxThreads < 1 {
			maxThreads = 1
		}
		if tc.State.ThreadCount > maxThreads {
			tc.State.ThreadCount = maxThreads
		}
	}

	// Prepare directories & target .thunderdm container file
	tc.State.SavePath = core.NormalizeSavePath(tc.State.SavePath)
	if err := os.MkdirAll(tc.State.SavePath, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	destPath := filepath.Join(tc.State.SavePath, tc.State.Filename)
	tempPath := destPath + ".thunderdm"
	tc.State.DestFilePath = destPath
	tc.State.TempFilePath = tempPath

	// Check if the temporary container file already existed on disk with content
	tempFileExisted := false
	if fi, statErr := os.Stat(tempPath); statErr == nil && fi.Size() > 0 {
		tempFileExisted = true
	}

	// Open or create target file with read/write permissions
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return fmt.Errorf("failed to create container file: %w", err)
	}

	if tc.State.TotalSize > 0 {
		// Apply NTFS Sparse File Allocation on Windows if enabled
		if core.GetEngineConfig().SparseFileAllocation {
			_ = sys.ApplySparseFile(file.Fd())
		}
		// Pre-allocate disk space if newly created
		if fi, statErr := file.Stat(); statErr == nil && fi.Size() < tc.State.TotalSize {
			_ = file.Truncate(tc.State.TotalSize)
		}
	}
	tc.targetFile = file

	tc.InitializeChunks(tempFileExisted)
	return nil
}

// probeServerAttempt tries HEAD first, then falls back to GET with Range: bytes=0-0, and finally plain GET.
func (tc *TaskController) probeServerAttempt(ctx context.Context, applyHeaders func(*http.Request)) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, tc.State.URL, nil)
	if err != nil {
		return nil, err
	}
	applyHeaders(req)

	resp, err := core.SharedHTTPClient.Do(req)
	if resp != nil && isFatalHTTPStatus(resp.StatusCode) {
		return resp, nil
	}

	if err != nil || resp == nil || resp.StatusCode >= 400 {
		drainAndCloseBody(resp)
		// Fallback to GET with Range: bytes=0-0 to probe length and range support safely
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, tc.State.URL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Range", "bytes=0-0")
		applyHeaders(req)
		resp, err = core.SharedHTTPClient.Do(req)
		if resp != nil && isFatalHTTPStatus(resp.StatusCode) {
			return resp, nil
		}

		if err != nil || resp == nil || resp.StatusCode >= 400 {
			drainAndCloseBody(resp)
			req, err = http.NewRequestWithContext(ctx, http.MethodGet, tc.State.URL, nil)
			if err != nil {
				return nil, err
			}
			applyHeaders(req)
			resp, err = core.SharedHTTPClient.Do(req)
		}
	}

	return resp, err
}

func isFatalHTTPStatus(code int) bool {
	return code == http.StatusNotFound ||
		code == http.StatusUnauthorized ||
		code == http.StatusForbidden ||
		code == http.StatusGone
}

func drainAndCloseBody(resp *http.Response) {
	if resp != nil && resp.Body != nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
}

func parseResponseContentSize(resp *http.Response) (int64, bool) {
	// Parse Content-Range if returned for byte probe (e.g. "bytes 0-0/12345")
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		if idx := strings.LastIndex(cr, "/"); idx != -1 {
			if s, err := strconv.ParseInt(cr[idx+1:], 10, 64); err == nil && s >= 0 {
				return s, true
			}
		}
	}

	// Fallback to Content-Length
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		if s, err := strconv.ParseInt(cl, 10, 64); err == nil && s >= 0 {
			return s, true
		}
	}

	return -1, false
}

// InitializeChunks restores chunks from a saved checkpoint if valid, or partitions
// the file into equal byte ranges across ThreadCount workers.
func (tc *TaskController) InitializeChunks(opts ...bool) {
	tc.State.Mu.Lock()
	defer tc.State.Mu.Unlock()

	tempFileExisted := true
	if len(opts) > 0 {
		tempFileExisted = opts[0]
	} else if tc.State.TempFilePath != "" {
		if fi, err := os.Stat(tc.State.TempFilePath); err != nil || fi.Size() == 0 {
			tempFileExisted = false
		}
	}

	// If the temporary container file does NOT exist on disk, any saved checkpoint is invalid.
	// Purge the checkpoint and start fresh from 0 (0%) to prevent file corruption.
	if !tempFileExisted {
		tc.CleanupCheckpoint()
	} else if tc.loadCheckpoint() {
		log.Printf("[TaskController] Resuming task %s from OS app storage checkpoint: %d chunks restored", tc.State.ID, len(tc.State.Chunks))
		return
	}

	tc.State.Chunks = make([]*core.ChunkState, 0)
	if tc.State.TotalSize <= 0 || tc.State.ThreadCount <= 1 {
		tc.State.ThreadCount = 1
		var endByte int64 = -1
		if tc.State.TotalSize > 0 {
			endByte = tc.State.TotalSize - 1
		} else if tc.State.TotalSize == 0 {
			endByte = 0
		}
		tc.State.Chunks = []*core.ChunkState{
			{
				ID:          0,
				StartByte:   0,
				CurrentByte: 0,
				EndByte:     endByte,
				Status:      core.StatusPending,
			},
		}
		tc.saveCheckpointLocked()
		return
	}

	chunkSize := tc.State.TotalSize / int64(tc.State.ThreadCount)
	for i := 0; i < tc.State.ThreadCount; i++ {
		start := int64(i) * chunkSize
		end := start + chunkSize - 1
		if i == tc.State.ThreadCount-1 {
			end = tc.State.TotalSize - 1
		}
		chunk := &core.ChunkState{
			ID:          i,
			StartByte:   start,
			CurrentByte: start,
			EndByte:     end,
			Status:      core.StatusPending,
		}
		tc.State.Chunks = append(tc.State.Chunks, chunk)
	}

	tc.saveCheckpointLocked()
}
