//go:build windows

package downloader

import (
	neturl "net/url"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func (pm *ProxyManager) getSystemProxyOS(targetURL *neturl.URL) (*neturl.URL, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil, nil
	}
	defer k.Close()

	// 1. Check if Proxy is enabled
	proxyEnable, _, err := k.GetIntegerValue("ProxyEnable")
	if err == nil && proxyEnable == 1 {
		server, _, err := k.GetStringValue("ProxyServer")
		if err == nil && server != "" {
			// Check bypass list (ProxyOverride)
			override, _, _ := k.GetStringValue("ProxyOverride")
			if override != "" && targetURL != nil {
				if pm != nil && pm.IsHostBypassed(targetURL.Hostname(), override) {
					return nil, nil
				}
			}

			proxyStr := parseWindowsProxyServerString(server, targetURL)
			if proxyStr != "" {
				return neturl.Parse(proxyStr)
			}
		}
	}

	// 2. Check if AutoConfigURL (PAC) is configured in Windows Settings
	pacURL, _, err := k.GetStringValue("AutoConfigURL")
	if err == nil && strings.TrimSpace(pacURL) != "" && targetURL != nil {
		if pm != nil {
			proxyStr := pm.resolvePACProxy(pacURL, targetURL.String(), targetURL.Hostname())
			if proxyStr != "" && !strings.EqualFold(proxyStr, "DIRECT") {
				return neturl.Parse(proxyStr)
			}
		}
	}

	return nil, nil
}

func parseWindowsProxyServerString(server string, targetURL *neturl.URL) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return ""
	}
	if !strings.Contains(server, "=") {
		if !strings.Contains(server, "://") {
			return "http://" + server
		}
		return server
	}

	// Multiple protocol mappings, e.g. "http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080"
	scheme := "http"
	if targetURL != nil && targetURL.Scheme != "" {
		scheme = strings.ToLower(targetURL.Scheme)
	}

	protoMap := make(map[string]string)
	parts := strings.Split(server, ";")
	for _, part := range parts {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			proto := strings.ToLower(strings.TrimSpace(kv[0]))
			addr := strings.TrimSpace(kv[1])
			if proto != "" && addr != "" {
				protoMap[proto] = addr
			}
		}
	}

	selectedAddr := ""
	selectedProto := scheme

	if addr, ok := protoMap[scheme]; ok {
		selectedAddr = addr
		selectedProto = scheme
	} else if scheme == "https" && protoMap["http"] != "" {
		selectedAddr = protoMap["http"]
		selectedProto = "http"
	} else if addr, ok := protoMap["all"]; ok {
		selectedAddr = addr
		selectedProto = "http"
	} else if addr, ok := protoMap["socks"]; ok {
		selectedAddr = addr
		selectedProto = "socks5"
	} else if addr, ok := protoMap["socks5"]; ok {
		selectedAddr = addr
		selectedProto = "socks5"
	}

	if selectedAddr == "" {
		return ""
	}

	if !strings.Contains(selectedAddr, "://") {
		if selectedProto == "socks" || selectedProto == "socks5" {
			return "socks5://" + selectedAddr
		}
		return "http://" + selectedAddr
	}
	return selectedAddr
}
