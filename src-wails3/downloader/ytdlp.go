package downloader

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Format struct {
	FormatID   string  `json:"format_id"`
	Ext        string  `json:"ext"`
	Resolution string  `json:"resolution"`
	FPS        float64 `json:"fps"`
	VCodec     string  `json:"vcodec"`
	ACodec     string  `json:"acodec"`
	Filesize   int64   `json:"filesize"`
	FormatNote string  `json:"format_note"`
}

type DownloadOptions struct {
	URL        string
	OutputFile string
	Quality    string // e.g. "1080p", "720p", "best", "audio" or "137"
	MergeToMP4 bool
	Cookies    string
	ExtraArgs  []string
}

// GetYTDLPExecutable finds ThunderDM's own yt-dlp binary in ~/.thunderdm/bin, app dir, or bundle dir.
// It strictly ignores any global/system PATH yt-dlp.
func GetYTDLPExecutable() string {
	binName := "yt-dlp"
	if runtime.GOOS == "windows" {
		binName = "yt-dlp.exe"
	}

	// 1. Check ~/.thunderdm/bin/
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, ".thunderdm", "bin", binName)
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate
		}
	}

	// 2. Check application directory or executable dir
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidate := filepath.Join(exeDir, binName)
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate
		}
		candidate2 := filepath.Join(exeDir, "bin", binName)
		if fi, err := os.Stat(candidate2); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate2
		}
		// macOS app bundle: /path/to/ThunderDM.app/Contents/Resources/bin/yt-dlp
		candidate3 := filepath.Join(exeDir, "..", "Resources", "bin", binName)
		if fi, err := os.Stat(candidate3); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate3
		}
	}

	return ""
}

var mediaToolsInstallMu sync.Mutex

// CleanBinDirectory scans ~/.thunderdm/bin and safely removes any leftover temporary files (*.tmp).
func CleanBinDirectory() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	binDir := filepath.Join(home, ".thunderdm", "bin")
	entries, err := os.ReadDir(binDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		lowerName := strings.ToLower(name)
		if strings.HasSuffix(lowerName, ".tmp") || strings.Contains(lowerName, ".tmp") || strings.HasPrefix(lowerName, "yt-dlp.exe_") || strings.HasPrefix(lowerName, "ffmpeg_dl_") {
			fullPath := filepath.Join(binDir, name)
			_ = os.Remove(fullPath)
			log.Printf("[MediaTools] Cleaned up temporary file: %s\n", fullPath)
		}
	}
}

func downloadYTDLPBinary() error {
	mediaToolsInstallMu.Lock()
	defer mediaToolsInstallMu.Unlock()

	CleanBinDirectory()

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get user home directory: %w", err)
	}

	binDir := filepath.Join(home, ".thunderdm", "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return fmt.Errorf("failed to create bin directory: %w", err)
	}

	binName := "yt-dlp"
	downloadURL := "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
	switch runtime.GOOS {
	case "windows":
		binName = "yt-dlp.exe"
		downloadURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
	case "darwin":
		downloadURL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
	}

	destPath := filepath.Join(binDir, binName)
	tempPath := filepath.Join(binDir, fmt.Sprintf("%s_%d.tmp", binName, time.Now().UnixNano()))
	_ = os.Remove(tempPath)

	var finalized bool
	defer func() {
		if !finalized {
			_ = os.Remove(tempPath)
		}
	}()

	log.Printf("[YTDLP] Downloading standalone binary from %s to %s\n", downloadURL, destPath)

	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create HTTP request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ThunderDM")

	client := &http.Client{
		Timeout: 3 * time.Minute,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			Proxy: func(req *http.Request) (*neturl.URL, error) {
				if GlobalProxyManager != nil {
					return GlobalProxyManager.GetProxyForURL(req.URL)
				}
				return nil, nil
			},
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch yt-dlp binary from GitHub: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned HTTP status %d", resp.StatusCode)
	}

	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %w", err)
	}

	EmitMediaToolsProgress("Downloading YT-DLP binary...", 0, resp.ContentLength)
	pr := &progressReader{
		Reader: resp.Body,
		total:  resp.ContentLength,
		stage:  "Downloading YT-DLP binary...",
	}

	_, copyErr := io.Copy(out, pr)
	out.Close()
	if copyErr != nil {
		return fmt.Errorf("failed to write yt-dlp binary: %w", copyErr)
	}

	// On Windows, kill any running yt-dlp instance before replacing
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/F", "/IM", "yt-dlp.exe").Run()
	}

	var renameErr error
	for attempt := 0; attempt < 5; attempt++ {
		_ = os.Remove(destPath)
		renameErr = os.Rename(tempPath, destPath)
		if renameErr == nil {
			finalized = true
			break
		}
		time.Sleep(150 * time.Millisecond)
	}
	if renameErr != nil {
		return fmt.Errorf("failed to finalize yt-dlp binary: %w", renameErr)
	}

	if runtime.GOOS != "windows" {
		_ = os.Chmod(destPath, 0755)
	}

	log.Printf("[YTDLP] Standalone binary installed successfully at %s\n", destPath)
	return nil
}

