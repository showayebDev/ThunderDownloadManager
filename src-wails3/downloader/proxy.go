package downloader

import (
	"ThunderDM/src-wails3/storage"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
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
)

type ProxyMode string

const (
	ProxyModeNone   ProxyMode = "none"
	ProxyModeSystem ProxyMode = "system"
	ProxyModePAC    ProxyMode = "pac"
	ProxyModeManual ProxyMode = "manual"
)

type ProxyType string

const (
	ProxyTypeHTTP  ProxyType = "HTTP"
	ProxyTypeSOCKS ProxyType = "SOCKS"
)

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

var GlobalProxyManager *ProxyManager
var proxyOnce sync.Once

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
			} else {
				cfg.Host = ""
			}
			if p, ok := root["proxyPort"].(string); ok && p != "" {
				cfg.Port = p
			} else {
				cfg.Port = ""
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
	isProxyEnabled := (pm.config.Mode != ProxyModeNone && pm.config.Mode != "")
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

func (pm *ProxyManager) GetConfig() ProxyConfig {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.config
}

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

// IsHostBypassed checks whether a given target host matches any rule in the bypass list.
func (pm *ProxyManager) IsHostBypassed(host string, bypassList string) bool {
	cleanHost := strings.ToLower(strings.TrimSpace(host))
	if cleanHost == "" {
		return false
	}

	if strings.TrimSpace(bypassList) == "" {
		return false
	}

	// Split by spaces, semicolons, or commas
	delims := func(r rune) bool {
		return r == ' ' || r == ',' || r == ';' || r == '\n' || r == '\t'
	}
	tokens := strings.FieldsFunc(bypassList, delims)

	for _, token := range tokens {
		rule := strings.ToLower(strings.TrimSpace(token))
		if rule == "" {
			continue
		}

		if rule == "<local>" {
			if !strings.Contains(cleanHost, ".") || cleanHost == "localhost" || cleanHost == "127.0.0.1" || cleanHost == "::1" || cleanHost == "0.0.0.0" || strings.HasSuffix(cleanHost, ".local") {
				return true
			}
			continue
		}

		// Exact match
		if cleanHost == rule {
			return true
		}

		// Domain suffix match (e.g. "example.com" matches "sub.example.com")
		if strings.HasPrefix(rule, ".") && strings.HasSuffix(cleanHost, rule) {
			return true
		}
		if strings.HasSuffix(cleanHost, "."+rule) {
			return true
		}

		// Subdomain wildcard match (e.g. "*.internal.net" matches "app.internal.net" and "internal.net")
		if strings.HasPrefix(rule, "*.") {
			baseDomain := rule[2:]
			if cleanHost == baseDomain || strings.HasSuffix(cleanHost, "."+baseDomain) {
				return true
			}
		}

		// Wildcard match (e.g. "192.168.1.*" or "10.*")
		if strings.Contains(rule, "*") {
			if matchWildcard(rule, cleanHost) {
				return true
			}
		}

		// CIDR subnet match (e.g. 192.168.0.0/16 or 10.0.0.0/8)
		if strings.Contains(rule, "/") {
			if _, cidrNet, err := net.ParseCIDR(rule); err == nil {
				ip := net.ParseIP(cleanHost)
				if ip != nil && cidrNet.Contains(ip) {
					return true
				}
			}
		}
	}

	return false
}

func matchWildcard(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}

	leading := parts[0]
	trailing := parts[len(parts)-1]

	if !strings.HasPrefix(s, leading) {
		return false
	}
	if !strings.HasSuffix(s, trailing) {
		return false
	}

	s = s[len(leading) : len(s)-len(trailing)]
	for i := 1; i < len(parts)-1; i++ {
		p := parts[i]
		if p == "" {
			continue
		}
		idx := strings.Index(s, p)
		if idx < 0 {
			return false
		}
		s = s[idx+len(p):]
	}
	return true
}

