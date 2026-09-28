// Package commands exposes Wails v3 service bindings for download management, window orchestration,
// file operations, queues, and system integration.
//
// This file (system.go) defines the SystemCommand service, delegating autostart to commands/autostart,
// font enumeration to commands/fonts, and self-updater/media tools to commands/updater.
package commands

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"

	"ThunderDM/src-wails3/commands/autostart"
	"ThunderDM/src-wails3/commands/fonts"
	"ThunderDM/src-wails3/commands/updater"
	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/server"
	"ThunderDM/src-wails3/utils"

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

func (c *SystemCommand) Shutdown() error {
	return utils.ShutdownSystem()
}

func (c *SystemCommand) Sleep() error {
	return utils.SleepSystem()
}

func (c *SystemCommand) Hibernate() error {
	return utils.HibernateSystem()
}

// IsLaunchOnStartupEnabled checks if the app is registered in Startup across Windows, macOS, and Linux.
func (c *SystemCommand) IsLaunchOnStartupEnabled() (bool, error) {
	return autostart.IsEnabled()
}

// SetLaunchOnStartup enables or disables automatic launch on startup in background mode.
func (c *SystemCommand) SetLaunchOnStartup(enabled bool) error {
	return autostart.SetEnabled(enabled)
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

// OpenSystemProxySettings opens the OS native proxy configuration window.
func (c *SystemCommand) OpenSystemProxySettings() error {
	return downloader.OpenSystemProxySettings()
}

func (c *SystemCommand) OpenSystemProxySettingsCommand() error {
	return c.OpenSystemProxySettings()
}

// GetProxyConfig returns the active proxy settings.
func (c *SystemCommand) GetProxyConfig() downloader.ProxyConfig {
	return downloader.GetProxyManager().GetConfig()
}

func (c *SystemCommand) GetProxyConfigCommand() downloader.ProxyConfig {
	return c.GetProxyConfig()
}

func parseProxyConfigPayload(payload map[string]interface{}) downloader.ProxyConfig {
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

	return cfg
}

// SetProxyConfig updates the proxy configuration.
func (c *SystemCommand) SetProxyConfig(payload map[string]interface{}) error {
	cfg := parseProxyConfigPayload(payload)
	downloader.GetProxyManager().SetConfig(cfg)
	return nil
}

func (c *SystemCommand) SetProxyConfigCommand(payload map[string]interface{}) error {
	return c.SetProxyConfig(payload)
}

// TestProxyConnection tests network connectivity through the specified proxy configuration.
func (c *SystemCommand) TestProxyConnection(payload map[string]interface{}) (downloader.ProxyTestResult, error) {
	cfg := parseProxyConfigPayload(payload)
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

// GetSystemFonts returns all system installed English fonts.
func (c *SystemCommand) GetSystemFonts() ([]string, error) {
	return fonts.GetSystemFonts()
}

func (c *SystemCommand) GetSystemFontsCommand() ([]string, error) {
	return c.GetSystemFonts()
}

// PurgeAllUserData completely deletes user configuration, settings, yt-dlp binaries, and history in ~/.thunderdm, and disables startup registration.
func PurgeAllUserData() error {
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		_ = os.RemoveAll(filepath.Join(home, ".thunderdm"))
		_ = os.RemoveAll(filepath.Join(home, ".ThunderDM"))
	}
	_ = autostart.SetEnabled(false)
	return nil
}

func (c *SystemCommand) PurgeAllUserDataCommand() error {
	return PurgeAllUserData()
}

// GetOpenSourceBackendInfo returns runtime Go version and dependencies from build info.
func (c *SystemCommand) GetOpenSourceBackendInfo() (map[string]interface{}, error) {
	goVer := strings.TrimPrefix(runtime.Version(), "go")
	deps := map[string]string{
		"github.com/wailsapp/wails/v3": "v3.0.0-beta.15",
		"golang.org/x/image":           "v0.45.0",
		"golang.org/x/sys":             "v0.47.0",
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

func (c *SystemCommand) GetAppVersion() string {
	return updater.GetAppVersion(c.app, AppVersion)
}

func (c *SystemCommand) CheckAppUpdate() (map[string]interface{}, error) {
	return updater.CheckAppUpdate(c.app, AppVersion)
}

func (c *SystemCommand) InstallAppUpdate() (map[string]interface{}, error) {
	return updater.InstallAppUpdate(c.app, AppVersion)
}

func (c *SystemCommand) RestartAppForUpdate() (map[string]interface{}, error) {
	return updater.RestartAppForUpdate(c.app)
}

func (c *SystemCommand) LaunchAppUpdateFlow() (map[string]interface{}, error) {
	return updater.LaunchAppUpdateFlow(c.app)
}

func (c *SystemCommand) CheckYTDLP() (map[string]interface{}, error) {
	return updater.CheckYTDLP()
}

func (c *SystemCommand) CheckYTDLPUpdate() (map[string]interface{}, error) {
	return updater.CheckYTDLPUpdate()
}

func (c *SystemCommand) InstallYTDLP() (map[string]interface{}, error) {
	return updater.InstallYTDLP()
}