type Client struct {
	Executable string
}

func NewClient() *Client {
	return &Client{
		Executable: GetYTDLPExecutable(),
	}
}

func (c *Client) IsInstalled() bool {
	return GetYTDLPExecutable() != ""
}

// IsYTDLPURL checks if a URL belongs to video hosting platforms handled best by yt-dlp.
func IsYTDLPURL(urlStr string) bool {
	if urlStr == "" {
		return false
	}
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Host)
	domains := []string{
		"youtube.com", "youtu.be", "vimeo.com", "dailymotion.com",
		"tiktok.com", "instagram.com", "facebook.com", "fb.watch",
		"twitter.com", "x.com", "twitch.tv", "bilibili.com",
		"soundcloud.com", "reddit.com", "streamable.com", "loom.com",
	}
	for _, d := range domains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

func (c *Client) Install() error {
	// Strictly download standalone portable binary into ~/.thunderdm/bin
	dlErr := downloadYTDLPBinary()
	if dlErr != nil {
		return fmt.Errorf("failed to download standalone yt-dlp binary: %w", dlErr)
	}

	c.Executable = GetYTDLPExecutable()

	// Also install FFmpeg portable binaries into ~/.thunderdm/bin/ alongside yt-dlp
	_ = InstallFFmpeg()

	if !c.IsInstalled() {
		return fmt.Errorf("yt-dlp binary was not found after installation")
	}

	return nil
}

type UpdateResult struct {
	Installed       bool   `json:"installed"`
	Updated         bool   `json:"updated"`
	AlreadyUpdated  bool   `json:"alreadyUpdated"`
	PreviousVersion string `json:"previousVersion"`
	CurrentVersion  string `json:"currentVersion"`
	Message         string `json:"message"`
}

var (
	cachedYtdlpVersion    string
	cachedYtdlpVersionMu  sync.RWMutex
	cachedYtdlpVersionExp time.Time
)

func (c *Client) CheckUpdate() (string, error) {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return "", fmt.Errorf("yt-dlp is not installed")
	}
	c.Executable = exe

	cachedYtdlpVersionMu.RLock()
	if cachedYtdlpVersion != "" && time.Now().Before(cachedYtdlpVersionExp) {
		ver := cachedYtdlpVersion
		cachedYtdlpVersionMu.RUnlock()
		return ver, nil
	}
	cachedYtdlpVersionMu.RUnlock()

	cmd := PrepareCmd(exec.Command(c.Executable, "--version"))
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to check current version: %w", err)
	}

	ver := strings.TrimSpace(out.String())
	if ver != "" {
		cachedYtdlpVersionMu.Lock()
		cachedYtdlpVersion = ver
		cachedYtdlpVersionExp = time.Now().Add(5 * time.Minute)
		cachedYtdlpVersionMu.Unlock()
	}

	return ver, nil
}

func (c *Client) Update() error {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	// Try yt-dlp built-in self-update first
	cmd := PrepareCmd(exec.Command(c.Executable, "-U"))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err == nil {
		return nil
	}

	// Fallback to downloading latest standalone binary directly from GitHub
	return downloadYTDLPBinary()
}