func (pm *ProxyManager) resolvePACProxy(pacURL string, targetURL string, targetHost string) string {
	pm.pacCacheMu.Lock()
	defer pm.pacCacheMu.Unlock()

	// Refresh PAC script if URL changed or cache is older than 5 minutes
	if pm.pacCacheURL != pacURL || pm.pacScript == "" || time.Since(pm.pacLastFetch) > 5*time.Minute {
		script, err := pm.fetchPACScript(pacURL)
		if err == nil && script != "" {
			pm.pacCacheURL = pacURL
			pm.pacScript = script
			pm.pacLastFetch = time.Now()
		}
	}

	if pm.pacScript == "" {
		return ""
	}

	return extractProxyFromPACScript(pm.pacScript, targetHost)
}

func (pm *ProxyManager) fetchPACScript(pacURL string) (string, error) {
	pacURL = strings.TrimSpace(pacURL)
	if strings.HasPrefix(pacURL, "file://") {
		filePath := strings.TrimPrefix(pacURL, "file://")
		if runtime.GOOS == "windows" {
			filePath = strings.TrimPrefix(filePath, "/")
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}

	// Fetch via direct HTTP without proxy loop
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	resp, err := client.Get(pacURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("PAC fetch returned status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// extractProxyFromPACScript extracts the first valid PROXY or SOCKS directive from PAC script text.
func extractProxyFromPACScript(script string, targetHost string) string {
	upper := strings.ToUpper(script)
	// Look for PROXY host:port or SOCKS host:port
	keywords := []string{"PROXY ", "SOCKS ", "SOCKS5 ", "HTTPS ", "HTTP "}

	for _, kw := range keywords {
		if idx := strings.Index(upper, kw); idx >= 0 {
			sub := script[idx+len(kw):]
			// Extract until semicolon, quote, space, or newline
			end := strings.IndexAny(sub, ";\"' \r\n\t")
			if end > 0 {
				hostPort := strings.TrimSpace(sub[:end])
				if hostPort != "" && strings.Contains(hostPort, ":") {
					scheme := "http"
					if strings.HasPrefix(kw, "SOCKS") {
						scheme = "socks5"
					}
					return fmt.Sprintf("%s://%s", scheme, hostPort)
				}
			}
		}
	}

	if strings.Contains(upper, "DIRECT") {
		return "DIRECT"
	}

	return ""
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

type ProxyTestResult struct {
	Success   bool   `json:"success"`
	IP        string `json:"ip,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	Message   string `json:"message"`
	Error     string `json:"error,omitempty"`
}

// TestProxyConnection performs a real network probe through the given proxy configuration to verify connectivity.
func (pm *ProxyManager) TestProxyConnection(cfg ProxyConfig) ProxyTestResult {
	if cfg.Mode == ProxyModeNone {
		return ProxyTestResult{
			Success: true,
			Message: "No proxy selected (Direct connection).",
		}
	}

	testTransport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   6 * time.Second,
			KeepAlive: 10 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		TLSHandshakeTimeout: 5 * time.Second,
	}

	var proxyURL *neturl.URL
	var err error

	switch cfg.Mode {
	case ProxyModeSystem:
		req, _ := http.NewRequest(http.MethodGet, "https://1.1.1.1", nil)
		proxyURL, err = http.ProxyFromEnvironment(req)
		if err == nil && proxyURL == nil {
			proxyURL, err = pm.getSystemProxyOS(req.URL)
		}
		if err != nil {
			return ProxyTestResult{
				Success: false,
				Message: "Failed to read system proxy configuration.",
				Error:   err.Error(),
			}
		}
		if proxyURL == nil {
			return ProxyTestResult{
				Success: true,
				Message: "System proxy is set to direct (no system proxy configured).",
			}
		}
		testTransport.Proxy = http.ProxyURL(proxyURL)

	case ProxyModePAC:
		if strings.TrimSpace(cfg.PACUrl) == "" {
			return ProxyTestResult{
				Success: false,
				Message: "PAC URL is empty.",
				Error:   "Please enter a valid PAC URL.",
			}
		}
		pacScript, fetchErr := pm.fetchPACScript(cfg.PACUrl)
		if fetchErr != nil {
			return ProxyTestResult{
				Success: false,
				Message: "Failed to download PAC script.",
				Error:   fetchErr.Error(),
			}
		}
		proxyStr := extractProxyFromPACScript(pacScript, "cloudflare.com")
		if proxyStr == "" || strings.EqualFold(proxyStr, "DIRECT") {
			return ProxyTestResult{
				Success: true,
				Message: "PAC script loaded successfully (evaluates to DIRECT for general traffic).",
			}
		}
		proxyURL, err = neturl.Parse(proxyStr)
		if err != nil {
			return ProxyTestResult{
				Success: false,
				Message: "Invalid proxy address in PAC script: " + proxyStr,
				Error:   err.Error(),
			}
		}
		testTransport.Proxy = http.ProxyURL(proxyURL)

	case ProxyModeManual:
		host := strings.TrimSpace(cfg.Host)
		port := strings.TrimSpace(cfg.Port)
		if host == "" || port == "" {
			return ProxyTestResult{
				Success: false,
				Message: "Host or Port is missing.",
				Error:   "Please provide both proxy Host and Port.",
			}
		}
		proxyURLStr := pm.buildManualProxyURLString(cfg)
		proxyURL, err = neturl.Parse(proxyURLStr)
		if err != nil {
			return ProxyTestResult{
				Success: false,
				Message: "Invalid proxy URL format.",
				Error:   err.Error(),
			}
		}
		testTransport.Proxy = http.ProxyURL(proxyURL)
	}

	testClient := &http.Client{
		Transport: testTransport,
		Timeout:   4 * time.Second,
	}

	// Try multiple reliable test endpoints
	testEndpoints := []string{
		"https://cloudflare.com/cdn-cgi/trace",
		"https://api.ipify.org?format=text",
		"http://httpbin.org/ip",
		"https://www.google.com/generate_204",
	}

	var lastErr error
	var latencyMs int64
	var foundIP string

	for _, endpoint := range testEndpoints {
		start := time.Now()
		req, rErr := http.NewRequest(http.MethodGet, endpoint, nil)
		if rErr != nil {
			lastErr = rErr
			continue
		}
		req.Header.Set("User-Agent", "ThunderDM-Proxy-Tester/1.0")

		resp, doErr := testClient.Do(req)
		if doErr != nil {
			lastErr = doErr
			errStr := strings.ToLower(doErr.Error())
			if strings.Contains(errStr, "connection refused") || strings.Contains(errStr, "actively refused") || strings.Contains(errStr, "no connection could be made") {
				break
			}
			continue
		}

		latencyMs = time.Since(start).Milliseconds()
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			bodyStr := string(bodyBytes)
			// Parse IP from cloudflare trace or ipify
			if strings.Contains(bodyStr, "ip=") {
				for _, line := range strings.Split(bodyStr, "\n") {
					if strings.HasPrefix(line, "ip=") {
						foundIP = strings.TrimPrefix(line, "ip=")
						break
					}
				}
			} else if net.ParseIP(strings.TrimSpace(bodyStr)) != nil {
				foundIP = strings.TrimSpace(bodyStr)
			} else if strings.Contains(bodyStr, "origin") {
				// parse httpbin json
				var m map[string]interface{}
				if err := json.Unmarshal(bodyBytes, &m); err == nil {
					if orig, ok := m["origin"].(string); ok {
						foundIP = orig
					}
				}
			}

			proxyTypeStr := string(cfg.ProxyType)
			if cfg.Mode == ProxyModeSystem {
				proxyTypeStr = "System"
			} else if cfg.Mode == ProxyModePAC {
				proxyTypeStr = "PAC"
			}

			msg := fmt.Sprintf("Proxy connected successfully! (%s)", proxyTypeStr)
			if foundIP != "" {
				msg = fmt.Sprintf("Proxy connected! Origin IP: %s (%dms)", foundIP, latencyMs)
			} else {
				msg = fmt.Sprintf("Proxy connected! Latency: %dms", latencyMs)
			}

			return ProxyTestResult{
				Success:   true,
				IP:        foundIP,
				LatencyMs: latencyMs,
				Message:   msg,
			}
		} else {
			lastErr = fmt.Errorf("server returned status: %s", resp.Status)
		}
	}

	errDetail := ""
	if lastErr != nil {
		errDetail = lastErr.Error()
	}

	return ProxyTestResult{
		Success: false,
		Message: "Proxy connection failed.",
		Error:   errDetail,
	}
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

