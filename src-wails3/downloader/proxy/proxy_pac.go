// proxy_pac.go handles PAC (Proxy Auto-Config) script fetching and directive parsing,
// wildcard/CIDR host bypass matching, and live proxy connectivity testing.
package proxy

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"runtime"
	"strings"
	"time"
)

// IsHostBypassed checks whether a given target host matches any rule in the bypass list.
func (pm *ProxyManager) IsHostBypassed(host string, bypassList string) bool {
	cleanHost := strings.ToLower(strings.TrimSpace(host))
	if cleanHost == "" || strings.TrimSpace(bypassList) == "" {
		return false
	}

	// Split by spaces, semicolons, commas, or whitespace
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
			isLocal := !strings.Contains(cleanHost, ".") ||
				cleanHost == "localhost" ||
				cleanHost == "127.0.0.1" ||
				cleanHost == "::1" ||
				cleanHost == "0.0.0.0" ||
				strings.HasSuffix(cleanHost, ".local")
			if isLocal {
				return true
			}
			continue
		}

		// Exact match
		if cleanHost == rule {
			return true
		}

		// Domain suffix match (e.g. "example.com" or ".example.com" matches "sub.example.com")
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

		// General wildcard match (e.g. "192.168.1.*" or "10.*")
		if strings.Contains(rule, "*") && matchWildcard(rule, cleanHost) {
			return true
		}

		// CIDR subnet match (e.g. 192.168.0.0/16 or 10.0.0.0/8)
		if strings.Contains(rule, "/") {
			if _, cidrNet, err := net.ParseCIDR(rule); err == nil {
				if ip := net.ParseIP(cleanHost); ip != nil && cidrNet.Contains(ip) {
					return true
				}
			}
		}
	}

	return false
}

// matchWildcard performs simple '*' glob matching on strings.
func matchWildcard(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}

	leading := parts[0]
	trailing := parts[len(parts)-1]

	if !strings.HasPrefix(s, leading) || !strings.HasSuffix(s, trailing) {
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

// ProxyTestResult represents the outcome of a live proxy connectivity test.
type ProxyTestResult struct {
	Success   bool   `json:"success"`
	IP        string `json:"ip,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	Message   string `json:"message"`
	Error     string `json:"error,omitempty"`
}

// TestProxyConnection performs a real network probe through the given proxy configuration to verify connectivity.
func TestProxyConnection(cfg ProxyConfig) ProxyTestResult {
	return GetProxyManager().TestProxyConnection(cfg)
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
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
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
			foundIP = parseOriginIPFromBody(bodyBytes)

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
		}

		lastErr = fmt.Errorf("server returned status: %s", resp.Status)
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

func parseOriginIPFromBody(bodyBytes []byte) string {
	bodyStr := string(bodyBytes)
	if strings.Contains(bodyStr, "ip=") {
		for _, line := range strings.Split(bodyStr, "\n") {
			if strings.HasPrefix(line, "ip=") {
				return strings.TrimPrefix(line, "ip=")
			}
		}
	} else if net.ParseIP(strings.TrimSpace(bodyStr)) != nil {
		return strings.TrimSpace(bodyStr)
	} else if strings.Contains(bodyStr, "origin") {
		var m map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &m); err == nil {
			if orig, ok := m["origin"].(string); ok {
				return orig
			}
		}
	}
	return ""
}
