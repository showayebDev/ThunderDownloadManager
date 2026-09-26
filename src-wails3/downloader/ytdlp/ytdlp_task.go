// ytdlp_task.go implements YTDLPTaskController for executing, monitoring, pausing,
// canceling, and finalizing yt-dlp subprocess downloads inside the ThunderDM Engine.
package ytdlp

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/proxy"
	"ThunderDM/src-wails3/downloader/sys"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// YTDLPTaskController manages a video/audio stream download powered by the yt-dlp subprocess.
type YTDLPTaskController struct {
	wailsCtx           context.Context
	ctx                context.Context
	cancel             context.CancelFunc
	cmd                *exec.Cmd
	State              *core.TaskState
	quality            string
	userAgent          string
	referer            string
	cookies            string
	forceCookie        bool
	isPaused           bool
	isCanceled         bool
	speedVal           atomic.Int64
	etaVal             atomic.Int64
	downloaded         atomic.Int64
	totalBytes         atomic.Int64
	percentVal         atomic.Int64
	prevStreamsTotal   atomic.Int64
	currentStreamTotal atomic.Int64
	currentStreamDL    atomic.Int64
	mu                 sync.Mutex
}

// NewYTDLPTaskController constructs a new YTDLPTaskController for the given media URL and quality preset.
func NewYTDLPTaskController(wailsCtx context.Context, id, rawURL, savePath, filename, quality string, opts ...interface{}) *YTDLPTaskController {
	savePath = core.NormalizeSavePath(savePath)
	ctx, cancel := context.WithCancel(context.Background())

	if filename == "" {
		filename = "video.mp4"
	}
	filename = core.SanitizeFilename(filename)
	if quality == "" {
		quality = "best"
	}

	var initDL, initTot int64
	var userAgent, referer, cookies string
	var forceCookie bool
	showCompletion := true

	for _, opt := range opts {
		if opt == nil {
			continue
		}
		switch v := opt.(type) {
		case int64:
			if initDL == 0 {
				initDL = v
			} else if initTot == 0 {
				initTot = v
			}
		case *int64:
			if v != nil {
				if initDL == 0 {
					initDL = *v
				} else if initTot == 0 {
					initTot = *v
				}
			}
		case core.DownloadExtraOptions:
			if v.ShowCompletion != nil {
				showCompletion = *v.ShowCompletion
			}
			if v.UserAgent != "" {
				userAgent = v.UserAgent
			}
			if v.Referer != "" {
				referer = v.Referer
			}
			if v.Cookies != "" {
				cookies = v.Cookies
			}
			if v.ForceCookie {
				forceCookie = true
			}
		}
	}

	tc := &YTDLPTaskController{
		wailsCtx:    wailsCtx,
		ctx:         ctx,
		cancel:      cancel,
		quality:     quality,
		userAgent:   userAgent,
		referer:     referer,
		cookies:     cookies,
		forceCookie: forceCookie,
		State: &core.TaskState{
			ID:             id,
			URL:            rawURL,
			SavePath:       savePath,
			Filename:       filename,
			DestFilePath:   filepath.Join(savePath, filename),
			Status:         core.StatusPending,
			Protocol:       "Yt-DLP",
			IsHLS:          false,
			UserAgent:      userAgent,
			Referer:        referer,
			Cookies:        cookies,
			ForceCookie:    forceCookie,
			ShowCompletion: showCompletion,
		},
	}

	if initDL > 0 {
		tc.downloaded.Store(initDL)
	}
	if initTot > 0 {
		tc.totalBytes.Store(initTot)
		tc.State.TotalSize = initTot
	}
	if initTot > 0 && initDL > 0 {
		tc.percentVal.Store(int64(float64(initDL) / float64(initTot) * 100))
	}

	return tc
}