// CheckAndUpdate checks if yt-dlp is installed, runs an update check/apply, and returns structured result.
func (c *Client) CheckAndUpdate() (*UpdateResult, error) {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return &UpdateResult{
			Installed: false,
			Message:   "yt-dlp is not installed in ThunderDM",
		}, nil
	}
	c.Executable = exe

	prevVersion, _ := c.CheckUpdate()

	// 1. First try yt-dlp built-in update (-U)
	cmd := PrepareCmd(exec.Command(c.Executable, "-U"))
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()

	outStr := strings.TrimSpace(out.String())
	lowerOut := strings.ToLower(outStr)

	if err == nil || strings.Contains(lowerOut, "up to date") || strings.Contains(lowerOut, "is up-to-date") || strings.Contains(lowerOut, "latest version") || strings.Contains(lowerOut, "updated") {
		// Reset cached version to get fresh version
		cachedYtdlpVersionMu.Lock()
		cachedYtdlpVersion = ""
		cachedYtdlpVersionExp = time.Time{}
		cachedYtdlpVersionMu.Unlock()

		newVersion, _ := c.CheckUpdate()
		if newVersion == "" {
			newVersion = prevVersion
		}

		if strings.Contains(lowerOut, "updated") || (prevVersion != "" && newVersion != "" && newVersion != prevVersion) {
			return &UpdateResult{
				Installed:       true,
				Updated:         true,
				AlreadyUpdated:  false,
				PreviousVersion: prevVersion,
				CurrentVersion:  newVersion,
				Message:         "yt-dlp updated successfully.",
			}, nil
		}

		return &UpdateResult{
			Installed:       true,
			Updated:         false,
			AlreadyUpdated:  true,
			PreviousVersion: prevVersion,
			CurrentVersion:  newVersion,
			Message:         "yt-dlp is already up to date.",
		}, nil
	}

	// If yt-dlp is already installed and functional, a simple update check should NOT auto-download
	if prevVersion != "" {
		return &UpdateResult{
			Installed:       true,
			Updated:         false,
			AlreadyUpdated:  true,
			PreviousVersion: prevVersion,
			CurrentVersion:  prevVersion,
			Message:         fmt.Sprintf("yt-dlp version %s is installed and ready.", prevVersion),
		}, nil
	}

	// Only if not functional/installed do we download
	if dlErr := downloadYTDLPBinary(); dlErr == nil {
		cachedYtdlpVersionMu.Lock()
		cachedYtdlpVersion = ""
		cachedYtdlpVersionExp = time.Time{}
		cachedYtdlpVersionMu.Unlock()

		newVersion, _ := c.CheckUpdate()
		return &UpdateResult{
			Installed:       true,
			Updated:         true,
			AlreadyUpdated:  false,
			PreviousVersion: prevVersion,
			CurrentVersion:  newVersion,
			Message:         "yt-dlp installed successfully.",
		}, nil
	}

	return &UpdateResult{
		Installed:       false,
		Updated:         false,
		AlreadyUpdated:  false,
		PreviousVersion: "",
		CurrentVersion:  "",
		Message:         "Failed to update yt-dlp.",
	}, nil
}

type VideoMetadata struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Fulltitle   string   `json:"fulltitle"`
	Description string   `json:"description"`
	Uploader    string   `json:"uploader"`
	Channel     string   `json:"channel"`
	Ext         string   `json:"ext"`
	Duration    float64  `json:"duration"`
	Thumbnail   string   `json:"thumbnail"`
	Formats     []Format `json:"formats"`
}

// buildYTDLPEnv prepares environment variables for yt-dlp, filtering out external proxy variables when direct.
func buildYTDLPEnv(urlStr string) []string {
	env := []string{
		"PYTHONIOENCODING=utf-8",
		"PYTHONLEGACYWINDOWSSTDIO=utf-8",
		"LC_ALL=C.UTF-8",
	}
	proxyStr := GetProxyManager().GetProxyStringForURL(urlStr)
	for _, e := range os.Environ() {
		upper := strings.ToUpper(e)
		if proxyStr == "" && (strings.HasPrefix(upper, "HTTP_PROXY=") ||
			strings.HasPrefix(upper, "HTTPS_PROXY=") ||
			strings.HasPrefix(upper, "ALL_PROXY=") ||
			strings.HasPrefix(upper, "NO_PROXY=")) {
			continue // filter out external env proxy when ThunderDM is direct
		}
		env = append(env, e)
	}
	return env
}

