// proxy.go manages proxy configuration persistence, HTTP transport construction,
// and per-URL proxy resolution for the download engine.
package proxy

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/storage"
)

// SharedHTTPClient provides a high-throughput, connection-pooled HTTP client for all download workers.
var SharedHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy: func(req *http.Request) (*neturl.URL, error) {
			if GlobalProxyManager != nil {
				return GlobalProxyManager.GetProxyForURL(req.URL)
			}
			return nil, nil
		},
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   128, // Allows up to 128 concurrent connections per host
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // Allow self-signed or internal movie server certificates
		},
	},
}

// ProxyMode defines how the engine routes outgoing connections.
type ProxyMode string

const (
	ProxyModeNone   ProxyMode = "none"
	ProxyModeSystem ProxyMode = "system"
	ProxyModePAC    ProxyMode = "pac"
	ProxyModeManual ProxyMode = "manual"
)

// ProxyType defines the protocol used for manual proxy servers.
type ProxyType string

const (
	ProxyTypeHTTP  ProxyType = "HTTP"
	ProxyTypeSOCKS ProxyType = "SOCKS"
)

// ProxyConfig holds the user's proxy configuration.
type ProxyConfig struct {
	Mode       ProxyMode `json:"mode"`       // "none", "system", "pac", "manual"
	PACUrl     string    `json:"pacUrl"`     // "http://localhost/some.pac"
	ProxyType  ProxyType `json:"proxyType"`  // "HTTP" or "SOCKS"
	Host       string    `json:"host"`       // e.g. "127.0.0.1"
	Port       string    `json:"port"`       // e.g. "2080"
	UseAuth    bool      `json:"useAuth"`    // true/false
	Username   string    `json:"username"`   // credentials
	Password   string    `json:"password"`   // credentials
	BypassList string    `json:"bypassList"` // e.g. "example.com 192.168.1.* <local>"
}

// DefaultProxyConfig returns the default direct-connection proxy configuration.
func DefaultProxyConfig() ProxyConfig {
	return ProxyConfig{
		Mode:       ProxyModeNone,
		PACUrl:     "",
		ProxyType:  ProxyTypeHTTP,
		Host:       "",
		Port:       "",
		UseAuth:    false,
		Username:   "",
		Password:   "",
		BypassList: "localhost 127.0.0.1 <local>",
	}
}

// ProxyManager manages proxy state, PAC caching, and dynamic HTTP transport routing.
type ProxyManager struct {
	mu           sync.RWMutex
	config       ProxyConfig
	pacCacheMu   sync.RWMutex
	pacCacheURL  string
	pacScript    string
	pacLastFetch time.Time
	customDialer *net.Dialer
	activeTrans  *http.Transport
}

var (
	GlobalProxyManager *ProxyManager
	proxyOnce          sync.Once
)

// GetProxyManager returns the singleton ProxyManager instance.
func GetProxyManager() *ProxyManager {
	proxyOnce.Do(func() {
		GlobalProxyManager = &ProxyManager{
			config: DefaultProxyConfig(),
			customDialer: &net.Dialer{
				Timeout:   15 * time.Second,
				KeepAlive: 30 * time.Second,
			},
		}
		GlobalProxyManager.loadConfig()
		GlobalProxyManager.rebuildTransport()
	})
	return GlobalProxyManager
}

// InitProxyManager ensures the global proxy manager is initialized.
func InitProxyManager() {
	GetProxyManager()
}

func (pm *ProxyManager) cleanupLegacyFiles() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	dir := filepath.Join(home, ".thunderdm")
	_ = os.Remove(filepath.Join(dir, "download_engine.json"))
	_ = os.Remove(filepath.Join(dir, "proxy_settings.json"))
	_ = os.Remove(filepath.Join(dir, "engine_settings.json"))
	_ = os.Remove(filepath.Join(dir, "settings.json"))
}

