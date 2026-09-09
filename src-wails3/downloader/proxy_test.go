package downloader

import (
	"io"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"testing"
)

func TestProxyConfigDefaults(t *testing.T) {
	cfg := DefaultProxyConfig()
	if cfg.Mode != ProxyModeNone {
		t.Errorf("expected default mode to be %s, got %s", ProxyModeNone, cfg.Mode)
	}
	if cfg.ProxyType != ProxyTypeHTTP {
		t.Errorf("expected default proxyType to be %s, got %s", ProxyTypeHTTP, cfg.ProxyType)
	}
	if cfg.Host != "" {
		t.Errorf("expected default host to be empty, got %s", cfg.Host)
	}
	if cfg.Port != "" {
		t.Errorf("expected default port to be empty, got %s", cfg.Port)
	}
}

func TestBuildManualProxyURLString(t *testing.T) {
	pm := GetProxyManager()

	// 1. HTTP without auth
	cfg1 := ProxyConfig{
		Mode:      ProxyModeManual,
		ProxyType: ProxyTypeHTTP,
		Host:      "127.0.0.1",
		Port:      "2080",
		UseAuth:   false,
	}
	res1 := pm.buildManualProxyURLString(cfg1)
	if res1 != "http://127.0.0.1:2080" {
		t.Errorf("expected 'http://127.0.0.1:2080', got '%s'", res1)
	}

	// 2. SOCKS with auth
	cfg2 := ProxyConfig{
		Mode:      ProxyModeManual,
		ProxyType: ProxyTypeSOCKS,
		Host:      "proxy.example.com",
		Port:      "1080",
		UseAuth:   true,
		Username:  "admin",
		Password:  "secret!@#",
	}
	res2 := pm.buildManualProxyURLString(cfg2)
	expected2 := "socks5://admin:secret%21%40%23@proxy.example.com:1080"
	if res2 != expected2 {
		t.Errorf("expected '%s', got '%s'", expected2, res2)
	}

	// 3. HTTP with auth
	cfg3 := ProxyConfig{
		Mode:      ProxyModeManual,
		ProxyType: ProxyTypeHTTP,
		Host:      "192.168.1.50",
		Port:      "8080",
		UseAuth:   true,
		Username:  "user",
		Password:  "pass",
	}
	res3 := pm.buildManualProxyURLString(cfg3)
	if res3 != "http://user:pass@192.168.1.50:8080" {
		t.Errorf("expected 'http://user:pass@192.168.1.50:8080', got '%s'", res3)
	}
}

func TestIsHostBypassed(t *testing.T) {
	pm := GetProxyManager()
	bypassList := "example.com 192.168.1.* *.internal.net localhost 127.0.0.1 <local> 10.0.0.0/8"

	cases := []struct {
		host     string
		expected bool
	}{
		{"example.com", true},
		{"sub.example.com", true},
		{"OTHER.COM", false},
		{"192.168.1.1", true},
		{"192.168.1.254", true},
		{"192.168.2.1", false},
		{"app.internal.net", true},
		{"internal.net", true},
		{"other.net", false},
		{"localhost", true},
		{"127.0.0.1", true},
		{"intranet", true}, // <local> rule without dot
		{"10.20.30.40", true}, // 10.0.0.0/8 CIDR
		{"172.16.0.1", false},
	}

	for _, c := range cases {
		got := pm.IsHostBypassed(c.host, bypassList)
		if got != c.expected {
			t.Errorf("IsHostBypassed(%s) = %v; want %v", c.host, got, c.expected)
		}
	}
}