// GetVideoMetadata fetches complete video metadata including title and formats using yt-dlp JSON output.
func (c *Client) GetVideoMetadata(urlStr string, cookies ...string) (*VideoMetadata, error) {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return nil, fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	args := []string{"--no-playlist", "--skip-download", "-J"}
	if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
		args = append(args, "--ffmpeg-location", ffmpegLoc)
	}
	if len(cookies) > 0 && cookies[0] != "" {
		args = append(args, "--add-header", "Cookie: "+cookies[0])
	}
	if proxyStr := GetProxyManager().GetProxyStringForURL(urlStr); proxyStr != "" {
		args = append(args, "--proxy", proxyStr)
	} else {
		args = append(args, "--proxy", "")
	}
	args = append(args, urlStr)

	cmd := PrepareCmd(exec.Command(c.Executable, args...))
	cmd.Env = buildYTDLPEnv(urlStr)
	var out bytes.Buffer
	cmd.Stdout = &out

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to fetch metadata: %w", err)
	}

	var metadata VideoMetadata
	if err := json.Unmarshal(out.Bytes(), &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse metadata JSON: %w", err)
	}

	var formats []Format
	seenRes := make(map[string]bool)

	for _, f := range metadata.Formats {
		if f.VCodec != "none" && f.VCodec != "images" && f.Resolution != "" && f.Resolution != "audio only" {
			if !seenRes[f.Resolution] {
				seenRes[f.Resolution] = true
				formats = append(formats, f)
			}
		}
	}
	metadata.Formats = formats

	return &metadata, nil
}

// GetFormats fetches formats and filters to return video and audio options.
func (c *Client) GetFormats(urlStr string, cookies ...string) ([]Format, error) {
	meta, err := c.GetVideoMetadata(urlStr, cookies...)
	if err != nil {
		return nil, err
	}
	return meta.Formats, nil
}

// Download handles downloading video/audio streams and merging into MP4.
func (c *Client) Download(opts DownloadOptions, progressCallback func(line string)) error {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	args := []string{"--newline", "--no-playlist", "--continue", "--part", "--windows-filenames", "--trim-filenames", "120"}
	if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
		args = append(args, "--ffmpeg-location", ffmpegLoc)
	}

	if opts.Cookies != "" {
		args = append(args, "--add-header", "Cookie: "+opts.Cookies)
	}

	if opts.MergeToMP4 {
		args = append(args, "--merge-output-format", "mp4")
	}

	if opts.Quality != "" && opts.Quality != "best" {
		qualityArg := opts.Quality
		if !strings.Contains(qualityArg, "+") {
			qualityArg = qualityArg + "+bestaudio/best"
		}
		args = append(args, "-f", qualityArg)
	}

	if opts.OutputFile != "" {
		args = append(args, "-o", opts.OutputFile)
	}

	if len(opts.ExtraArgs) > 0 {
		args = append(args, opts.ExtraArgs...)
	}

	if proxyStr := GetProxyManager().GetProxyStringForURL(opts.URL); proxyStr != "" {
		args = append(args, "--proxy", proxyStr)
	} else {
		args = append(args, "--proxy", "")
	}

	args = append(args, opts.URL)

	cmd := PrepareCmd(exec.Command(c.Executable, args...))
	cmd.Env = buildYTDLPEnv(opts.URL)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to pipe stdout: %w", err)
	}

	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start download: %w", err)
	}

	go func() {
		buf := make([]byte, 1024)
		var currentLine strings.Builder

		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				for _, r := range chunk {
					if r == '\r' || r == '\n' {
						line := currentLine.String()
						if strings.TrimSpace(line) != "" && progressCallback != nil {
							progressCallback(line)
						}
						currentLine.Reset()
					} else {
						currentLine.WriteRune(r)
					}
				}
			}
			if err != nil {
				break
			}
		}

		if currentLine.Len() > 0 && progressCallback != nil {
			progressCallback(currentLine.String())
		}
	}()

	return cmd.Wait()
}

// --- YTDLPTaskController for ThunderDM Task Engine ---

