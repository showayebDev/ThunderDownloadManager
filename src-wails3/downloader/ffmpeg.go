package downloader

import (
	"archive/zip"
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

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	cachedFFmpegVersion    string
	cachedFFmpegVersionMu  sync.RWMutex
	cachedFFmpegVersionExp time.Time
)

// GetFFmpegExecutable finds ThunderDM's own ffmpeg binary (~/.thunderdm/bin, app dir, or bundle dir).
// It strictly ignores any global/system PATH ffmpeg.
func GetFFmpegExecutable() string {
	binName := "ffmpeg"
	if runtime.GOOS == "windows" {
		binName = "ffmpeg.exe"
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
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, binName)
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate
		}
		candidate2 := filepath.Join(dir, "bin", binName)
		if fi, err := os.Stat(candidate2); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate2
		}
		// macOS app bundle: /path/to/ThunderDM.app/Contents/Resources/bin/ffmpeg
		candidate3 := filepath.Join(dir, "..", "Resources", "bin", binName)
		if fi, err := os.Stat(candidate3); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate3
		}
	}

	return ""
}

// GetFFprobeExecutable finds ThunderDM's own ffprobe binary (~/.thunderdm/bin, app dir, or bundle dir).
// It strictly ignores any global/system PATH ffprobe.
func GetFFprobeExecutable() string {
	binName := "ffprobe"
	if runtime.GOOS == "windows" {
		binName = "ffprobe.exe"
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
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, binName)
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate
		}
		candidate2 := filepath.Join(dir, "bin", binName)
		if fi, err := os.Stat(candidate2); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate2
		}
		// macOS app bundle: /path/to/ThunderDM.app/Contents/Resources/bin/ffprobe
		candidate3 := filepath.Join(dir, "..", "Resources", "bin", binName)
		if fi, err := os.Stat(candidate3); err == nil && !fi.IsDir() && fi.Size() > 0 {
			return candidate3
		}
	}

	return ""
}

// GetFFmpegLocation returns the folder containing ffmpeg to pass to yt-dlp via --ffmpeg-location.
func GetFFmpegLocation() string {
	exe := GetFFmpegExecutable()
	if exe == "" {
		return ""
	}
	return filepath.Dir(exe)
}

// IsFFmpegInstalled returns true if ffmpeg executable is available on the system.
func IsFFmpegInstalled() bool {
	return GetFFmpegExecutable() != ""
}

// CheckFFmpegVersion checks and returns the installed FFmpeg version string.
func CheckFFmpegVersion() (string, error) {
	exe := GetFFmpegExecutable()
	if exe == "" {
		return "", fmt.Errorf("ffmpeg is not installed")
	}

	cachedFFmpegVersionMu.RLock()
	if cachedFFmpegVersion != "" && time.Now().Before(cachedFFmpegVersionExp) {
		ver := cachedFFmpegVersion
		cachedFFmpegVersionMu.RUnlock()
		return ver, nil
	}
	cachedFFmpegVersionMu.RUnlock()

	cmd := PrepareCmd(exec.Command(exe, "-version"))
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("failed to execute ffmpeg -version: %w", err)
	}

	// First line of ffmpeg -version typically: "ffmpeg version 7.1-full_build-www.gyan.dev ..."
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) > 0 {
		firstLine := strings.TrimSpace(lines[0])
		parts := strings.Fields(firstLine)
		ver := firstLine
		if len(parts) >= 3 && parts[0] == "ffmpeg" && parts[1] == "version" {
			ver = parts[2]
		}
		cachedFFmpegVersionMu.Lock()
		cachedFFmpegVersion = ver
		cachedFFmpegVersionExp = time.Now().Add(5 * time.Minute)
		cachedFFmpegVersionMu.Unlock()
		return ver, nil
	}

	return "installed", nil
}

