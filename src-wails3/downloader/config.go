package downloader

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
	"ThunderDM/src-wails3/storage"
)

// EngineConfig holds all persistent download engine configuration parameters.
type EngineConfig struct {
	DownloadPath                string      `json:"downloadPath"`
	UseCategoryByDefault        bool              `json:"useCategoryByDefault"`
	CategoryPaths               map[string]string `json:"categoryPaths,omitempty"`
	GlobalSpeedLimiter          bool              `json:"globalSpeedLimiter"`
	GlobalSpeedLimit            int64       `json:"globalSpeedLimit"`
	DefaultThreadCount          int         `json:"defaultThreadCount"`
	MaxConcurrentDownloads      int         `json:"maxConcurrentDownloads"`
	MaxRetries                  int         `json:"maxRetries"`
	DynamicPartCreation         bool        `json:"dynamicPartCreation"`
	UserAgent                   string      `json:"userAgent"`
	IgnoreSSL                   bool        `json:"ignoreSsl"`
	UseServersLastModified      bool        `json:"useServersLastModified"`
	TrackDeletedFiles           bool        `json:"trackDeletedFiles"`
	AppendExtensionToIncomplete bool        `json:"appendExtensionToIncomplete"`
	DeletePartialOnFileCancel   bool        `json:"deletePartialOnFileCancel"`
	SparseFileAllocation        bool        `json:"sparseFileAllocation"`
	VaultItems                  []VaultItem `json:"vaultItems"`
	ProxyConfig                 ProxyConfig `json:"proxyConfig"`
}

var (
	engineConfigMu     sync.RWMutex
	cachedEngineConfig EngineConfig
	configLoaded       bool
)

// DefaultEngineConfig returns standard fallback values for the engine configuration.
func DefaultEngineConfig() EngineConfig {
	home, _ := os.UserHomeDir()
	defaultDL := filepath.Join(home, "Downloads")
	return EngineConfig{
		DownloadPath:                defaultDL,
		UseCategoryByDefault:        true,
		CategoryPaths:               make(map[string]string),
		GlobalSpeedLimiter:          false,
		GlobalSpeedLimit:            0,
		DefaultThreadCount:          8,
		MaxConcurrentDownloads:      0, // 0 = Unlimited
		MaxRetries:                  3,
		DynamicPartCreation:         true,
		UserAgent:                   "",
		IgnoreSSL:                   false,
		UseServersLastModified:      false,
		TrackDeletedFiles:           true,
		AppendExtensionToIncomplete: true,
		DeletePartialOnFileCancel:   false,
		SparseFileAllocation:        true,
		VaultItems:                  make([]VaultItem, 0),
		ProxyConfig:                 DefaultProxyConfig(),
	}
}

// GetEngineConfig returns the active thread-safe engine configuration.
func GetEngineConfig() EngineConfig {
	engineConfigMu.RLock()
	if configLoaded {
		cfg := cachedEngineConfig
		engineConfigMu.RUnlock()
		return cfg
	}
	engineConfigMu.RUnlock()
	return LoadEngineConfig()
}