// Start executes the yt-dlp subprocess with retry logic and resolves the final output file on completion.
func (t *YTDLPTaskController) Start() {
	t.mu.Lock()
	if t.isCanceled || t.isPaused || t.cmd != nil {
		t.mu.Unlock()
		return
	}
	t.State.Status = core.StatusDownloading
	t.mu.Unlock()

	cleanFilename := core.SanitizeFilename(t.State.Filename)
	quality := strings.ToLower(t.quality)
	if !strings.Contains(cleanFilename, ".") {
		if quality == "audio" || quality == "audio_only" || quality == "mp3" {
			cleanFilename += ".mp3"
		} else {
			cleanFilename += ".mp4"
		}
	}
	t.State.Filename = cleanFilename

	client := NewClient()
	if !client.IsInstalled() {
		t.handleError(fmt.Errorf("YT-DLP is not installed on your system. Please install YT-DLP to download video/audio streams."))
		return
	}

	log.Printf("[YTDLPTaskController] Starting YT-DLP download for Task %s, URL: %s, Filename: %s, Quality: %s\n", t.State.ID, t.State.URL, t.State.Filename, t.quality)

	cfg := core.GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	args := t.buildCommandArgs(cleanFilename, quality, maxRetries)

	exePath := GetYTDLPExecutable()
	if exePath == "" {
		t.handleError(fmt.Errorf("YT-DLP is not installed in ThunderDM. Please install media tools from the menu."))
		return
	}

	// Periodic progress emitter
	go func() {
		ticker := time.NewTicker(core.GetProgressInterval())
		defer ticker.Stop()

		for {
			select {
			case <-t.ctx.Done():
				return
			case <-ticker.C:
				t.emitProgress()
			}
		}
	}()

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		select {
		case <-t.ctx.Done():
			return
		default:
		}

		if attempt > 0 {
			t.mu.Lock()
			t.State.Status = core.StatusDownloading
			t.State.ErrorMessage = fmt.Sprintf("Reconnecting (attempt %d/%d)...", attempt, maxRetries)
			t.mu.Unlock()
			t.emitProgress()
			time.Sleep(1500 * time.Millisecond)
		}

		t.mu.Lock()
		if t.isCanceled || t.isPaused {
			t.mu.Unlock()
			return
		}

		currentArgs := stripCookieHeaderOnRetry(args, attempt)
		t.cmd = sys.PrepareCmd(exec.CommandContext(t.ctx, exePath, currentArgs...))
		t.cmd.Env = buildYTDLPEnv(t.State.URL)

		stdout, err := t.cmd.StdoutPipe()
		if err != nil {
			t.mu.Unlock()
			lastErr = fmt.Errorf("failed to create stdout pipe: %w", err)
			continue
		}

		var stderrBuf bytes.Buffer
		t.cmd.Stderr = &stderrBuf

		if err := t.cmd.Start(); err != nil {
			t.mu.Unlock()
			lastErr = fmt.Errorf("failed to execute ThunderDM YT-DLP: %w", err)
			continue
		}
		t.mu.Unlock()

		// Read stdout lines asynchronously
		go streamLinesFromReader(stdout, t.processOutputLine)

		err = t.cmd.Wait()

		t.mu.Lock()
		t.cmd = nil
		isPaused := t.isPaused
		isCanceled := t.isCanceled
		t.mu.Unlock()

		if isPaused {
			t.mu.Lock()
			t.State.Status = core.StatusPaused
			t.mu.Unlock()
			t.emitProgress()
			return
		}

		if isCanceled {
			t.mu.Lock()
			t.State.Status = core.StatusCanceled
			t.mu.Unlock()
			t.emitProgress()
			return
		}

		if err == nil {
			lastErr = nil
			break
		}
		stderrStr := strings.TrimSpace(stderrBuf.String())
		if stderrStr != "" {
			lastErr = fmt.Errorf("%w: %s", err, stderrStr)
		} else {
			lastErr = err
		}
		log.Printf("[YTDLPTaskController] Task %s attempt %d/%d failed: %v", t.State.ID, attempt+1, maxRetries, lastErr)
	}

	if lastErr != nil {
		t.handleError(fmt.Errorf("yt-dlp download failed after %d attempts: %w", maxRetries, lastErr))
		return
	}

	t.finalizeSuccess(cleanFilename)
}