// DownloadFFmpegBinary downloads portable static FFmpeg & FFprobe binaries into ~/.thunderdm/bin/.
func DownloadFFmpegBinary() error {
	mediaToolsInstallMu.Lock()
	defer mediaToolsInstallMu.Unlock()

	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get user home directory: %w", err)
	}

	binDir := filepath.Join(home, ".thunderdm", "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return fmt.Errorf("failed to create bin directory: %w", err)
	}

	switch runtime.GOOS {
	case "windows":
		return downloadFFmpegWindows(binDir)
	case "darwin":
		return downloadFFmpegMacOS(binDir)
	case "linux":
		return downloadFFmpegLinux(binDir)
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

// EmitMediaToolsProgress sends real-time download/installation progress to the frontend UI.
func EmitMediaToolsProgress(stage string, current, total int64) {
	if application.Get() == nil {
		return
	}
	var percent int64
	if total > 0 {
		percent = int64(float64(current) / float64(total) * 100)
		if percent > 100 {
			percent = 100
		}
	}
	application.Get().Event.Emit("media-tools:progress", map[string]interface{}{
		"stage":      stage,
		"percent":    percent,
		"downloaded": current,
		"total":      total,
	})
}

type progressReader struct {
	io.Reader
	total    int64
	current  int64
	stage    string
	lastEmit time.Time
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.Reader.Read(p)
	if n > 0 {
		pr.current += int64(n)
		if time.Since(pr.lastEmit) > 150*time.Millisecond || pr.current == pr.total || err != nil {
			pr.lastEmit = time.Now()
			EmitMediaToolsProgress(pr.stage, pr.current, pr.total)
		}
	}
	return n, err
}

func downloadAndExtractFFmpegZip(urls []string, binDir string) error {
	var lastErr error

	// Clean up any stale temp files in binDir
	if entries, err := os.ReadDir(binDir); err == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "ffmpeg_dl_") || strings.HasSuffix(e.Name(), ".zip.tmp") {
				_ = os.Remove(filepath.Join(binDir, e.Name()))
			}
		}
	}

	for _, downloadURL := range urls {
		log.Printf("[FFmpeg] Downloading FFmpeg archive from %s...\n", downloadURL)
		EmitMediaToolsProgress("Connecting to FFmpeg server...", 0, 0)

		req, err := http.NewRequest("GET", downloadURL, nil)
		if err != nil {
			lastErr = err
			continue
		}
		client := &http.Client{
			Timeout: 15 * time.Minute,
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
			lastErr = fmt.Errorf("failed to fetch FFmpeg package from %s: %w", downloadURL, err)
			log.Printf("[FFmpeg] Request error: %v\n", lastErr)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("FFmpeg download from %s returned status %d", downloadURL, resp.StatusCode)
			log.Printf("[FFmpeg] Status error: %v\n", lastErr)
			continue
		}

		tempZipPath := filepath.Join(binDir, fmt.Sprintf("ffmpeg_dl_%d.zip.tmp", time.Now().UnixNano()))
		_ = os.Remove(tempZipPath)

		out, err := os.OpenFile(tempZipPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			resp.Body.Close()
			lastErr = err
			continue
		}

		pr := &progressReader{
			Reader: resp.Body,
			total:  resp.ContentLength,
			stage:  "Downloading FFmpeg package...",
		}
		EmitMediaToolsProgress("Downloading FFmpeg package...", 0, resp.ContentLength)

		_, copyErr := io.Copy(out, pr)
		resp.Body.Close()
		out.Close()

		if copyErr != nil {
			_ = os.Remove(tempZipPath)
			lastErr = copyErr
			log.Printf("[FFmpeg] Copy error: %v\n", lastErr)
			continue
		}

		EmitMediaToolsProgress("Extracting FFmpeg binaries...", resp.ContentLength, resp.ContentLength)

		// Extract ffmpeg.exe and ffprobe.exe
		r, err := zip.OpenReader(tempZipPath)
		if err != nil {
			_ = os.Remove(tempZipPath)
			lastErr = fmt.Errorf("failed to open FFmpeg zip archive: %w", err)
			log.Printf("[FFmpeg] Zip open error: %v\n", lastErr)
			continue
		}

		extractedCount := 0
		for _, f := range r.File {
			baseName := filepath.Base(f.Name)
			nameLower := strings.ToLower(baseName)
			if nameLower == "ffmpeg.exe" || nameLower == "ffprobe.exe" || (runtime.GOOS != "windows" && (nameLower == "ffmpeg" || nameLower == "ffprobe")) {
				destFile := filepath.Join(binDir, baseName)
				tempDest := destFile + ".tmp"
				_ = os.Remove(tempDest)

				rc, err := f.Open()
				if err != nil {
					continue
				}

				dst, err := os.OpenFile(tempDest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
				if err != nil {
					rc.Close()
					continue
				}

				_, copyErr := io.Copy(dst, rc)
				rc.Close()
				dst.Close()

				if copyErr == nil {
					_ = os.Remove(destFile)
					if err := os.Rename(tempDest, destFile); err == nil {
						extractedCount++
						if runtime.GOOS != "windows" {
							_ = os.Chmod(destFile, 0755)
						}
						log.Printf("[FFmpeg] Extracted %s to %s\n", f.Name, destFile)
					}
				}
			}
		}
		r.Close()
		_ = os.Remove(tempZipPath)

		if extractedCount > 0 {
			log.Printf("[FFmpeg] Successfully installed %d binaries to %s\n", extractedCount, binDir)
			return nil
		}

		lastErr = fmt.Errorf("no ffmpeg binaries found inside archive from %s", downloadURL)
	}

	return lastErr
}