func TestGetProxyForURL(t *testing.T) {
	pm := GetProxyManager()

	// Mode: None
	pm.SetConfig(ProxyConfig{Mode: ProxyModeNone})
	target, _ := neturl.Parse("https://google.com/test")
	pURL, err := pm.GetProxyForURL(target)
	if err != nil || pURL != nil {
		t.Errorf("expected nil proxy for None mode, got %v", pURL)
	}

	// Mode: Manual (not bypassed)
	pm.SetConfig(ProxyConfig{
		Mode:       ProxyModeManual,
		ProxyType:  ProxyTypeHTTP,
		Host:       "127.0.0.1",
		Port:       "2080",
		BypassList: "example.com 192.168.1.*",
	})
	pURL, err = pm.GetProxyForURL(target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pURL == nil || pURL.String() != "http://127.0.0.1:2080" {
		t.Errorf("expected 'http://127.0.0.1:2080', got %v", pURL)
	}

	// Mode: Manual (bypassed domain)
	bypassedTarget, _ := neturl.Parse("https://sub.example.com/download")
	pURL, err = pm.GetProxyForURL(bypassedTarget)
	if err != nil || pURL != nil {
		t.Errorf("expected nil proxy for bypassed host, got %v", pURL)
	}

	// Reset back to None
	pm.SetConfig(ProxyConfig{Mode: ProxyModeNone})
}

func TestExtractProxyFromPACScript(t *testing.T) {
	pac1 := `
	function FindProxyForURL(url, host) {
		if (shExpMatch(host, "*.local")) return "DIRECT";
		return "PROXY proxy.corp.net:8080; DIRECT";
	}
	`
	got1 := extractProxyFromPACScript(pac1, "google.com")
	if got1 != "http://proxy.corp.net:8080" {
		t.Errorf("expected 'http://proxy.corp.net:8080', got '%s'", got1)
	}

	pac2 := `
	function FindProxyForURL(url, host) {
		return "SOCKS5 127.0.0.1:1080";
	}
	`
	got2 := extractProxyFromPACScript(pac2, "test.org")
	if got2 != "socks5://127.0.0.1:1080" {
		t.Errorf("expected 'socks5://127.0.0.1:1080', got '%s'", got2)
	}
}

func TestLiveHTTPProxyConnection(t *testing.T) {
	// Setup a mock target origin server
	originServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("origin-content-ok"))
	}))
	defer originServer.Close()

	proxyHits := 0
	// Setup a mock HTTP proxy server
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits++
		// Forward request to origin
		outReq, err := http.NewRequest(r.Method, r.RequestURI, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp, err := http.DefaultTransport.RoundTrip(outReq)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
	}))
	defer proxyServer.Close()

	proxyURL, _ := neturl.Parse(proxyServer.URL)
	pm := GetProxyManager()

	// Configure manual proxy pointing to our mock proxyServer
	pm.SetConfig(ProxyConfig{
		Mode:       ProxyModeManual,
		ProxyType:  ProxyTypeHTTP,
		Host:       proxyURL.Hostname(),
		Port:       proxyURL.Port(),
		BypassList: "unrelated.local",
	})

	// Make request via SharedHTTPClient
	req, err := http.NewRequest(http.MethodGet, originServer.URL+"/testfile", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	resp, err := SharedHTTPClient.Do(req)
	if err != nil {
		t.Fatalf("SharedHTTPClient.Do failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if string(body) != "origin-content-ok" {
		t.Errorf("expected 'origin-content-ok', got '%s'", string(body))
	}

	if proxyHits == 0 {
		t.Errorf("expected request to route through proxy server, but proxyHits = 0")
	}

	// Now set mode to None, ensure proxy is bypassed
	pm.SetConfig(ProxyConfig{Mode: ProxyModeNone})
	initialHits := proxyHits

	req2, _ := http.NewRequest(http.MethodGet, originServer.URL+"/direct", nil)
	resp2, err := SharedHTTPClient.Do(req2)
	if err != nil {
		t.Fatalf("direct SharedHTTPClient.Do failed: %v", err)
	}
	defer resp2.Body.Close()

	if proxyHits != initialHits {
		t.Errorf("expected no additional proxy hits in None mode, got %d hits", proxyHits-initialHits)
	}
}

func TestGetActiveProxyLabelForURL(t *testing.T) {
	pm := GetProxyManager()

	// Mode None
	pm.SetConfig(ProxyConfig{Mode: ProxyModeNone})
	if label := pm.GetActiveProxyLabelForURL("https://example.com/file.zip"); label != "" {
		t.Errorf("expected empty label for None mode, got '%s'", label)
	}

	// Mode Manual (not bypassed)
	pm.SetConfig(ProxyConfig{
		Mode:       ProxyModeManual,
		ProxyType:  ProxyTypeHTTP,
		Host:       "127.0.0.1",
		Port:       "2080",
		BypassList: "local.dev",
	})
	if label := pm.GetActiveProxyLabelForURL("https://example.com/file.zip"); label != "HTTP (127.0.0.1:2080)" {
		t.Errorf("expected 'HTTP (127.0.0.1:2080)', got '%s'", label)
	}

	// Mode Manual (bypassed)
	if label := pm.GetActiveProxyLabelForURL("https://local.dev/file.zip"); label != "" {
		t.Errorf("expected empty label for bypassed host, got '%s'", label)
	}
}

func TestProxyTestConnection(t *testing.T) {
	pm := GetProxyManager()

	// Test with Mode None (should return success immediately as direct)
	res := pm.TestProxyConnection(ProxyConfig{Mode: ProxyModeNone})
	if !res.Success {
		t.Errorf("expected success for ModeNone, got %v", res)
	}

	// Test with invalid/unreachable proxy port on localhost
	resFail := pm.TestProxyConnection(ProxyConfig{
		Mode:      ProxyModeManual,
		ProxyType: ProxyTypeHTTP,
		Host:      "127.0.0.1",
		Port:      "59999", // closed port
	})
	if resFail.Success {
		t.Errorf("expected failure for closed proxy port, got success")
	}
}

func TestParseWindowsProxyServerString(t *testing.T) {
	uHTTP, _ := neturl.Parse("http://example.com/test")
	uHTTPS, _ := neturl.Parse("https://example.com/test")

	// 1. Simple address
	s1 := parseWindowsProxyServerString("127.0.0.1:8080", uHTTP)
	if s1 != "http://127.0.0.1:8080" {
		t.Errorf("expected 'http://127.0.0.1:8080', got '%s'", s1)
	}

	// 2. Multi-protocol address
	multi := "http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080"
	sHTTP := parseWindowsProxyServerString(multi, uHTTP)
	if sHTTP != "http://127.0.0.1:8080" {
		t.Errorf("expected 'http://127.0.0.1:8080', got '%s'", sHTTP)
	}

	sHTTPS := parseWindowsProxyServerString(multi, uHTTPS)
	if sHTTPS != "http://127.0.0.1:8443" {
		t.Errorf("expected 'http://127.0.0.1:8443', got '%s'", sHTTPS)
	}
}

func TestPACScriptLiveFetchAndResolution(t *testing.T) {
	// Serve a mock PAC script via HTTP
	pacContent := `
	function FindProxyForURL(url, host) {
		if (shExpMatch(host, "*.internal")) return "DIRECT";
		return "PROXY 10.20.30.40:3128";
	}
	`
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
		_, _ = w.Write([]byte(pacContent))
	}))
	defer ts.Close()

	pm := GetProxyManager()
	pm.SetConfig(ProxyConfig{
		Mode:   ProxyModePAC,
		PACUrl: ts.URL,
	})

	target, _ := neturl.Parse("http://download.example.com/iso.zip")
	pURL, err := pm.GetProxyForURL(target)
	if err != nil {
		t.Fatalf("unexpected error resolving PAC: %v", err)
	}
	if pURL == nil || pURL.String() != "http://10.20.30.40:3128" {
		t.Errorf("expected 'http://10.20.30.40:3128', got %v", pURL)
	}

	// Reset
	pm.SetConfig(ProxyConfig{Mode: ProxyModeNone})
}