// LoadEngineConfig reads configuration from SQLite and updates memory cache.
func LoadEngineConfig() EngineConfig {
	engineConfigMu.Lock()
	defer engineConfigMu.Unlock()

	cfg := DefaultEngineConfig()

	// Read from SQLite kv_store exclusively
	val, err := storage.GetKV("download_engine")
	if err == nil && len(val) > 0 {
		var root map[string]interface{}
		if err := json.Unmarshal([]byte(val), &root); err == nil {
			if dp, ok := root["downloadPath"].(string); ok && dp != "" {
				cfg.DownloadPath = dp
			}
			if ucb, ok := root["useCategoryByDefault"].(bool); ok {
				cfg.UseCategoryByDefault = ucb
			}
			if gsl, ok := root["globalSpeedLimiter"].(bool); ok {
				cfg.GlobalSpeedLimiter = gsl
			}
			if limit, ok := root["globalSpeedLimit"].(float64); ok {
				cfg.GlobalSpeedLimit = int64(limit)
			}
			if tc, ok := root["defaultThreadCount"].(float64); ok && tc > 0 {
				cfg.DefaultThreadCount = int(tc)
			} else if tc, ok := root["threadCount"].(float64); ok && tc > 0 {
				cfg.DefaultThreadCount = int(tc)
			}
			if mc, ok := root["maxConcurrentDownloads"].(float64); ok {
				cfg.MaxConcurrentDownloads = int(mc)
			} else if mc, ok := root["maxConcurrent"].(float64); ok {
				cfg.MaxConcurrentDownloads = int(mc)
			}
			if mr, ok := root["maxRetries"].(float64); ok && mr > 0 {
				cfg.MaxRetries = int(mr)
			}
			if dpc, ok := root["dynamicPartCreation"].(bool); ok {
				cfg.DynamicPartCreation = dpc
			}
			if ua, ok := root["userAgent"].(string); ok {
				cfg.UserAgent = ua
			}
			if issl, ok := root["ignoreSsl"].(bool); ok {
				cfg.IgnoreSSL = issl
			}
			if uslm, ok := root["useServersLastModified"].(bool); ok {
				cfg.UseServersLastModified = uslm
			}
			if tdf, ok := root["trackDeletedFiles"].(bool); ok {
				cfg.TrackDeletedFiles = tdf
			}
			if aei, ok := root["appendExtensionToIncomplete"].(bool); ok {
				cfg.AppendExtensionToIncomplete = aei
			}
			if dpfc, ok := root["deletePartialOnFileCancel"].(bool); ok {
				cfg.DeletePartialOnFileCancel = dpfc
			}
			if sfa, ok := root["sparseFileAllocation"].(bool); ok {
				cfg.SparseFileAllocation = sfa
			}
			if cpRaw, ok := root["categoryPaths"]; ok && cpRaw != nil {
				if rawBytes, err := json.Marshal(cpRaw); err == nil {
					var cp map[string]string
					if err := json.Unmarshal(rawBytes, &cp); err == nil {
						cfg.CategoryPaths = cp
					}
				}
			}

			// Vault items
			if vaultRaw, ok := root["vaultItems"]; ok && vaultRaw != nil {
				if rawBytes, err := json.Marshal(vaultRaw); err == nil {
					var items []VaultItem
					if err := json.Unmarshal(rawBytes, &items); err == nil {
						cfg.VaultItems = items
					}
				}
			}

			// Proxy config
			if proxyRaw, ok := root["proxyConfig"]; ok && proxyRaw != nil {
				if rawBytes, err := json.Marshal(proxyRaw); err == nil {
					var pCfg ProxyConfig
					if err := json.Unmarshal(rawBytes, &pCfg); err == nil {
						cfg.ProxyConfig = pCfg
					}
				}
			}
		}
	}

	cachedEngineConfig = cfg
	configLoaded = true

	// Apply live settings to engine components
	applyEngineSettings(cfg)

	return cfg
}

// UpdateEngineConfig updates the in-memory cache and applies live settings to the engine.
func UpdateEngineConfig(cfg EngineConfig) {
	engineConfigMu.Lock()
	cachedEngineConfig = cfg
	configLoaded = true
	engineConfigMu.Unlock()

	applyEngineSettings(cfg)
}

func applyEngineSettings(cfg EngineConfig) {
	// 1. Update Global Speed Limiter
	if instance != nil {
		if cfg.GlobalSpeedLimiter && cfg.GlobalSpeedLimit > 0 {
			instance.SetGlobalSpeedLimit(cfg.GlobalSpeedLimit)
		} else {
			instance.SetGlobalSpeedLimit(0) // Unlimited
		}
	}

	// 2. Update ProxyManager
	if GlobalProxyManager != nil {
		GlobalProxyManager.SetConfig(cfg.ProxyConfig)
	}

	// 3. Update TLS InsecureSkipVerify on SharedHTTPClient
	if SharedHTTPClient != nil {
		if tr, ok := SharedHTTPClient.Transport.(*http.Transport); ok && tr != nil {
			if tr.TLSClientConfig != nil {
				tr.TLSClientConfig.InsecureSkipVerify = cfg.IgnoreSSL
			} else {
				tr.TLSClientConfig = &tls.Config{
					InsecureSkipVerify: cfg.IgnoreSSL,
				}
			}
		}
	}
}

var (
	progressFPSMu sync.RWMutex
	progressFPS   float64 = 0.5
)

// SetProgressFPS sets the emission framerate in frames per second (e.g. 0.5, 1.0, 4.0).
func SetProgressFPS(fps float64) {
	if fps <= 0 {
		fps = 0.5
	}
	progressFPSMu.Lock()
	progressFPS = fps
	progressFPSMu.Unlock()
}

// GetProgressInterval returns the time.Duration corresponding to 1 / FPS.
func GetProgressInterval() time.Duration {
	progressFPSMu.RLock()
	fps := progressFPS
	progressFPSMu.RUnlock()
	if fps <= 0 {
		return 2000 * time.Millisecond
	}
	ms := float64(1000) / fps
	return time.Duration(ms) * time.Millisecond
}