func downloadFFmpegWindows(binDir string) error {
	urls := []string{}
	if runtime.GOARCH == "arm64" {
		urls = append(urls,
			"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip",
		)
	} else if runtime.GOARCH == "386" {
		urls = append(urls,
			"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win32-gpl.zip",
		)
	} else {
		urls = append(urls,
			"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
			"https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
		)
	}

	return downloadAndExtractFFmpegZip(urls, binDir)
}

func downloadFFmpegMacOS(binDir string) error {
	urls := []string{
		"https://evermeet.cx/ffmpeg/getrelease/zip",
	}
	err := downloadAndExtractFFmpegZip(urls, binDir)
	// Also download ffprobe
	_ = downloadAndExtractFFmpegZip([]string{"https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"}, binDir)
	return err
}

func downloadFFmpegLinux(binDir string) error {
	urls := []string{}
	if runtime.GOARCH == "arm64" {
		urls = append(urls,
			"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz",
			"https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
		)
	} else {
		urls = append(urls,
			"https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
			"https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
		)
	}
	return downloadAndExtractFFmpegTar(urls, binDir)
}

func downloadAndExtractFFmpegTar(urls []string, binDir string) error {
	var lastErr error
	for _, downloadURL := range urls {
		log.Printf("[FFmpeg] Downloading FFmpeg archive from %s...\n", downloadURL)
		EmitMediaToolsProgress("Connecting to FFmpeg server...", 0, 0)

		req, err := http.NewRequest("GET", downloadURL, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) ThunderDM")

		client := &http.Client{
			Timeout: 15 * time.Minute,
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
			lastErr = fmt.Errorf("failed to fetch FFmpeg package from %s: %w", downloadURL, err)
			log.Printf("[FFmpeg] Request error: %v\n", lastErr)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("FFmpeg download from %s returned status %d", downloadURL, resp.StatusCode)
			log.Printf("[FFmpeg] Status error: %v\n", lastErr)
			continue
		}

		ext := ".tar.xz"
		if strings.HasSuffix(downloadURL, ".tar.gz") {
			ext = ".tar.gz"
		}
		tempTarPath := filepath.Join(binDir, fmt.Sprintf("ffmpeg_dl_%d%s.tmp", time.Now().UnixNano(), ext))
		_ = os.Remove(tempTarPath)

		out, err := os.OpenFile(tempTarPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			resp.Body.Close()
			lastErr = err
			continue
		}

		pr := &progressReader{
			Reader: resp.Body,
			total:  resp.ContentLength,
			stage:  "Downloading FFmpeg package...",
		}
		EmitMediaToolsProgress("Downloading FFmpeg package...", 0, resp.ContentLength)

		_, copyErr := io.Copy(out, pr)
		resp.Body.Close()
		out.Close()

		if copyErr != nil {
			_ = os.Remove(tempTarPath)
			lastErr = copyErr
			continue
		}

		EmitMediaToolsProgress("Extracting FFmpeg binaries...", resp.ContentLength, resp.ContentLength)

		extractCmd := PrepareCmd(exec.Command("tar", "-xf", tempTarPath, "-C", binDir))
		if err := extractCmd.Run(); err == nil {
			_ = os.Remove(tempTarPath)
			// Move ffmpeg / ffprobe from any extracted subfolder to binDir
			_ = filepath.Walk(binDir, func(path string, info os.FileInfo, err error) error {
				if err != nil || info.IsDir() {
					return nil
				}
				nameLower := strings.ToLower(info.Name())
				if nameLower == "ffmpeg" || nameLower == "ffprobe" {
					target := filepath.Join(binDir, info.Name())
					if path != target {
						_ = os.Rename(path, target)
					}
					_ = os.Chmod(target, 0755)
				}
				return nil
			})
			if IsFFmpegInstalled() {
				return nil
			}
		} else {
			_ = os.Remove(tempTarPath)
			lastErr = fmt.Errorf("failed to extract tar archive: %w", err)
		}
	}
	return lastErr
}

// InstallFFmpeg installs portable static FFmpeg binaries into ~/.thunderdm/bin/.
// It strictly uses standalone downloads without modifying system package managers.
func InstallFFmpeg() error {
	if IsFFmpegInstalled() {
		return nil
	}

	dlErr := DownloadFFmpegBinary()
	if dlErr != nil {
		return fmt.Errorf("failed to install FFmpeg: %w", dlErr)
	}
	if !IsFFmpegInstalled() {
		return fmt.Errorf("FFmpeg binary was not found after installation attempt")
	}
	return nil
}
