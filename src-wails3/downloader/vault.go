package downloader

import (
	"encoding/json"
	"net/url"
	"strings"
	"ThunderDM/src-wails3/storage"
)

type VaultItem struct {
	Host        string `json:"host"`
	User        string `json:"user,omitempty"`
	Pass        string `json:"pass,omitempty"`
	SpeedLimit  int64  `json:"speedLimit,omitempty"`
	ThreadCount int    `json:"threadCount,omitempty"`
	UserAgent   string `json:"userAgent,omitempty"`
}

// MatchVaultItem checks ~/.thunderdm/download_engine.json or in-memory config for matching per-host settings for the given URL.
func MatchVaultItem(rawURL string) *VaultItem {
	if rawURL == "" {
		return nil
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil
	}

	var items []VaultItem
	cachedCfg := GetEngineConfig()
	if len(cachedCfg.VaultItems) > 0 {
		items = cachedCfg.VaultItems
	} else {
		if val, err := storage.GetKV("download_engine"); err == nil && len(val) > 0 {
			var root map[string]interface{}
			if json.Unmarshal([]byte(val), &root) == nil {
				if vaultRaw, ok := root["vaultItems"]; ok && vaultRaw != nil {
					if rawBytes, mErr := json.Marshal(vaultRaw); mErr == nil {
						_ = json.Unmarshal(rawBytes, &items)
					}
				}
			}
		}
	}

	if len(items) == 0 {
		return nil
	}

	urlHost := strings.ToLower(parsed.Host)                               // e.g. "localhost:3000"
	urlHostname := strings.ToLower(parsed.Hostname())                     // e.g. "localhost"
	urlSchemeHost := strings.ToLower(parsed.Scheme + "://" + parsed.Host) // e.g. "http://localhost:3000"

	for _, item := range items {
		vHost := strings.TrimSpace(strings.ToLower(item.Host))
		if vHost == "" {
			continue
		}
		// Strip trailing slash
		vHost = strings.TrimRight(vHost, "/")

		// Case 1: Exact scheme+host match (e.g. "http://localhost:3000")
		if vHost == urlSchemeHost {
			itemCopy := item
			return &itemCopy
		}
		// Case 2: Exact host:port match (e.g. "localhost:3000")
		if vHost == urlHost {
			itemCopy := item
			return &itemCopy
		}
		// Case 3: Exact hostname match (e.g. "localhost" or "drive.google.com")
		if vHost == urlHostname {
			itemCopy := item
			return &itemCopy
		}
		// Case 4: vHost has scheme with hostname (e.g. "http://localhost")
		if strings.HasPrefix(vHost, "http://") || strings.HasPrefix(vHost, "https://") {
			if vParsed, pErr := url.Parse(vHost); pErr == nil {
				if strings.EqualFold(vParsed.Hostname(), urlHostname) {
					if vParsed.Port() == "" || vParsed.Port() == parsed.Port() {
						itemCopy := item
						return &itemCopy
					}
				}
			}
		}
		// Case 5: Domain wildcard or domain match (e.g. "*.example.com" or "example.com")
		cleanVHost := strings.TrimPrefix(vHost, "*.")
		if strings.HasSuffix(urlHostname, cleanVHost) {
			itemCopy := item
			return &itemCopy
		}
	}

	return nil
}

// MatchVaultCredentials checks ~/.thunderdm/download_engine.json or in-memory config for matching credentials for the given URL.
func MatchVaultCredentials(rawURL string) (string, string) {
	item := MatchVaultItem(rawURL)
	if item != nil {
		return item.User, item.Pass
	}
	return "", ""
}