type YTDLPTaskController struct {
	wailsCtx           context.Context
	ctx                context.Context
	cancel             context.CancelFunc
	cmd                *exec.Cmd
	State              *TaskState
	quality            string
	userAgent          string
	referer            string
	cookies            string
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

var (
	ytdlpResumeRegex   = regexp.MustCompile(`\[download\]\s+Resuming\s+download\s+at\s+byte\s+(\d+)`)
	ytdlpDownloadRegex = regexp.MustCompile(`\[download\]\s+([\d\.]+)%\s+of\s+~?\s*([\d\.]+\s*[A-Za-z]+)(?:\s+at\s+([\d\.]+\s*[A-Za-z/]+))?(?:\s+(?:ETA\s+([\d:]+)|in\s+([\d:]+)))?`)
)

func NewYTDLPTaskController(wailsCtx context.Context, id, rawURL, savePath, filename, quality string, opts ...interface{}) *YTDLPTaskController {
	savePath = NormalizeSavePath(savePath)
	ctx, cancel := context.WithCancel(context.Background())

	if filename == "" {
		filename = "video.mp4"
	}
	filename = SanitizeFilename(filename)
	if quality == "" {
		quality = "best"
	}

	var initDL, initTot int64
	var userAgent, referer, cookies string
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
		case DownloadExtraOptions:
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
		}
	}

	tc := &YTDLPTaskController{
		wailsCtx:  wailsCtx,
		ctx:       ctx,
		cancel:    cancel,
		quality:   quality,
		userAgent: userAgent,
		referer:   referer,
		cookies:   cookies,
		State: &TaskState{
			ID:             id,
			URL:            rawURL,
			SavePath:       savePath,
			Filename:       filename,
			DestFilePath:   filepath.Join(savePath, filename),
			Status:         StatusPending,
			Protocol:       "Yt-DLP",
			IsHLS:          false,
			UserAgent:      userAgent,
			Referer:        referer,
			Cookies:        cookies,
			ShowCompletion: showCompletion,
		},
	}

	if initDL > 0 {
		tc.downloaded.Store(initDL)
		tc.prevStreamsTotal.Store(initDL)
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

func parseYTDLPLine(line string) (percent float64, totalBytes int64, downloadedBytes int64, speed float64, eta float64, isMerging bool, matched bool) {
	if strings.Contains(line, "[Merger]") || strings.Contains(line, "[ExtractAudio]") || strings.Contains(line, "Merging formats") || strings.Contains(line, "Deleting original file") {
		return 100.0, 0, 0, 0, 0, true, true
	}

	if resMatches := ytdlpResumeRegex.FindStringSubmatch(line); len(resMatches) > 1 {
		resByte, err := strconv.ParseInt(resMatches[1], 10, 64)
		if err == nil && resByte > 0 {
			return 0, 0, resByte, 0, 0, false, true
		}
	}

	matches := ytdlpDownloadRegex.FindStringSubmatch(line)
	if len(matches) > 1 {
		matched = true
		p, _ := strconv.ParseFloat(matches[1], 64)
		percent = p

		if len(matches) > 2 && matches[2] != "" {
			totalBytes = parseSizeStringToBytes(matches[2])
			if totalBytes > 0 && percent > 0 {
				downloadedBytes = int64(float64(totalBytes) * (percent / 100.0))
			}
		}

		if len(matches) > 3 && matches[3] != "" {
			speed = parseSpeedStringToBytesPerSec(matches[3])
		}

		if len(matches) > 4 && matches[4] != "" {
			eta = parseETAToSeconds(matches[4])
		}
	}
	return
}

func parseSizeStringToBytes(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	var numStr strings.Builder
	var unitStr strings.Builder
	for i, r := range s {
		if (r >= '0' && r <= '9') || r == '.' {
			if unitStr.Len() == 0 {
				numStr.WriteRune(r)
			}
		} else if r != ' ' {
			unitStr.WriteString(s[i:])
			break
		}
	}

	val, err := strconv.ParseFloat(numStr.String(), 64)
	if err != nil {
		return 0
	}
	unit := strings.ToUpper(strings.TrimSpace(unitStr.String()))
	switch {
	case strings.HasPrefix(unit, "GIB") || strings.HasPrefix(unit, "GB"):
		return int64(val * 1024 * 1024 * 1024)
	case strings.HasPrefix(unit, "MIB") || strings.HasPrefix(unit, "MB"):
		return int64(val * 1024 * 1024)
	case strings.HasPrefix(unit, "KIB") || strings.HasPrefix(unit, "KB"):
		return int64(val * 1024)
	case strings.HasPrefix(unit, "B"):
		return int64(val)
	default:
		return int64(val)
	}
}

func parseSpeedStringToBytesPerSec(s string) float64 {
	s = strings.TrimSuffix(strings.TrimSpace(s), "/s")
	s = strings.TrimSuffix(s, "/S")
	if s == "" {
		return 0
	}
	var numStr strings.Builder
	var unitStr strings.Builder
	for i, r := range s {
		if (r >= '0' && r <= '9') || r == '.' {
			if unitStr.Len() == 0 {
				numStr.WriteRune(r)
			}
		} else if r != ' ' {
			unitStr.WriteString(s[i:])
			break
		}
	}

	val, err := strconv.ParseFloat(numStr.String(), 64)
	if err != nil {
		return 0
	}
	unit := strings.ToUpper(strings.TrimSpace(unitStr.String()))
	switch {
	case strings.HasPrefix(unit, "GIB") || strings.HasPrefix(unit, "GB"):
		return val * 1024 * 1024 * 1024
	case strings.HasPrefix(unit, "MIB") || strings.HasPrefix(unit, "MB"):
		return val * 1024 * 1024
	case strings.HasPrefix(unit, "KIB") || strings.HasPrefix(unit, "KB"):
		return val * 1024
	case strings.HasPrefix(unit, "B"):
		return val
	default:
		return val
	}
}

func parseETAToSeconds(s string) float64 {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) == 2 {
		m, _ := strconv.Atoi(parts[0])
		sec, _ := strconv.Atoi(parts[1])
		return float64(m*60 + sec)
	} else if len(parts) == 3 {
		h, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		sec, _ := strconv.Atoi(parts[2])
		return float64(h*3600 + m*60 + sec)
	}
	return 0
}