func (t *YTDLPTaskController) buildCommandArgs(cleanFilename, quality string, maxRetries int) []string {
	args := []string{
		"--newline", "--no-playlist", "--continue", "--part", "--windows-filenames", "--trim-filenames", "120",
		"--retries", strconv.Itoa(maxRetries), "--fragment-retries", strconv.Itoa(maxRetries),
	}
	if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
		args = append(args, "--ffmpeg-location", ffmpegLoc)
	}

	switch {
	case quality == "audio" || quality == "audio_only" || quality == "mp3":
		args = append(args, "-f", "bestaudio/best", "-x", "--audio-format", "mp3")
	case quality == "1080p":
		args = append(args, "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "--merge-output-format", "mp4")
	case quality == "720p":
		args = append(args, "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best", "--merge-output-format", "mp4")
	case quality == "480p":
		args = append(args, "-f", "bestvideo[height<=480]+bestaudio/best[height<=480]/best", "--merge-output-format", "mp4")
	case quality == "360p":
		args = append(args, "-f", "bestvideo[height<=360]+bestaudio/best[height<=360]/best", "--merge-output-format", "mp4")
	case quality != "" && quality != "best":
		qualityArg := t.quality
		if !strings.Contains(qualityArg, "+") {
			qualityArg += "+bestaudio/best"
		}
		args = append(args, "-f", qualityArg, "--merge-output-format", "mp4")
	default:
		args = append(args, "-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4")
	}

	if t.forceCookie || !IsCookieBrokenHost(t.State.URL) {
		if t.cookies != "" {
			args = append(args, "--add-header", "Cookie: "+t.cookies)
		} else if t.State.Cookies != "" {
			args = append(args, "--add-header", "Cookie: "+t.State.Cookies)
		}
	}

	if t.userAgent != "" {
		args = append(args, "--user-agent", t.userAgent)
	} else if t.State.UserAgent != "" {
		args = append(args, "--user-agent", t.State.UserAgent)
	}

	if t.referer != "" {
		args = append(args, "--referer", t.referer)
	} else if t.State.Referer != "" {
		args = append(args, "--referer", t.State.Referer)
	}

	outBase := strings.TrimSuffix(cleanFilename, filepath.Ext(cleanFilename))
	if outBase == "" {
		outBase = "video"
	}
	outTemplate := filepath.Join(t.State.SavePath, outBase) + ".%(ext)s"
	args = append(args, "-o", outTemplate)

	if proxyStr := proxy.GetProxyManager().GetProxyStringForURL(t.State.URL); proxyStr != "" {
		args = append(args, "--proxy", proxyStr)
	} else {
		args = append(args, "--proxy", "")
	}

	return append(args, t.State.URL)
}

func stripCookieHeaderOnRetry(args []string, attempt int) []string {
	if attempt <= 0 {
		return args
	}
	currentArgs := make([]string, 0, len(args))
	skipNext := false
	for _, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--add-header" {
			skipNext = true
			continue
		}
		if strings.HasPrefix(arg, "Cookie: ") {
			continue
		}
		currentArgs = append(currentArgs, arg)
	}
	return currentArgs
}