func (pm *ProxyManager) loadConfig() {
	var root map[string]interface{}
	cfgLoaded := false

	// Read exclusively from SQLite kv_store
	if val, err := storage.GetKV("download_engine"); err == nil && len(val) > 0 {
		if json.Unmarshal([]byte(val), &root) == nil && root != nil {
			cfgLoaded = true
		}
	}

	pm.cleanupLegacyFiles()

	if !cfgLoaded || root == nil {
		return
	}

	var cfg ProxyConfig
	cfgFound := false

	// Check if proxyConfig is embedded
	if proxyRaw, ok := root["proxyConfig"]; ok && proxyRaw != nil {
		if rawBytes, err := json.Marshal(proxyRaw); err == nil {
			if err := json.Unmarshal(rawBytes, &cfg); err == nil {
				cfgFound = true
			}
		}
	}

	// Fallback to legacy fields if proxyConfig was not present
	if !cfgFound {
		if enabled, ok := root["proxyEnabled"].(bool); ok && enabled {
			cfg.Mode = ProxyModeManual
			cfg.ProxyType = ProxyTypeHTTP
			if h, ok := root["proxyHost"].(string); ok && h != "" {
				cfg.Host = h
			}
			if p, ok := root["proxyPort"].(string); ok && p != "" {
				cfg.Port = p
			}
			cfg.BypassList = "localhost 127.0.0.1 <local>"
			cfgFound = true
		}
	}

	if cfgFound {
		if cfg.Mode == "" {
			cfg.Mode = ProxyModeNone
		}
		if cfg.ProxyType == "" {
			cfg.ProxyType = ProxyTypeHTTP
		}
		if cfg.BypassList == "" {
			cfg.BypassList = "localhost 127.0.0.1 <local>"
		}
		if cfg.Mode == ProxyModeManual {
			if cfg.Host == "" {
				cfg.Host = "127.0.0.1"
			}
			if cfg.Port == "" {
				cfg.Port = "8080"
			}
		}
		pm.config = cfg
	}
}

func (pm *ProxyManager) saveConfig() {
	root := make(map[string]interface{})

	// 1. Read existing SQLite kv_store
	if val, err := storage.GetKV("download_engine"); err == nil && len(val) > 0 {
		_ = json.Unmarshal([]byte(val), &root)
	}

	// Embed proxyConfig
	isProxyEnabled := pm.config.Mode != ProxyModeNone && pm.config.Mode != ""
	root["proxyConfig"] = pm.config
	root["proxyEnabled"] = isProxyEnabled
	if isProxyEnabled {
		root["proxyHost"] = pm.config.Host
		root["proxyPort"] = pm.config.Port
	} else {
		root["proxyHost"] = ""
		root["proxyPort"] = ""
	}

	// Save exclusively to SQLite kv_store
	if data, err := json.Marshal(root); err == nil {
		_ = storage.SetKV("download_engine", string(data))
	}

	pm.cleanupLegacyFiles()
}

// GetConfig returns a thread-safe copy of the active proxy configuration.
func (pm *ProxyManager) GetConfig() ProxyConfig {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.config
}

// SetConfig updates the proxy configuration, persists it to storage, and rebuilds the HTTP transport.
func (pm *ProxyManager) SetConfig(cfg ProxyConfig) {
	pm.mu.Lock()
	pm.config = cfg
	pm.saveConfig()
	pm.rebuildTransportLocked()
	pm.mu.Unlock()
}

func (pm *ProxyManager) rebuildTransport() {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.rebuildTransportLocked()
}

func (pm *ProxyManager) rebuildTransportLocked() {
	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		MaxIdleConns:          128,
		MaxIdleConnsPerHost:   64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
	}

	// Dynamic proxy function that checks target request URL in real time
	transport.Proxy = func(req *http.Request) (*neturl.URL, error) {
		return pm.GetProxyForURL(req.URL)
	}

	pm.activeTrans = transport

	// Apply transport directly to SharedHTTPClient
	SharedHTTPClient.Transport = transport
}

// GetProxyForURL determines the proxy URL (if any) to use for a specific target URL.
func (pm *ProxyManager) GetProxyForURL(targetURL *neturl.URL) (*neturl.URL, error) {
	if targetURL == nil {
		return nil, nil
	}

	pm.mu.RLock()
	cfg := pm.config
	pm.mu.RUnlock()

	switch cfg.Mode {
	case ProxyModeNone, "":
		return nil, nil

	case ProxyModeSystem:
		// 1. Try Go's built-in environment-based proxy resolver (reads HTTP_PROXY, HTTPS_PROXY, NO_PROXY, ALL_PROXY)
		req := &http.Request{URL: targetURL}
		if envProxy, err := http.ProxyFromEnvironment(req); err == nil && envProxy != nil {
			return envProxy, nil
		}
		// 2. Query OS-level system proxy settings (Windows Registry / Network Settings)
		return pm.getSystemProxyOS(targetURL)

	case ProxyModePAC:
		if strings.TrimSpace(cfg.PACUrl) == "" {
			return nil, nil
		}
		proxyStr := pm.resolvePACProxy(cfg.PACUrl, targetURL.String(), targetURL.Hostname())
		if proxyStr == "" || strings.EqualFold(proxyStr, "DIRECT") {
			return nil, nil
		}
		return neturl.Parse(proxyStr)

	case ProxyModeManual:
		host := targetURL.Hostname()
		if pm.IsHostBypassed(host, cfg.BypassList) {
			return nil, nil
		}
		proxyURLStr := pm.buildManualProxyURLString(cfg)
		if proxyURLStr == "" {
			return nil, nil
		}
		return neturl.Parse(proxyURLStr)

	default:
		return nil, nil
	}
}

