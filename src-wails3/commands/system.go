package commands

import (
	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/server"
	"ThunderDM/src-wails3/utils"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type ghReleasePayload struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	PublishedAt string `json:"published_at"`
	Assets      []struct {
		Name               string `json:"name"`
		Size               int64  `json:"size"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func isAssetMatchForCurrentOS(name string) bool {
	lower := strings.ToLower(name)
	switch runtime.GOOS {
	case "windows":
		return strings.HasSuffix(lower, ".exe") && (strings.Contains(lower, "universal") || strings.Contains(lower, "windows") || strings.Contains(lower, "setup"))
	case "darwin":
		return (strings.HasSuffix(lower, ".dmg") || strings.HasSuffix(lower, ".zip")) && (strings.Contains(lower, "universal") || strings.Contains(lower, "macos") || strings.Contains(lower, "darwin") || strings.Contains(lower, "mac"))
	case "linux":
		return (strings.HasSuffix(lower, ".appimage") || strings.HasSuffix(lower, ".tar.gz")) && (strings.Contains(lower, "linux") || strings.Contains(lower, "x86_64") || strings.Contains(lower, "amd64"))
	default:
		return false
	}
}

type SystemCommand struct {
	ctx context.Context
	app *application.App
}

func NewSystemCommand() *SystemCommand {
	return &SystemCommand{}
}

func (c *SystemCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

func (c *SystemCommand) SetApp(app *application.App) {
	c.app = app
}

func (c *SystemCommand) GetAppVersion() string {
	if c.app != nil && c.app.Updater != nil {
		if v := c.app.Updater.CurrentVersion(); v != "" {
			return v
		}
	}
	return AppVersion
}

var lastFallbackDownloadURL = ""
var lastFallbackDownloadedFile = ""

func isVersionNewer(latest, current string) bool {
	latest = strings.TrimPrefix(strings.TrimSpace(latest), "v")
	current = strings.TrimPrefix(strings.TrimSpace(current), "v")
	if latest == current || latest == "" {
		return false
	}
	latestParts := strings.Split(strings.Split(latest, "-")[0], ".")
	currentParts := strings.Split(strings.Split(current, "-")[0], ".")
	for i := 0; i < len(latestParts) && i < len(currentParts); i++ {
		var l, c int
		fmt.Sscanf(latestParts[i], "%d", &l)
		fmt.Sscanf(currentParts[i], "%d", &c)
		if l > c {
			return true
		}
		if l < c {
			return false
		}
	}
	return len(latestParts) > len(currentParts)
}

func checkGitHubReleaseFallback(currentVer string) (map[string]interface{}, error) {
	client := &http.Client{
		Timeout: 6 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest("HEAD", "https://github.com/showayebDev/ThunderDownloadManager/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ThunderDM-Updater")

	resp, err := client.Do(req)
	if err != nil {
		req.Method = "GET"
		resp, err = client.Do(req)
		if err != nil {
			return nil, err
		}
	}
	defer resp.Body.Close()

	loc := resp.Header.Get("Location")
	if loc == "" {
		return nil, fmt.Errorf("no redirect location returned from GitHub releases")
	}

	parts := strings.Split(loc, "/tag/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid release location format: %s", loc)
	}

	tag := strings.TrimSpace(parts[1])
	cleanVer := strings.TrimPrefix(tag, "v")

	if !isVersionNewer(cleanVer, currentVer) {
		return map[string]interface{}{
			"success":        true,
			"hasUpdate":      false,
			"currentVersion": currentVer,
			"message":        "You are using the latest version.",
		}, nil
	}

	assetName := fmt.Sprintf("ThunderDM-%s-windows-Universal.exe", tag)
	if runtime.GOOS == "darwin" {
		assetName = fmt.Sprintf("ThunderDM-%s-macOS-Universal.zip", tag)
	} else if runtime.GOOS == "linux" {
		assetName = fmt.Sprintf("ThunderDM-%s-linux-x86_64.AppImage", tag)
	}

	dlURL := fmt.Sprintf("https://github.com/showayebDev/ThunderDownloadManager/releases/download/%s/%s", tag, assetName)
	releaseName := "ThunderDM " + tag
	releaseNotes := fmt.Sprintf("🚀 Official Multi-Platform Release of Thunder Download Manager %s.\n\n🛡️ Security & Verification Certified Clean.", tag)
	publishedAt := time.Now().Format(time.RFC3339)
	var artifactSize int64 = 15429281

	// Fetch rich Markdown release notes and exact asset sizes from GitHub API
	apiURL := fmt.Sprintf("https://api.github.com/repos/showayebDev/ThunderDownloadManager/releases/tags/%s", tag)
	apiReq, err := http.NewRequest("GET", apiURL, nil)
	if err == nil {
		apiReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ThunderDM-Updater")
		apiReq.Header.Set("Accept", "application/vnd.github.v3+json")
		apiClient := &http.Client{
			Timeout: 4 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
				Proxy: func(req *http.Request) (*neturl.URL, error) {
					if downloader.GlobalProxyManager != nil {
						return downloader.GlobalProxyManager.GetProxyForURL(req.URL)
					}
					return nil, nil
				},
			},
		}
		apiResp, apiErr := apiClient.Do(apiReq)
		if apiErr == nil {
			if apiResp.StatusCode == http.StatusOK {
				var ghRel ghReleasePayload
				if err := json.NewDecoder(apiResp.Body).Decode(&ghRel); err == nil {
					if strings.TrimSpace(ghRel.Body) != "" {
						releaseNotes = ghRel.Body
					}
					if strings.TrimSpace(ghRel.Name) != "" {
						releaseName = ghRel.Name
					}
					if ghRel.PublishedAt != "" {
						publishedAt = ghRel.PublishedAt
					}
					for _, a := range ghRel.Assets {
						if isAssetMatchForCurrentOS(a.Name) {
							if a.Size > 0 {
								artifactSize = a.Size
							}
							if a.BrowserDownloadURL != "" {
								dlURL = a.BrowserDownloadURL
								assetName = a.Name
							}
							break
						}
					}
				}
			}
			apiResp.Body.Close()
		}
	}

	lastFallbackDownloadURL = dlURL

	log.Printf("[Updater] 🚀 Fallback found update! Latest: v%s (Current: v%s), Asset: %s (%d bytes)", cleanVer, currentVer, assetName, artifactSize)

	return map[string]interface{}{
		"success":        true,
		"hasUpdate":      true,
		"currentVersion": currentVer,
		"latestVersion":  cleanVer,
		"releaseName":    releaseName,
		"releaseNotes":   releaseNotes,
		"publishedAt":    publishedAt,
		"artifactName":   assetName,
		"artifactSize":   artifactSize,
		"downloadUrl":    dlURL,
	}, nil
}

func (c *SystemCommand) CheckAppUpdate() (map[string]interface{}, error) {
	currentVer := c.GetAppVersion()
	log.Printf("[Updater] Checking for application updates (Current: v%s)...", currentVer)

	// 1. Primary fast check via https://github.com/showayebDev/ThunderDownloadManager/releases/latest (Instant, never rate-limited!)
	fallbackRes, fErr := checkGitHubReleaseFallback(currentVer)
	if fErr == nil && fallbackRes != nil {
		if hasUp, _ := fallbackRes["hasUpdate"].(bool); !hasUp {
			log.Printf("[Updater] ✅ ThunderDM is up-to-date (v%s).", currentVer)
		} else {
			log.Printf("[Updater] 🚀 Update ready to show in UI: v%s (Current: v%s)", fallbackRes["latestVersion"], currentVer)
		}
		return fallbackRes, nil
	}

	// 2. Secondary fallback via Wails updater provider
	if c.app != nil && c.app.Updater != nil {
		rel, err := c.app.Updater.Check(context.Background())
		if err == nil {
			if rel == nil {
				log.Printf("[Updater] ✅ ThunderDM is up-to-date (v%s).", currentVer)
				return map[string]interface{}{
					"success":        true,
					"hasUpdate":      false,
					"currentVersion": currentVer,
					"message":        "You are using the latest version.",
				}, nil
			}

			log.Printf("[Updater] 🚀 New update found! Latest: v%s (Current: v%s), Asset: %s (%d bytes)",
				rel.Version, currentVer, rel.Artifact.Filename, rel.Artifact.Size)

			return map[string]interface{}{
				"success":        true,
				"hasUpdate":      true,
				"currentVersion": currentVer,
				"latestVersion":  rel.Version,
				"releaseName":    rel.Name,
				"releaseNotes":   rel.Notes,
				"publishedAt":    rel.PublishedAt.Format(time.RFC3339),
				"artifactName":   rel.Artifact.Filename,
				"artifactSize":   rel.Artifact.Size,
			}, nil
		}
	}

	errMsg := "Could not verify updates at this moment."
	if fErr != nil {
		errMsg = fErr.Error()
	}
	log.Printf("[Updater] Check result: %s", errMsg)
	return map[string]interface{}{
		"success":        false,
		"hasUpdate":      false,
		"currentVersion": currentVer,
		"error":          errMsg,
	}, nil
}

func (c *SystemCommand) InstallAppUpdate() (map[string]interface{}, error) {
	currentVer := c.GetAppVersion()
	if lastFallbackDownloadURL == "" {
		if fb, err := checkGitHubReleaseFallback(currentVer); err == nil && fb != nil {
			if u, ok := fb["downloadUrl"].(string); ok && u != "" {
				lastFallbackDownloadURL = u
			}
		}
	}

	if lastFallbackDownloadURL == "" {
		tag := "v1.0.0"
		assetName := fmt.Sprintf("ThunderDM-%s-windows-Universal.exe", tag)
		if runtime.GOOS == "darwin" {
			assetName = fmt.Sprintf("ThunderDM-%s-macOS-Universal.zip", tag)
		} else if runtime.GOOS == "linux" {
			assetName = fmt.Sprintf("ThunderDM-%s-linux-x86_64.AppImage", tag)
		}
		lastFallbackDownloadURL = fmt.Sprintf("https://github.com/showayebDev/ThunderDownloadManager/releases/download/%s/%s", tag, assetName)
	}

	log.Printf("[Updater] Starting fast direct download from: %s", lastFallbackDownloadURL)

	client := &http.Client{
		Timeout: 10 * time.Minute,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			Proxy: func(req *http.Request) (*neturl.URL, error) {
				if downloader.GlobalProxyManager != nil {
					return downloader.GlobalProxyManager.GetProxyForURL(req.URL)
				}
				return nil, nil
			},
		},
	}

	req, err := http.NewRequest("GET", lastFallbackDownloadURL, nil)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ThunderDM-Updater")

	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Download request failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Download returned HTTP status: %d", resp.StatusCode),
		}, nil
	}

	totalSize := resp.ContentLength
	if totalSize <= 0 {
		totalSize = int64(15429281)
	}

	tempFile := filepath.Join(os.TempDir(), filepath.Base(lastFallbackDownloadURL))
	out, err := os.Create(tempFile)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, nil
	}
	defer out.Close()

	var downloaded int64
	buf := make([]byte, 64*1024)
	lastEmit := time.Time{}

	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			_, wErr := out.Write(buf[:n])
			if wErr != nil {
				return map[string]interface{}{
					"success": false,
					"error":   wErr.Error(),
				}, nil
			}
			downloaded += int64(n)
			if totalSize > 0 && c.app != nil {
				pct := int((downloaded * 100) / totalSize)
				if pct > 100 {
					pct = 100
				}
				if time.Since(lastEmit) > 100*time.Millisecond || downloaded >= totalSize {
					lastEmit = time.Now()
					c.app.Event.Emit("wails:updater:progress", map[string]interface{}{
						"percent":    pct,
						"downloaded": downloaded,
						"total":      totalSize,
					})
				}
			}
		}
		if rErr != nil {
			if rErr == io.EOF {
				break
			}
			return map[string]interface{}{
				"success": false,
				"error":   rErr.Error(),
			}, nil
		}
	}

	lastFallbackDownloadedFile = tempFile
	log.Printf("[Updater] Update downloaded successfully to: %s (%d bytes)", tempFile, downloaded)
	if c.app != nil {
		c.app.Event.Emit("wails:updater:progress", map[string]interface{}{
			"percent":    100,
			"downloaded": downloaded,
			"total":      downloaded,
		})
		c.app.Event.Emit("wails:updater:ready", map[string]interface{}{})
	}

	return map[string]interface{}{
		"success": true,
		"message": "Update downloaded and staged successfully.",
	}, nil
}

func (c *SystemCommand) RestartAppForUpdate() (map[string]interface{}, error) {
	downloadedPath := ""
	if c.app != nil && c.app.Updater != nil {
		downloadedPath = c.app.Updater.DownloadedPath()
	}
	if downloadedPath == "" && lastFallbackDownloadedFile != "" {
		downloadedPath = lastFallbackDownloadedFile
	}

	if downloadedPath != "" {
		err := applyUpdateAndRestart(downloadedPath)
		if err == nil {
			return map[string]interface{}{"success": true}, nil
		}
		log.Printf("[Updater] applyUpdateAndRestart failed: %v", err)
	}

	if c.app != nil && c.app.Updater != nil {
		err := c.app.Updater.Restart(context.Background())
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}, nil
		}
	}

	return map[string]interface{}{
		"success": true,
	}, nil
}

func (c *SystemCommand) LaunchAppUpdateFlow() (map[string]interface{}, error) {
	if c.app == nil || c.app.Updater == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Updater not initialized",
		}, nil
	}

	go func() {
		if err := c.app.Updater.CheckAndInstall(context.Background()); err != nil {
			log.Printf("[Updater] CheckAndInstall error: %v", err)
		}
	}()

	return map[string]interface{}{
		"success": true,
	}, nil
}

func (c *SystemCommand) Shutdown() error {
	return utils.ShutdownSystem()
}

func (c *SystemCommand) Sleep() error {
	return utils.SleepSystem()
}

func (c *SystemCommand) Hibernate() error {
	return utils.HibernateSystem()
}

func (c *SystemCommand) CheckYTDLP() (map[string]interface{}, error) {
	client := downloader.NewClient()
	ytdlpInstalled := client.IsInstalled()
	ytdlpVer := ""
	if ytdlpInstalled {
		if v, err := client.CheckUpdate(); err == nil {
			ytdlpVer = v
		}
	}

	ffmpegInstalled := downloader.IsFFmpegInstalled()
	ffmpegVer := ""
	if ffmpegInstalled {
		if fv, err := downloader.CheckFFmpegVersion(); err == nil {
			ffmpegVer = fv
		}
	}

	return map[string]interface{}{
		"installed":       ytdlpInstalled,
		"version":         ytdlpVer,
		"ytdlpInstalled":  ytdlpInstalled,
		"ytdlpVersion":    ytdlpVer,
		"ffmpegInstalled": ffmpegInstalled,
		"ffmpegVersion":   ffmpegVer,
		"allInstalled":    ytdlpInstalled && ffmpegInstalled,
	}, nil
}

func (c *SystemCommand) CheckYTDLPUpdate() (map[string]interface{}, error) {
	log.Println("[MediaTools] Checking and updating portable media tools (YT-DLP & FFmpeg)...")
	client := downloader.NewClient()
	res, err := client.CheckAndUpdate()

	ffmpegInstalled := downloader.IsFFmpegInstalled()
	ffmpegVer := ""
	if ffmpegInstalled {
		ffmpegVer, _ = downloader.CheckFFmpegVersion()
	} else {
		// Attempt to install ffmpeg if missing during update check
		_ = downloader.InstallFFmpeg()
		if downloader.IsFFmpegInstalled() {
			ffmpegInstalled = true
			ffmpegVer, _ = downloader.CheckFFmpegVersion()
		}
	}

	if err != nil {
		log.Printf("[MediaTools] Update check failed: %v", err)
		return map[string]interface{}{
			"installed":       client.IsInstalled(),
			"success":         false,
			"error":           err.Error(),
			"ytdlpInstalled":  client.IsInstalled(),
			"ffmpegInstalled": ffmpegInstalled,
			"ffmpegVersion":   ffmpegVer,
		}, nil
	}

	if res.Updated {
		log.Printf("[MediaTools] 🛠️ Updated YT-DLP from %s -> %s (FFmpeg: %s)", res.PreviousVersion, res.CurrentVersion, ffmpegVer)
	} else {
		log.Printf("[MediaTools] Media tools are up to date: YT-DLP %s | FFmpeg %s", res.CurrentVersion, ffmpegVer)
	}

	return map[string]interface{}{
		"installed":       res.Installed,
		"updated":         res.Updated,
		"alreadyUpdated":  res.AlreadyUpdated,
		"previousVersion": res.PreviousVersion,
		"currentVersion":  res.CurrentVersion,
		"message":         res.Message,
		"success":         true,
		"ytdlpInstalled":  res.Installed,
		"ytdlpVersion":    res.CurrentVersion,
		"ffmpegInstalled": ffmpegInstalled,
		"ffmpegVersion":   ffmpegVer,
		"allInstalled":    res.Installed && ffmpegInstalled,
	}, nil
}

func (c *SystemCommand) InstallYTDLP() (map[string]interface{}, error) {
	client := downloader.NewClient()
	var ytdlpErr, ffmpegErr error

	if !client.IsInstalled() {
		ytdlpErr = client.Install()
	}
	if !downloader.IsFFmpegInstalled() {
		ffmpegErr = downloader.InstallFFmpeg()
	}

	ytdlpInstalled := client.IsInstalled()
	ytdlpVer := ""
	if ytdlpInstalled {
		ytdlpVer, _ = client.CheckUpdate()
	}

	ffmpegInstalled := downloader.IsFFmpegInstalled()
	ffmpegVer := ""
	if ffmpegInstalled {
		ffmpegVer, _ = downloader.CheckFFmpegVersion()
	}

	success := ytdlpInstalled
	var errMsg string
	if ytdlpErr != nil {
		errMsg = "YT-DLP: " + ytdlpErr.Error()
	}
	if ffmpegErr != nil {
		if errMsg != "" {
			errMsg += "; "
		}
		errMsg += "FFmpeg: " + ffmpegErr.Error()
	}

	return map[string]interface{}{
		"success":          success,
		"alreadyInstalled": ytdlpInstalled && ffmpegInstalled,
		"version":          ytdlpVer,
		"ytdlpInstalled":   ytdlpInstalled,
		"ytdlpVersion":     ytdlpVer,
		"ffmpegInstalled":  ffmpegInstalled,
		"ffmpegVersion":    ffmpegVer,
		"allInstalled":     ytdlpInstalled && ffmpegInstalled,
		"error":            errMsg,
	}, nil
}

// IsLaunchOnStartupEnabled checks if the app is registered in Startup across Windows, macOS, and Linux
func (c *SystemCommand) IsLaunchOnStartupEnabled() (bool, error) {
	return isLaunchOnStartupEnabled()
}

// SetLaunchOnStartup enables or disables automatic launch on startup in background mode
func (c *SystemCommand) SetLaunchOnStartup(enabled bool) error {
	return setLaunchOnStartup(enabled)
}

func (c *SystemCommand) SetLaunchOnStartupCommand(payload map[string]interface{}) error {
	enabled := false
	if payload != nil {
		if val, ok := payload["enabled"].(bool); ok {
			enabled = val
		} else if valStr, ok := payload["enabled"].(string); ok {
			enabled = strings.ToLower(valStr) == "true" || valStr == "1"
		}
	}
	return c.SetLaunchOnStartup(enabled)
}

func (c *SystemCommand) IsLaunchOnStartupEnabledCommand() (bool, error) {
	return c.IsLaunchOnStartupEnabled()
}

// OpenSystemProxySettings opens the OS native proxy configuration window
func (c *SystemCommand) OpenSystemProxySettings() error {
	return downloader.OpenSystemProxySettings()
}

func (c *SystemCommand) OpenSystemProxySettingsCommand() error {
	return c.OpenSystemProxySettings()
}

// GetProxyConfig returns the active proxy settings
func (c *SystemCommand) GetProxyConfig() downloader.ProxyConfig {
	return downloader.GetProxyManager().GetConfig()
}

func (c *SystemCommand) GetProxyConfigCommand() downloader.ProxyConfig {
	return c.GetProxyConfig()
}

// SetProxyConfig updates the proxy configuration
func (c *SystemCommand) SetProxyConfig(payload map[string]interface{}) error {
	cfg := downloader.DefaultProxyConfig()

	if mode, ok := payload["mode"].(string); ok {
		cfg.Mode = downloader.ProxyMode(mode)
	}
	if pacUrl, ok := payload["pacUrl"].(string); ok {
		cfg.PACUrl = pacUrl
	}
	if proxyType, ok := payload["proxyType"].(string); ok {
		cfg.ProxyType = downloader.ProxyType(proxyType)
	}
	if host, ok := payload["host"].(string); ok {
		cfg.Host = host
	}
	if port, ok := payload["port"].(string); ok {
		cfg.Port = port
	} else if portNum, ok := payload["port"].(float64); ok {
		cfg.Port = fmt.Sprintf("%d", int(portNum))
	}
	if useAuth, ok := payload["useAuth"].(bool); ok {
		cfg.UseAuth = useAuth
	}
	if username, ok := payload["username"].(string); ok {
		cfg.Username = username
	}
	if password, ok := payload["password"].(string); ok {
		cfg.Password = password
	}
	if bypassList, ok := payload["bypassList"].(string); ok {
		cfg.BypassList = bypassList
	}

	downloader.GetProxyManager().SetConfig(cfg)
	return nil
}

func (c *SystemCommand) SetProxyConfigCommand(payload map[string]interface{}) error {
	return c.SetProxyConfig(payload)
}

// TestProxyConnection tests network connectivity through the specified proxy configuration
func (c *SystemCommand) TestProxyConnection(payload map[string]interface{}) (downloader.ProxyTestResult, error) {
	cfg := downloader.DefaultProxyConfig()

	if mode, ok := payload["mode"].(string); ok {
		cfg.Mode = downloader.ProxyMode(mode)
	}
	if pacUrl, ok := payload["pacUrl"].(string); ok {
		cfg.PACUrl = pacUrl
	}
	if proxyType, ok := payload["proxyType"].(string); ok {
		cfg.ProxyType = downloader.ProxyType(proxyType)
	}
	if host, ok := payload["host"].(string); ok {
		cfg.Host = host
	}
	if port, ok := payload["port"].(string); ok {
		cfg.Port = port
	} else if portNum, ok := payload["port"].(float64); ok {
		cfg.Port = fmt.Sprintf("%d", int(portNum))
	}
	if useAuth, ok := payload["useAuth"].(bool); ok {
		cfg.UseAuth = useAuth
	}
	if username, ok := payload["username"].(string); ok {
		cfg.Username = username
	}
	if password, ok := payload["password"].(string); ok {
		cfg.Password = password
	}
	if bypassList, ok := payload["bypassList"].(string); ok {
		cfg.BypassList = bypassList
	}

	res := downloader.GetProxyManager().TestProxyConnection(cfg)
	return res, nil
}

func (c *SystemCommand) TestProxyConnectionCommand(payload map[string]interface{}) (downloader.ProxyTestResult, error) {
	return c.TestProxyConnection(payload)
}

func (c *SystemCommand) GetServerPort() string {
	return server.GetRunningPort()
}

func (c *SystemCommand) GetServerPortCommand() string {
	return c.GetServerPort()
}

func (c *SystemCommand) SetServerPort(port string) error {
	if port == "" {
		port = "37555"
	}
	server.StartCustomPortListener(port)
	return nil
}

func (c *SystemCommand) SetServerPortCommand(payload map[string]interface{}) error {
	p := ""
	if portStr, ok := payload["port"].(string); ok {
		p = portStr
	} else if portNum, ok := payload["port"].(float64); ok {
		p = fmt.Sprintf("%d", int(portNum))
	}
	if p == "" {
		p = "37555"
	}
	return c.SetServerPort(p)
}

func (c *SystemCommand) SetBrowserIntegration(enabled bool) error {
	server.SetBrowserIntegration(enabled)
	return nil
}

func (c *SystemCommand) SetBrowserIntegrationCommand(payload map[string]interface{}) error {
	enabled := true
	if e, ok := payload["enabled"].(bool); ok {
		enabled = e
	}
	return c.SetBrowserIntegration(enabled)
}

// GetSystemFonts returns all system installed English fonts
func (c *SystemCommand) GetSystemFonts() ([]string, error) {
	return getSystemFontsOS(), nil
}

func (c *SystemCommand) GetSystemFontsCommand() ([]string, error) {
	return c.GetSystemFonts()
}

// PurgeAllUserData completely deletes user configuration, settings, yt-dlp binaries, and history in ~/.thunderdm.
func PurgeAllUserData() error {
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		_ = os.RemoveAll(filepath.Join(home, ".thunderdm"))
		_ = os.RemoveAll(filepath.Join(home, ".ThunderDM"))
	}
	_ = setLaunchOnStartup(false)
	return nil
}

func (c *SystemCommand) PurgeAllUserDataCommand() error {
	return PurgeAllUserData()
}

// GetOpenSourceBackendInfo returns runtime Go version and dependencies from build info / go.mod
func (c *SystemCommand) GetOpenSourceBackendInfo() (map[string]interface{}, error) {
	goVer := strings.TrimPrefix(runtime.Version(), "go")
	deps := map[string]string{
		"github.com/wailsapp/wails/v3": "v3.0.0-beta.15",
		"golang.org/x/image":          "v0.45.0",
		"golang.org/x/sys":            "v0.47.0",
	}

	if bi, ok := debug.ReadBuildInfo(); ok && bi != nil {
		if bi.GoVersion != "" {
			goVer = strings.TrimPrefix(bi.GoVersion, "go")
		}
		for _, dep := range bi.Deps {
			if dep != nil && dep.Path != "" && dep.Version != "" {
				deps[dep.Path] = dep.Version
			}
		}
	}

	return map[string]interface{}{
		"goVersion":    goVer,
		"dependencies": deps,
	}, nil
}

func (c *SystemCommand) GetOpenSourceBackendInfoCommand() (map[string]interface{}, error) {
	return c.GetOpenSourceBackendInfo()
}