func (t *YTDLPTaskController) Start() {
	t.mu.Lock()
	if t.isCanceled || t.isPaused || t.cmd != nil {
		t.mu.Unlock()
		return
	}
	t.State.Status = StatusDownloading
	t.mu.Unlock()

	cleanFilename := SanitizeFilename(t.State.Filename)
	quality := strings.ToLower(t.quality)
	if !strings.Contains(cleanFilename, ".") {
		if quality == "audio" || quality == "audio_only" || quality == "mp3" {
			cleanFilename = cleanFilename + ".mp3"
		} else {
			cleanFilename = cleanFilename + ".mp4"
		}
	}
	t.State.Filename = cleanFilename

	client := NewClient()
	if !client.IsInstalled() {
		t.handleError(fmt.Errorf("YT-DLP is not installed on your system. Please install YT-DLP to download video/audio streams."))
		return
	}

	log.Printf("[YTDLPTaskController] Starting YT-DLP download for Task %s, URL: %s, Filename: %s, Quality: %s\n", t.State.ID, t.State.URL, t.State.Filename, t.quality)

	args := []string{"--newline", "--no-playlist", "--continue", "--part", "--windows-filenames", "--trim-filenames", "120"}
	if ffmpegLoc := GetFFmpegLocation(); ffmpegLoc != "" {
		args = append(args, "--ffmpeg-location", ffmpegLoc)
	}
	if quality == "audio" || quality == "audio_only" || quality == "mp3" {
		args = append(args, "-f", "bestaudio/best", "-x", "--audio-format", "mp3")
	} else if quality == "1080p" {
		args = append(args, "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "--merge-output-format", "mp4")
	} else if quality == "720p" {
		args = append(args, "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best", "--merge-output-format", "mp4")
	} else if quality == "480p" {
		args = append(args, "-f", "bestvideo[height<=480]+bestaudio/best[height<=480]/best", "--merge-output-format", "mp4")
	} else if quality == "360p" {
		args = append(args, "-f", "bestvideo[height<=360]+bestaudio/best[height<=360]/best", "--merge-output-format", "mp4")
	} else if quality != "" && quality != "best" {
		qualityArg := t.quality
		if !strings.Contains(qualityArg, "+") {
			qualityArg = qualityArg + "+bestaudio/best"
		}
		args = append(args, "-f", qualityArg, "--merge-output-format", "mp4")
	} else {
		args = append(args, "-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4")
	}

	if t.cookies != "" {
		args = append(args, "--add-header", "Cookie: "+t.cookies)
	} else if t.State.Cookies != "" {
		args = append(args, "--add-header", "Cookie: "+t.State.Cookies)
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

	outTemplate := filepath.Join(t.State.SavePath, t.State.Filename)
	args = append(args, "-o", outTemplate)

	if proxyStr := GetProxyManager().GetProxyStringForURL(t.State.URL); proxyStr != "" {
		args = append(args, "--proxy", proxyStr)
	} else {
		args = append(args, "--proxy", "")
	}

	args = append(args, t.State.URL)

	exePath := GetYTDLPExecutable()
	if exePath == "" {
		t.handleError(fmt.Errorf("YT-DLP is not installed in ThunderDM. Please install media tools from the menu."))
		return
	}
	t.cmd = PrepareCmd(exec.CommandContext(t.ctx, exePath, args...))
	t.cmd.Env = buildYTDLPEnv(t.State.URL)

	stdout, err := t.cmd.StdoutPipe()
	if err != nil {
		t.handleError(fmt.Errorf("failed to create stdout pipe: %w", err))
		return
	}

	t.cmd.Stderr = os.Stderr

	if err := t.cmd.Start(); err != nil {
		t.handleError(fmt.Errorf("failed to execute ThunderDM YT-DLP: %w", err))
		return
	}

	// Read stdout lines asynchronously
	go func() {
		buf := make([]byte, 1024)
		var lineBuf strings.Builder

		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				for _, r := range chunk {
					if r == '\r' || r == '\n' {
						line := lineBuf.String()
						if strings.TrimSpace(line) != "" {
							t.processOutputLine(line)
						}
						lineBuf.Reset()
					} else {
						lineBuf.WriteRune(r)
					}
				}
			}
			if err != nil {
				break
			}
		}
		if lineBuf.Len() > 0 {
			t.processOutputLine(lineBuf.String())
		}
	}()

	// Periodic progress emitter
	go func() {
		ticker := time.NewTicker(GetProgressInterval())
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

	err = t.cmd.Wait()

	t.mu.Lock()
	t.cmd = nil
	defer t.mu.Unlock()

	if t.isPaused {
		t.State.Status = StatusPaused
		t.emitProgress()
		return
	}

	if t.isCanceled {
		t.State.Status = StatusCanceled
		t.emitProgress()
		return
	}

	if err != nil {
		t.handleError(fmt.Errorf("yt-dlp download failed: %w", err))
		return
	}

	// Successfully completed
	t.State.Status = StatusFinished

	// Stat the actual finished file size on disk for 100% precision
	destPath := filepath.Join(t.State.SavePath, t.State.Filename)
	resolvedPath := ResolveExistingFilePath(destPath)
	var finalSize int64
	if fi, err := os.Stat(resolvedPath); err == nil && fi.Size() > 0 {
		finalSize = fi.Size()
		t.State.Filename = filepath.Base(resolvedPath)
		t.State.DestFilePath = resolvedPath
	}

	if finalSize > 0 {
		t.totalBytes.Store(finalSize)
		t.downloaded.Store(finalSize)
		t.State.TotalSize = finalSize
	} else if t.totalBytes.Load() > 0 {
		t.downloaded.Store(t.totalBytes.Load())
	}

	t.speedVal.Store(0)
	t.etaVal.Store(0)

	t.emitProgress()

	log.Printf("[YTDLPTaskController] Task %s completed successfully: %s (Size: %d bytes)\n", t.State.ID, t.State.DestFilePath, t.downloaded.Load())

	// Emit completion event
	if application.Get() != nil {
		completedPayload := map[string]interface{}{
			"id":             t.State.ID,
			"task_id":        t.State.ID,
			"filename":       t.State.Filename,
			"save_path":      t.State.SavePath,
			"dest_file_path": t.State.DestFilePath,
			"filePath":       t.State.DestFilePath,
			"total_size":     t.downloaded.Load(),
			"downloaded":     t.downloaded.Load(),
			"showCompletion": t.State.ShowCompletion,
		}
		LatestDownloadCompletedPayload = completedPayload
		if OnDownloadCompleted != nil {
			OnDownloadCompleted(completedPayload)
		}
		application.Get().Event.Emit("download-completed", completedPayload)
	}
}

func (t *YTDLPTaskController) processOutputLine(line string) {
	if strings.Contains(line, "[download] Destination:") {
		// A new stream format is starting. If we had a previous stream downloaded, accumulate its total!
		currTot := t.currentStreamTotal.Load()
		if currTot > 0 {
			t.prevStreamsTotal.Add(currTot)
			t.currentStreamTotal.Store(0)
			t.currentStreamDL.Store(0)
		}
	}

	percent, total, dl, speed, eta, isMerging, matched := parseYTDLPLine(line)
	if isMerging {
		t.mu.Lock()
		t.State.Status = StatusMerging
		t.mu.Unlock()
		t.emitProgress()
		return
	}

	if matched {
		if total > 0 {
			t.currentStreamTotal.Store(total)
		}
		if dl > 0 {
			t.currentStreamDL.Store(dl)
		}

		overallTotal := t.prevStreamsTotal.Load() + t.currentStreamTotal.Load()
		overallDL := t.prevStreamsTotal.Load() + t.currentStreamDL.Load()

		if overallTotal > 0 {
			t.totalBytes.Store(overallTotal)
			t.State.TotalSize = overallTotal
		}
		if overallDL > 0 {
			t.downloaded.Store(overallDL)
		}
		if speed > 0 {
			t.speedVal.Store(int64(speed))
		}
		if eta > 0 {
			t.etaVal.Store(int64(eta))
		}
		if overallTotal > 0 && overallDL > 0 {
			t.percentVal.Store(int64(float64(overallDL) / float64(overallTotal) * 100))
		} else if percent > 0 {
			t.percentVal.Store(int64(percent))
		}
	}
}

func (t *YTDLPTaskController) emitProgress() {
	if application.Get() == nil {
		return
	}

	dl := t.downloaded.Load()
	tot := t.totalBytes.Load()
	speed := float64(t.speedVal.Load())
	eta := float64(t.etaVal.Load())

	payload := ProgressPayload{
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
		ProxyUsed:       GetProxyManager().GetActiveProxyLabelForURL(t.State.URL),
		ErrorMessage:    t.State.ErrorMessage,
		Error:           t.State.ErrorMessage,
		Chunks:          []ChunkPayload{},
	}

	application.Get().Event.Emit("download-progress", payload)
	application.Get().Event.Emit("download-progress-"+t.State.ID, payload)
	if OnProgressUpdate != nil {
		OnProgressUpdate(t.State.ID, t.State.Filename, dl, tot)
	}
}

func (t *YTDLPTaskController) handleError(err error) {
	t.mu.Lock()
	t.State.Status = StatusError
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

func (t *YTDLPTaskController) Pause() error {
	t.mu.Lock()
	if t.State.Status == StatusFinished || t.State.Status == StatusError || t.State.Status == StatusCanceled || t.State.Status == StatusPaused {
		t.mu.Unlock()
		return nil
	}
	t.isPaused = true
	t.State.Status = StatusPaused
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

		// Check if this file is related to the task
		isRelated := strings.HasPrefix(lowerName, lowerBase) || strings.HasPrefix(lowerName, lowerFilename)
		if !isRelated {
			continue
		}

		// Delete if it's a part/ytdl/temp file or contains .part or .ytdl
		if strings.HasSuffix(lowerName, ".part") ||
			strings.HasSuffix(lowerName, ".ytdl") ||
			strings.HasSuffix(lowerName, ".temp") ||
			strings.Contains(lowerName, ".part") ||
			strings.Contains(lowerName, ".ytdl") {
			fullPath := filepath.Join(savePath, name)
			_ = os.Remove(fullPath)
			log.Printf("[YTDLP] Cleaned up temporary file on cancel: %s\n", fullPath)
		}
	}
}

func (t *YTDLPTaskController) Cancel() error {
	t.mu.Lock()
	if t.State.Status == StatusFinished {
		t.mu.Unlock()
		return nil
	}
	t.isCanceled = true
	t.State.Status = StatusCanceled
	t.mu.Unlock()

	t.cancel()
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}

	// Clean up all temporary files created by yt-dlp ONLY IF DeletePartialOnFileCancel is enabled
	if GetEngineConfig().DeletePartialOnFileCancel {
		CleanYTDLPTempFiles(t.State.SavePath, t.State.Filename)
	}

	t.emitProgress()
	return nil
}

func (t *YTDLPTaskController) UpdateThreadCount(threads int) {
	// Threading is handled internally by YT-DLP stream engine
}

func (t *YTDLPTaskController) UpdateSpeedLimit(speedLimit *int64) {
	// Speed limit is not applicable for YT-DLP
}

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
		"proxy_used":       GetProxyManager().GetActiveProxyLabelForURL(t.State.URL),
		"error_message":    t.State.ErrorMessage,
		"error":            t.State.ErrorMessage,
		"chunks":           []ChunkPayload{},
	}
}
