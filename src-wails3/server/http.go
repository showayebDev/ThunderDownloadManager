package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"ThunderDM/src-wails3/storage"
)

type AddDownloadRequest struct {
	URL       string            `json:"url"`
	Filename  string            `json:"filename,omitempty"`
	Referrer  string            `json:"referrer,omitempty"`
	Cookies   string            `json:"cookies,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	UserAgent string            `json:"user_agent,omitempty"`
	IsYTDLP   bool              `json:"is_ytdlp,omitempty"`
	Protocol  string            `json:"protocol,omitempty"`
	Title     string            `json:"title,omitempty"`
}

var (
	OnAddDownloadRequest func(payload map[string]interface{})
	serverStarted        sync.Once

	integrationMu      sync.RWMutex
	browserIntegration = true

	versionMu sync.RWMutex

	serverMu         sync.Mutex
	activeServers    = make(map[string]*http.Server)
	customPortServer *http.Server
	customPortAddr   string
)

func SetAppVersion(v string) {
	if v == "" {
		return
	}
	versionMu.Lock()
	AppVersion = v
	versionMu.Unlock()
}

func GetAppVersion() string {
	versionMu.RLock()
	defer versionMu.RUnlock()
	return AppVersion
}

func SetBrowserIntegration(enabled bool) {
	integrationMu.Lock()
	browserIntegration = enabled
	integrationMu.Unlock()
	log.Printf("[HTTPServer] Browser Integration set to: %v\n", enabled)
}

func IsBrowserIntegrationEnabled() bool {
	integrationMu.RLock()
	defer integrationMu.RUnlock()
	return browserIntegration
}

func enableCors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, *")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
}

func handleAddDownload(w http.ResponseWriter, r *http.Request) {
	enableCors(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !IsBrowserIntegrationEnabled() {
		log.Println("[HTTPServer] Rejected download request: Browser Integration is disabled in Settings")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "disabled",
			"error":  "Browser integration is disabled in ThunderDM Settings",
		})
		return
	}

	var req AddDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		http.Error(w, "Missing URL", http.StatusBadRequest)
		return
	}

	proto := req.Protocol
	if req.IsYTDLP && proto == "" {
		proto = "Yt-DLP"
	}

	payload := map[string]interface{}{
		"url":        req.URL,
		"filename":   req.Filename,
		"referrer":   req.Referrer,
		"cookies":    req.Cookies,
		"headers":    req.Headers,
		"user_agent": req.UserAgent,
		"is_ytdlp":   req.IsYTDLP,
		"protocol":   proto,
		"title":      req.Title,
	}

	log.Printf("[HTTPServer] Received add download request: %+v\n", payload)

	if OnAddDownloadRequest != nil {
		OnAddDownloadRequest(payload)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"message": "Download confirmation window opened",
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	enableCors(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":              "ok",
		"app":                 "ThunderDM",
		"version":             GetAppVersion(),
		"browser_integration": IsBrowserIntegrationEnabled(),
	})
}

func createMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/add", handleAddDownload)
	mux.HandleFunc("/download", handleAddDownload)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/status", handleHealth)
	return mux
}

func startServerInstance(addr string) *http.Server {
	srv := &http.Server{
		Addr:    addr,
		Handler: createMux(),
	}

	go func() {
		log.Printf("[HTTPServer] Listening on %s for browser extensions...\n", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[HTTPServer] Stopped/Error on %s: %v\n", addr, err)
		}
	}()

	return srv
}

func GetRunningPort() string {
	serverMu.Lock()
	defer serverMu.Unlock()
	if customPortAddr != "" {
		return strings.TrimPrefix(customPortAddr, "127.0.0.1:")
	}
	return "37555"
}

func StartCustomPortListener(port string) {
	if port == "" {
		port = "37555"
	}
	addr := "127.0.0.1:" + port

	serverMu.Lock()
	defer serverMu.Unlock()

	// If already listening on this exact addr and it's active, nothing to do
	if customPortAddr == addr && customPortServer != nil {
		return
	}

	// Close previous custom server if one was started
	if customPortServer != nil {
		log.Printf("[HTTPServer] Closing previous custom listener on %s\n", customPortAddr)
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		_ = customPortServer.Shutdown(ctx)
		cancel()
		customPortServer = nil
		customPortAddr = ""
	}

	// If the port is one of the base default ports, no need to spawn duplicate
	if addr == "127.0.0.1:37555" || addr == "127.0.0.1:57211" || addr == "127.0.0.1:9988" {
		return
	}

	// Start new custom server
	customPortAddr = addr
	customPortServer = startServerInstance(addr)
}

func StartHTTPServer() {
	serverStarted.Do(func() {
		// Load initial settings from SQLite kv_store
		if val, err := storage.GetKV("download_engine"); err == nil && len(val) > 0 {
			var cfg map[string]interface{}
			if err := json.Unmarshal([]byte(val), &cfg); err == nil {
				if bi, ok := cfg["browserIntegration"].(bool); ok {
					SetBrowserIntegration(bi)
				}
				if pStr, ok := cfg["port"].(string); ok && pStr != "" {
					StartCustomPortListener(pStr)
				}
			}
		}

		serverMu.Lock()
		activeServers["127.0.0.1:37555"] = startServerInstance("127.0.0.1:37555")
		activeServers["127.0.0.1:57211"] = startServerInstance("127.0.0.1:57211")
		activeServers["127.0.0.1:9988"] = startServerInstance("127.0.0.1:9988")
		serverMu.Unlock()
	})
}