// GetProxyStringForURL returns a proxy URL string for external tools (e.g. yt-dlp), or empty if direct.
func (pm *ProxyManager) GetProxyStringForURL(rawURL string) string {
	parsed, err := neturl.Parse(rawURL)
	if err != nil {
		return ""
	}
	pURL, err := pm.GetProxyForURL(parsed)
	if err != nil || pURL == nil {
		return ""
	}
	return pURL.String()
}

func (pm *ProxyManager) buildManualProxyURLString(cfg ProxyConfig) string {
	host := strings.TrimSpace(cfg.Host)
	port := strings.TrimSpace(cfg.Port)
	if host == "" {
		return ""
	}
	if port == "" {
		port = "8080"
	}

	scheme := "http"
	if strings.EqualFold(string(cfg.ProxyType), "SOCKS") || strings.EqualFold(string(cfg.ProxyType), "SOCKS5") {
		scheme = "socks5"
	}

	if cfg.UseAuth && cfg.Username != "" {
		user := neturl.QueryEscape(cfg.Username)
		pass := neturl.QueryEscape(cfg.Password)
		return fmt.Sprintf("%s://%s:%s@%s:%s", scheme, user, pass, host, port)
	}

	return fmt.Sprintf("%s://%s:%s", scheme, host, port)
}

// GetActiveProxyLabelForURL returns a clean user-facing string describing the proxy used for a specific URL, or empty if direct.
func (pm *ProxyManager) GetActiveProxyLabelForURL(rawURL string) string {
	if pm == nil {
		return ""
	}
	pm.mu.RLock()
	cfg := pm.config
	pm.mu.RUnlock()

	if cfg.Mode == ProxyModeNone || cfg.Mode == "" {
		return ""
	}

	parsed, err := neturl.Parse(rawURL)
	if err == nil && parsed != nil && parsed.Hostname() != "" {
		if pm.IsHostBypassed(parsed.Hostname(), cfg.BypassList) {
			return "" // Bypassed by rule
		}
	}

	switch cfg.Mode {
	case ProxyModeManual:
		pType := string(cfg.ProxyType)
		if pType == "" {
			pType = "HTTP"
		}
		return fmt.Sprintf("%s (%s:%s)", pType, cfg.Host, cfg.Port)
	case ProxyModeSystem:
		return "System Proxy"
	case ProxyModePAC:
		return "PAC Proxy"
	default:
		return ""
	}
}

// OpenSystemProxySettings launches the native OS proxy configuration window across Windows, macOS, and Linux.
func OpenSystemProxySettings() error {
	switch runtime.GOOS {
	case "windows":
		// Windows 10/11: Modern Settings page for Network Proxy
		cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", "ms-settings:network-proxy")
		if err := cmd.Start(); err != nil {
			// Fallback: Legacy Internet Properties -> Connections Tab
			fallback := exec.Command("rundll32.exe", "inetcpl.cpl,LaunchConnectionDialog")
			return fallback.Start()
		}
		return nil

	case "darwin":
		// macOS: Open System Settings / System Preferences Network panel
		cmd := exec.Command("open", "x-apple.systempreferences:com.apple.preference.network")
		if err := cmd.Start(); err != nil {
			fallback := exec.Command("open", "/System/Library/PreferencePanes/Network.prefPane")
			return fallback.Start()
		}
		return nil

	default:
		// Linux: Try GNOME Control Center, KDE System Settings, or xdg-open
		if err := exec.Command("gnome-control-center", "network").Start(); err == nil {
			return nil
		}
		if err := exec.Command("kcmshell5", "proxy").Start(); err == nil {
			return nil
		}
		return exec.Command("xdg-open", "settings://network").Start()
	}
}
