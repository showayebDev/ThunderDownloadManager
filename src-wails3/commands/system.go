package commands

import (
	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/server"
	"ThunderDM/src-wails3/utils"
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

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

func (c *SystemCommand) CheckAppUpdate() (map[string]interface{}, error) {
	currentVer := c.GetAppVersion()
	if c.app == nil || c.app.Updater == nil {
		return map[string]interface{}{
			"success":        false,
			"hasUpdate":      false,
			"currentVersion": currentVer,
			"error":          "Updater not initialized",
		}, nil
	}

	rel, err := c.app.Updater.Check(context.Background())
	if err != nil {
		log.Printf("[Updater] Check failed: %v", err)
		return map[string]interface{}{
			"success":        false,
			"hasUpdate":      false,
			"currentVersion": currentVer,
			"error":          err.Error(),
		}, nil
	}

	if rel == nil {
		return map[string]interface{}{
			"success":        true,
			"hasUpdate":      false,
			"currentVersion": currentVer,
			"message":        "You are using the latest version.",
		}, nil
	}

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

func (c *SystemCommand) InstallAppUpdate() (map[string]interface{}, error) {
	if c.app == nil || c.app.Updater == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Updater not initialized",
		}, nil
	}

	err := c.app.Updater.DownloadAndInstall(context.Background())
	if err != nil {
		log.Printf("[Updater] DownloadAndInstall failed: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"message": "Update downloaded and verified successfully.",
	}, nil
}

func (c *SystemCommand) RestartAppForUpdate() (map[string]interface{}, error) {
	if c.app == nil || c.app.Updater == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "Updater not initialized",
		}, nil
	}

	downloadedPath := c.app.Updater.DownloadedPath()
	if downloadedPath == "" {
		err := c.app.Updater.Restart(context.Background())
		if err != nil {
			log.Printf("[Updater] Restart failed: %v", err)
			return map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}, nil
		}
		return map[string]interface{}{
			"success": true,
		}, nil
	}

	err := applyUpdateAndRestart(downloadedPath)
	if err != nil {
		log.Printf("[Updater] applyUpdateAndRestart failed: %v, falling back to Wails restart...", err)
		err = c.app.Updater.Restart(context.Background())
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
		return map[string]interface{}{
			"installed":       client.IsInstalled(),
			"success":         false,
			"error":           err.Error(),
			"ytdlpInstalled":  client.IsInstalled(),
			"ffmpegInstalled": ffmpegInstalled,
			"ffmpegVersion":   ffmpegVer,
		}, nil
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

