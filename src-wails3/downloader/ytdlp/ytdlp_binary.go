// ytdlp_binary.go handles yt-dlp binary path resolution, standalone installation,
// version caching, and automatic/self updates.
package ytdlp

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader/proxy"
	"ThunderDM/src-wails3/downloader/sys"
)

// Client wraps the standalone yt-dlp executable for installation, updates, and media probing.
type Client struct {
	Executable string
}

// NewClient creates a yt-dlp Client resolved to the best available binary on disk.
func NewClient() *Client {
	return &Client{
		Executable: GetYTDLPExecutable(),
	}
}

// IsInstalled returns true if a valid yt-dlp executable is available.
func (c *Client) IsInstalled() bool {
	return GetYTDLPExecutable() != ""
}

// GetYTDLPExecutable finds the yt-dlp binary in ~/.thunderdm/bin, app dir, bundle dir, or system PATH.
func GetYTDLPExecutable() string {
	binName := "yt-dlp"
	if runtime.GOOS == "windows" {
		binName = "yt-dlp.exe"
	}

	// 1. Check ~/.thunderdm/bin/
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, ".thunderdm", "bin", binName)
		if isValidExecutableFile(candidate) {
			return candidate
		}
	}

	// 2. Check application directory or executable dir
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates := []string{
			filepath.Join(exeDir, binName),
			filepath.Join(exeDir, "bin", binName),
			// macOS app bundle: /path/to/ThunderDM.app/Contents/Resources/bin/yt-dlp
			filepath.Join(exeDir, "..", "Resources", "bin", binName),
		}
		for _, candidate := range candidates {
			if isValidExecutableFile(candidate) {
				return candidate
			}
		}
	}

	// 3. Fallback to system PATH (e.g. CLI or package manager installed yt-dlp)
	if path, err := exec.LookPath(binName); err == nil && isValidExecutableFile(path) {
		return path
	}
	if binName != "yt-dlp" {
		if path, err := exec.LookPath("yt-dlp"); err == nil && isValidExecutableFile(path) {
			return path
		}
	}

	return ""
}

func isValidExecutableFile(path string) bool {
	if path == "" {
		return false
	}
	fi, err := os.Stat(path)
	return err == nil && !fi.IsDir() && fi.Size() > 0
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
		isStaleTemp := strings.HasSuffix(lowerName, ".tmp") ||
			strings.Contains(lowerName, ".tmp") ||
			strings.HasPrefix(lowerName, "yt-dlp.exe_") ||
			strings.HasPrefix(lowerName, "ffmpeg_dl_")
		if isStaleTemp {
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
				if proxy.GlobalProxyManager != nil {
					return proxy.GlobalProxyManager.GetProxyForURL(req.URL)
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

// Install downloads the standalone portable yt-dlp and FFmpeg binaries into ~/.thunderdm/bin.
func (c *Client) Install() error {
	if dlErr := downloadYTDLPBinary(); dlErr != nil {
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

// UpdateResult holds the outcome of a yt-dlp version check or update operation.
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

func resetCachedYTDLPVersion() {
	cachedYtdlpVersionMu.Lock()
	cachedYtdlpVersion = ""
	cachedYtdlpVersionExp = time.Time{}
	cachedYtdlpVersionMu.Unlock()
}

// CheckUpdate returns the currently installed yt-dlp version string (cached for 5 minutes).
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

	cmd := sys.PrepareCmd(exec.Command(c.Executable, "--version"))
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

// Update updates the installed yt-dlp binary via self-update (-U) or fresh GitHub download.
func (c *Client) Update() error {
	exe := GetYTDLPExecutable()
	if exe == "" {
		return fmt.Errorf("yt-dlp is not installed in ThunderDM")
	}
	c.Executable = exe

	// Try yt-dlp built-in self-update first
	cmd := sys.PrepareCmd(exec.Command(c.Executable, "-U"))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err == nil {
		resetCachedYTDLPVersion()
		return nil
	}

	// Fallback to downloading latest standalone binary directly from GitHub
	err := downloadYTDLPBinary()
	resetCachedYTDLPVersion()
	return err
}

// CheckAndUpdate checks if yt-dlp is installed, runs an update check/apply, and returns a structured result.
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
	cmd := sys.PrepareCmd(exec.Command(c.Executable, "-U"))
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()

	lowerOut := strings.ToLower(strings.TrimSpace(out.String()))
	isUpdateRecognized := err == nil ||
		strings.Contains(lowerOut, "up to date") ||
		strings.Contains(lowerOut, "is up-to-date") ||
		strings.Contains(lowerOut, "latest version") ||
		strings.Contains(lowerOut, "updated")

	if isUpdateRecognized {
		resetCachedYTDLPVersion()
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
		resetCachedYTDLPVersion()
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

// UpdateYTDLP is a package-level convenience wrapper for NewClient().CheckAndUpdate().
func UpdateYTDLP() (*UpdateResult, error) {
	return NewClient().CheckAndUpdate()
}

// buildYTDLPEnv prepares environment variables for yt-dlp, filtering out external proxy variables when direct.
func buildYTDLPEnv(urlStr string) []string {
	env := []string{
		"PYTHONIOENCODING=utf-8",
		"PYTHONLEGACYWINDOWSSTDIO=utf-8",
		"LC_ALL=C.UTF-8",
	}
	proxyStr := proxy.GetProxyManager().GetProxyStringForURL(urlStr)
	for _, e := range os.Environ() {
		upper := strings.ToUpper(e)
		if proxyStr == "" && (strings.HasPrefix(upper, "HTTP_PROXY=") ||
			strings.HasPrefix(upper, "HTTPS_PROXY=") ||
			strings.HasPrefix(upper, "ALL_PROXY=") ||
			strings.HasPrefix(upper, "NO_PROXY=")) {
			continue // Filter out external env proxy when ThunderDM is configured for direct connection
		}
		env = append(env, e)
	}
	return env
}