func (t *YTDLPTaskController) finalizeSuccess(cleanFilename string) {
	t.mu.Lock()
	t.State.Status = core.StatusFinished
	t.State.ErrorMessage = ""
	t.mu.Unlock()

	ext := filepath.Ext(cleanFilename)
	base := strings.TrimSuffix(cleanFilename, ext)
	if base == "" {
		base = "video"
	}

	destPath := filepath.Join(t.State.SavePath, cleanFilename)
	finalPath, finalSize := t.resolveOutputFileOnDisk(destPath, base)

	if finalPath != "" {
		t.State.Filename = filepath.Base(finalPath)
		t.State.DestFilePath = finalPath
		t.totalBytes.Store(finalSize)
		t.downloaded.Store(finalSize)
		t.State.TotalSize = finalSize
	} else if t.totalBytes.Load() > 0 {
		t.downloaded.Store(t.totalBytes.Load())
	}

	t.speedVal.Store(0)
	t.etaVal.Store(0)
	t.percentVal.Store(100)

	t.emitProgress()

	log.Printf("[YTDLPTaskController] Task %s completed successfully: %s (Size: %d bytes)\n", t.State.ID, t.State.DestFilePath, t.downloaded.Load())

	if application.Get() != nil {
		completedPayload := map[string]interface{}{
			"id":                   t.State.ID,
			"task_id":              t.State.ID,
			"taskId":               t.State.ID,
			"filename":             t.State.Filename,
			"name":                 t.State.Filename,
			"save_path":            t.State.SavePath,
			"savePath":             t.State.SavePath,
			"dest_file_path":       t.State.DestFilePath,
			"destFilePath":         t.State.DestFilePath,
			"filePath":             t.State.DestFilePath,
			"total_size":           t.downloaded.Load(),
			"totalSize":            t.downloaded.Load(),
			"total_bytes":          t.downloaded.Load(),
			"downloaded":           t.downloaded.Load(),
			"downloaded_bytes":     t.downloaded.Load(),
			"showCompletion":       t.State.ShowCompletion,
			"show_completion":      t.State.ShowCompletion,
			"showCompletionWindow": t.State.ShowCompletion,
			"status":               string(core.StatusFinished),
		}
		core.EmitDownloadCompleted(completedPayload)
		application.Get().Event.Emit("download-completed", completedPayload)
	}
}

func (t *YTDLPTaskController) resolveOutputFileOnDisk(destPath, base string) (string, int64) {
	// 1. Direct check
	if fi, err := os.Stat(destPath); err == nil && !fi.IsDir() && fi.Size() > 0 {
		return destPath, fi.Size()
	}

	// 2. Check candidate extensions if format changed (e.g. mp4, mkv, webm, mp3, m4a, opus)
	for _, ext := range []string{".mp4", ".mkv", ".webm", ".mp3", ".m4a", ".opus"} {
		cand := filepath.Join(t.State.SavePath, base+ext)
		if fi, err := os.Stat(cand); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return cand, fi.Size()
		}
	}

	// 3. Fallback to ResolveExistingFilePath
	if resolved := core.ResolveExistingFilePath(destPath); resolved != "" {
		if fi, err := os.Stat(resolved); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return resolved, fi.Size()
		}
	}

	return "", 0
}

func (t *YTDLPTaskController) emitProgress() {
	if application.Get() == nil {
		return
	}

	dl := t.downloaded.Load()
	tot := t.totalBytes.Load()
	speed := float64(t.speedVal.Load())
	eta := float64(t.etaVal.Load())

	payload := core.ProgressPayload{
		ID:              t.State.ID,
		TaskID:          t.State.ID,
		URL:             t.State.URL,
		Filename:        t.State.Filename,
		SavePath:        t.State.SavePath,
		Status:          t.State.Status,
		DownloadedBytes: dl,
		Downloaded:      dl,
		TotalBytes:      tot,
		TotalSize:       tot,
		Speed:           speed,
		ETA:             eta,
		Protocol:        "Yt-DLP",
		IsYTDLP:         true,
		Resumable:       true,
		ResumeSupport:   "Yes",
		ProxyUsed:       proxy.GetProxyManager().GetActiveProxyLabelForURL(t.State.URL),
		ErrorMessage:    t.State.ErrorMessage,
		Error:           t.State.ErrorMessage,
		Chunks:          []core.ChunkPayload{},
	}

	application.Get().Event.Emit("download-progress", payload)
	application.Get().Event.Emit("download-progress-"+t.State.ID, payload)
	core.EmitProgressUpdate(t.State.ID, t.State.Filename, dl, tot)
}

func (t *YTDLPTaskController) handleError(err error) {
	t.mu.Lock()
	t.State.Status = core.StatusError
	t.State.ErrorMessage = err.Error()
	t.mu.Unlock()

	log.Printf("[YTDLPTaskController] Error in task %s: %v\n", t.State.ID, err)
	t.emitProgress()
	if application.Get() != nil {
		application.Get().Event.Emit("download-error", map[string]interface{}{
			"id":            t.State.ID,
			"task_id":       t.State.ID,
			"error":         err.Error(),
			"error_message": err.Error(),
		})
	}
}

// Pause terminates the active yt-dlp subprocess while retaining .part files for resumption.
func (t *YTDLPTaskController) Pause() error {
	t.mu.Lock()
	if t.State.Status == core.StatusFinished || t.State.Status == core.StatusError || t.State.Status == core.StatusCanceled || t.State.Status == core.StatusPaused {
		t.mu.Unlock()
		return nil
	}
	t.isPaused = true
	t.State.Status = core.StatusPaused
	t.mu.Unlock()

	t.cancel()
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	t.emitProgress()
	return nil
}

// CleanYTDLPTempFiles removes all temporary partial files (.part, .ytdl, .part-Frag*.part) for the task.
func CleanYTDLPTempFiles(savePath, filename string) {
	if savePath == "" || filename == "" {
		return
	}

	baseName := strings.TrimSuffix(filename, filepath.Ext(filename))
	if baseName == "" {
		baseName = filename
	}

	entries, err := os.ReadDir(savePath)
	if err != nil {
		return
	}

	lowerBase := strings.ToLower(baseName)
	lowerFilename := strings.ToLower(filename)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		lowerName := strings.ToLower(name)

		isRelated := strings.HasPrefix(lowerName, lowerBase) || strings.HasPrefix(lowerName, lowerFilename)
		if isRelated && core.IsIntermediateDownloadFile(name) {
			fullPath := filepath.Join(savePath, name)
			_ = os.Remove(fullPath)
			log.Printf("[YTDLP] Cleaned up temporary file on cancel: %s\n", fullPath)
		}
	}
}

// Cancel stops the yt-dlp subprocess and optionally deletes temporary .part/.ytdl files.
func (t *YTDLPTaskController) Cancel() error {
	t.mu.Lock()
	if t.State.Status == core.StatusFinished {
		t.mu.Unlock()
		return nil
	}
	t.isCanceled = true
	t.State.Status = core.StatusCanceled
	t.mu.Unlock()

	t.cancel()
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}

	if core.GetEngineConfig().DeletePartialOnFileCancel {
		CleanYTDLPTempFiles(t.State.SavePath, t.State.Filename)
	}

	t.emitProgress()
	return nil
}

// UpdateThreadCount is a no-op because threading is managed internally by the yt-dlp stream engine.
func (t *YTDLPTaskController) UpdateThreadCount(threads int) {}

// UpdateSpeedLimit is a no-op for the external yt-dlp subprocess.
func (t *YTDLPTaskController) UpdateSpeedLimit(speedLimit *int64) {}

// GetState returns a snapshot map of the yt-dlp task's current progress and state.
func (t *YTDLPTaskController) GetState() map[string]interface{} {
	return map[string]interface{}{
		"id":               t.State.ID,
		"task_id":          t.State.ID,
		"url":              t.State.URL,
		"filename":         t.State.Filename,
		"save_path":        t.State.SavePath,
		"status":           t.State.Status,
		"downloaded":       t.downloaded.Load(),
		"downloaded_bytes": t.downloaded.Load(),
		"total_size":       t.totalBytes.Load(),
		"total_bytes":      t.totalBytes.Load(),
		"speed":            float64(t.speedVal.Load()),
		"eta":              float64(t.etaVal.Load()),
		"protocol":         "Yt-DLP",
		"is_ytdlp":         true,
		"resumable":        true,
		"resume_support":   "Yes",
		"accept_ranges":    true,
		"proxy_used":       proxy.GetProxyManager().GetActiveProxyLabelForURL(t.State.URL),
		"error_message":    t.State.ErrorMessage,
		"error":            t.State.ErrorMessage,
		"chunks":           []core.ChunkPayload{},
	}
}
