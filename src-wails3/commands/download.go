package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DownloadCommand struct {
	ctx context.Context
	app *application.App
}

func NewDownloadCommand() *DownloadCommand {
	return &DownloadCommand{}
}

func (c *DownloadCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

func (c *DownloadCommand) SetApp(app *application.App) {
	c.app = app
}

func (c *DownloadCommand) ProcessNewDownload(rawUrl string) error {
	log.Printf("[DownloadCommand] ProcessNewDownload started for URL: %s\n", rawUrl)

	var filename string
	isYTDLP := downloader.IsYTDLPURL(rawUrl)
	isHLS := !isYTDLP && downloader.IsHLSURL(rawUrl)

	// Extract basic filename from URL first
	parsedUrl, err := url.Parse(rawUrl)
	if err == nil {
		filename = path.Base(parsedUrl.Path)
		log.Printf("[DownloadCommand] Extracted base filename from URL: %s\n", filename)
	} else {
		log.Printf("[DownloadCommand] Error parsing URL: %v\n", err)
	}

	if isYTDLP {
		if parsedUrl != nil {
			if v := parsedUrl.Query().Get("v"); v != "" {
				filename = v + ".mp4"
			} else if strings.Contains(parsedUrl.Path, "/reel/") {
				parts := strings.Split(strings.Trim(parsedUrl.Path, "/"), "/")
				for i, p := range parts {
					if p == "reel" && i+1 < len(parts) {
						filename = parts[i+1] + ".mp4"
						break
					}
				}
			} else if strings.Contains(parsedUrl.Path, "/video/") {
				parts := strings.Split(strings.Trim(parsedUrl.Path, "/"), "/")
				for i, p := range parts {
					if p == "video" && i+1 < len(parts) {
						filename = parts[i+1] + ".mp4"
						break
					}
				}
			} else if filename != "" && filename != "/" && filename != "." && filename != "watch" {
				if !strings.Contains(filename, ".") {
					filename = filename + ".mp4"
				}
			}
		}
		if filename == "" || filename == "/" || filename == "." || filename == "watch" {
			filename = "video.mp4"
		}
	} else if filename == "/" || filename == "." || filename == "" {
		if isHLS {
			filename = "video.mp4"
		} else {
			filename = "download"
		}
	} else if isHLS && strings.HasSuffix(strings.ToLower(filename), ".m3u8") {
		// Automatically rename .m3u8 to .mp4 for user convenience
		baseName := strings.TrimSuffix(filename, path.Ext(filename))
		if baseName == "" || baseName == "playlist" || baseName == "master" || baseName == "index" {
			filename = "video.mp4"
		} else {
			filename = baseName + ".mp4"
		}
	}

	filename = downloader.SanitizeFilename(filename)

	proto := "Auto"
	category := ""
	if isYTDLP {
		proto = "Yt-DLP"
		category = "Videos"
	} else if isHLS {
		proto = "HLS"
		category = "Videos"
	} else {
		cat := detectCategoryByExt(filename)
		if cat != "Other" && cat != "" {
			category = cat
		} else {
			category = "Documents"
		}
	}

	// Auto-resolve base download path, category folder and user-agent from engine config
	cfg := downloader.GetEngineConfig()
	baseDownloadPath := cfg.DownloadPath
	if baseDownloadPath == "" {
		home, _ := os.UserHomeDir()
		baseDownloadPath = filepath.Join(home, "Downloads")
	}
	useCategory := cfg.UseCategoryByDefault

	savePath := baseDownloadPath
	if useCategory && category != "" && category != "All" && category != "Other" {
		savePath = filepath.Join(baseDownloadPath, category)
	}
	savePath = downloader.NormalizeSavePath(savePath, category)
	_ = os.MkdirAll(savePath, 0755)
	filename = downloader.GetEngine().ResolveUniqueFilename(savePath, filename)

	payload := map[string]interface{}{
		"url":                  rawUrl,
		"filename":             filename,
		"fileSize":             int64(0),
		"mimeType":             "",
		"protocol":             proto,
		"category":             category,
		"savePath":             savePath,
		"save_path":            savePath,
		"basePath":             baseDownloadPath,
		"useCategory":          useCategory,
		"threadCount":          0,
		"thread_count":         0,
		"defaultThreadCount":   cfg.DefaultThreadCount,
		"default_thread_count": cfg.DefaultThreadCount,
	}
	log.Printf("[DownloadCommand] Final Payload prepared: %+v\n", payload)

	// Store for frontend to fetch on mount
	if c.app != nil {
		log.Println("[DownloadCommand] c.app is not nil, creating window using centralized configuration...")
		OpenDownloadConfirmationWindow(c.app, payload)
	} else {
		log.Println("[DownloadCommand] ERROR: c.app is nil! Cannot open window.")
	}

	return nil
}

func (c *DownloadCommand) Start(id, urlStr, savePath, filename string, threadCount int, speedLimit *int64, protocol *string) error {
	savePath = downloader.NormalizeSavePath(savePath)
	log.Printf("[DownloadCommand] Start called for ID: %s, URL: %s, SavePath: %s, SpeedLimit: %v", id, urlStr, savePath, speedLimit)
	protoStr := ""
	if protocol != nil {
		protoStr = *protocol
	}
	return downloader.GetEngine().AddDownloadWithLimit(id, urlStr, savePath, filename, threadCount, speedLimit, protoStr)
}

func (c *DownloadCommand) Pause(id string) error {
	log.Printf("[DownloadCommand] Pause called for ID: %s", id)
	return downloader.GetEngine().Pause(id)
}

func (c *DownloadCommand) Resume(id, urlStr, savePath, filename string, threadCount int, speedLimit *int64, protocol *string) error {
	protoStr := ""
	if protocol != nil {
		protoStr = *protocol
	}
	// Fallback to existing task state if URL, filename, or savePath is empty
	if urlStr == "" || filename == "" || savePath == "" || protoStr == "" {
		st := downloader.GetEngine().GetTaskState(id)
		if st != nil {
			if urlStr == "" {
				if u, ok := st["url"].(string); ok && u != "" {
					urlStr = u
				}
			}
			if filename == "" {
				if f, ok := st["filename"].(string); ok && f != "" {
					filename = f
				}
			}
			if savePath == "" {
				if sp, ok := st["save_path"].(string); ok && sp != "" {
					savePath = sp
				}
			}
			if protoStr == "" {
				if p, ok := st["protocol"].(string); ok && p != "" {
					protoStr = p
				}
			}
		}
	}
	savePath = downloader.NormalizeSavePath(savePath)
	log.Printf("[DownloadCommand] Resume called for ID: %s, URL: %s, File: %s, SavePath: %s, SpeedLimit: %v", id, urlStr, filename, savePath, speedLimit)
	return downloader.GetEngine().AddDownloadWithLimit(id, urlStr, savePath, filename, threadCount, speedLimit, protoStr)
}

func (c *DownloadCommand) Cancel(id string) error {
	log.Printf("[DownloadCommand] Cancel called for ID: %s", id)
	if c.app != nil {
		if id != "" {
			if w, ok := c.app.Window.Get("realtime-progress-" + id); ok && w != nil {
				w.Close()
			}
			c.app.Event.Emit("close-realtime-progress-"+id, id)
		}
		if w, ok := c.app.Window.Get("realtime-progress"); ok && w != nil {
			w.Close()
		}
		c.app.Event.Emit("close-realtime-progress", id)
	}

	hiddenDownloadsMu.Lock()
	delete(hiddenDownloads, id)
	delete(trayMenuItems, id)
	hiddenDownloadsMu.Unlock()

	st := downloader.GetEngine().GetTaskState(id)
	if st != nil {
		if statusStr, ok := st["status"].(string); ok && (statusStr == string(downloader.StatusFinished) || statusStr == "Completed") {
			return nil
		}
	}

	return downloader.GetEngine().Cancel(id)
}

func (c *DownloadCommand) UpdateThreadCount(id string, threads int) error {
	log.Printf("[DownloadCommand] UpdateThreadCount called for ID: %s, Threads: %d", id, threads)
	_ = storage.UpdateDownloadThreadCount(id, threads)
	return downloader.GetEngine().SetThreadCount(id, threads)
}

func (c *DownloadCommand) UpdateSpeedLimit(id string, speedLimit *int64) error {
	log.Printf("[DownloadCommand] UpdateSpeedLimit called for ID: %s, Limit: %v", id, speedLimit)
	_ = storage.UpdateDownloadSpeedLimit(id, speedLimit)
	return downloader.GetEngine().SetSpeedLimit(id, speedLimit)
}

func (c *DownloadCommand) PauseAll() error {
	log.Println("[DownloadCommand] PauseAll called")
	downloader.GetEngine().PauseAll()
	return nil
}

func (c *DownloadCommand) GetTaskStatus(id string) map[string]interface{} {
	return downloader.GetEngine().GetTaskState(id)
}

func (c *DownloadCommand) GetDefaultThreadCount() int {
	return downloader.GetEngineConfig().DefaultThreadCount
}

func (c *DownloadCommand) GetDefaultEngineConfig() downloader.EngineConfig {
	return downloader.GetEngineConfig()
}

type RemoteFileInfo struct {
	Filename       *string             `json:"filename,omitempty"`
	Title          *string             `json:"title,omitempty"`
	ContentLength  *int64              `json:"content_length"`
	FormattedSize  string              `json:"formatted_size"`
	AcceptRanges   bool                `json:"accept_ranges"`
	ContentType    *string             `json:"content_type"`
	IsHLS          bool                `json:"is_hls"`
	SegmentCount   int                 `json:"segment_count"`
	Duration       float64             `json:"duration"`
	IsYTDLP        bool                `json:"is_ytdlp"`
	YTDLPInstalled bool                `json:"ytdlp_installed"`
	Formats        []downloader.Format `json:"formats,omitempty"`
}

func formatBytesHuman(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}
	k := 1024.0
	sizes := []string{"B", "KiB", "MiB", "GiB", "TiB"}
	i := 0
	val := float64(bytes)
	for val >= k && i < len(sizes)-1 {
		val /= k
		i++
	}
	return fmt.Sprintf("%.2f %s", val, sizes[i])
}

var mimeToExtMap = map[string]string{
	"application/zip":                                                         ".zip",
	"application/x-zip-compressed":                                            ".zip",
	"application/x-rar":                                                       ".rar",
	"application/x-rar-compressed":                                            ".rar",
	"application/vnd.rar":                                                     ".rar",
	"application/x-7z-compressed":                                             ".7z",
	"application/x-tar":                                                       ".tar",
	"application/gzip":                                                        ".gz",
	"application/x-gzip":                                                      ".tar.gz",
	"application/x-bzip2":                                                     ".bz2",
	"application/x-xz":                                                        ".xz",
	"application/pdf":                                                         ".pdf",
	"application/msword":                                                      ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   ".docx",
	"application/vnd.ms-excel":                                                ".xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ".xlsx",
	"application/vnd.ms-powerpoint":                                           ".ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
	"application/vnd.android.package-archive":                                 ".apk",
	"application/x-msdownload":                                                ".exe",
	"application/x-msdos-program":                                             ".exe",
	"application/x-iso9660-image":                                             ".iso",
	"application/x-apple-diskimage":                                           ".dmg",
	"application/x-debian-package":                                            ".deb",
	"application/x-redhat-package-manager":                                    ".rpm",
	"video/mp4":                                                               ".mp4",
	"video/x-matroska":                                                        ".mkv",
	"video/webm":                                                              ".webm",
	"video/quicktime":                                                         ".mov",
	"video/x-msvideo":                                                         ".avi",
	"video/x-flv":                                                             ".flv",
	"audio/mpeg":                                                              ".mp3",
	"audio/mp4":                                                               ".m4a",
	"audio/flac":                                                              ".flac",
	"audio/wav":                                                               ".wav",
	"audio/ogg":                                                               ".ogg",
	"audio/aac":                                                               ".aac",
	"image/jpeg":                                                              ".jpg",
	"image/png":                                                               ".png",
	"image/gif":                                                               ".gif",
	"image/webp":                                                              ".webp",
	"image/svg+xml":                                                           ".svg",
	"text/plain":                                                              ".txt",
	"text/csv":                                                                ".csv",
	"text/html":                                                               ".html",
	"application/json":                                                        ".json",
	"application/xml":                                                         ".xml",
}

func extractFilenameHarder(resp *http.Response, targetURL string, contentType string) string {
	// 1. Content-Disposition parsing (RFC 5987, standard params, and fallback regex)
	if resp != nil {
		if cd := resp.Header.Get("Content-Disposition"); cd != "" {
			if _, params, err := mime.ParseMediaType(cd); err == nil {
				if fn, ok := params["filename*"]; ok && fn != "" {
					parts := strings.SplitN(fn, "''", 2)
					if len(parts) == 2 {
						if unescaped, err := url.PathUnescape(parts[1]); err == nil {
							if clean := downloader.SanitizeFilename(unescaped); clean != "" && clean != "download" {
								return clean
							}
						}
					}
				}
				if fn, ok := params["filename"]; ok && fn != "" {
					if clean := downloader.SanitizeFilename(fn); clean != "" && clean != "download" {
						return clean
					}
				}
			}
			// Regex fallback if media type parser failed on malformed quotes
			reFnStar := regexp.MustCompile(`(?i)filename\*=(?:UTF-8''|utf-8'')?([^;\r\n]+)`)
			if m := reFnStar.FindStringSubmatch(cd); len(m) > 1 {
				val := strings.Trim(strings.TrimSpace(m[1]), `"'`)
				if unescaped, err := url.PathUnescape(val); err == nil {
					if clean := downloader.SanitizeFilename(unescaped); clean != "" && clean != "download" {
						return clean
					}
				}
			}
			reFn := regexp.MustCompile(`(?i)filename="?([^";\r\n]+)"?`)
			if m := reFn.FindStringSubmatch(cd); len(m) > 1 {
				val := strings.Trim(strings.TrimSpace(m[1]), `"'`)
				if clean := downloader.SanitizeFilename(val); clean != "" && clean != "download" {
					return clean
				}
			}
		}
	}

	// 2. Query Parameters (check response-content-disposition, filename, file, name, download, etc.)
	urlsToCheck := []string{}
	if resp != nil && resp.Request != nil && resp.Request.URL != nil {
		urlsToCheck = append(urlsToCheck, resp.Request.URL.String())
	}
	urlsToCheck = append(urlsToCheck, targetURL)

	for _, uStr := range urlsToCheck {
		if parsed, err := url.Parse(uStr); err == nil {
			q := parsed.Query()
			// Check response-content-disposition query parameter (AWS S3 / R2 / GCS)
			if rcd := q.Get("response-content-disposition"); rcd != "" {
				if strings.Contains(rcd, "filename=") {
					re := regexp.MustCompile(`(?i)filename="?([^";\r\n]+)"?`)
					if m := re.FindStringSubmatch(rcd); len(m) > 1 {
						if clean := downloader.SanitizeFilename(strings.Trim(m[1], `"'`)); clean != "" && clean != "download" {
							return clean
						}
					}
				}
			}
			for _, key := range []string{"filename", "file_name", "file", "name", "title", "download", "doc", "document", "attachment"} {
				if val := q.Get(key); val != "" {
					if unescaped, err := url.PathUnescape(val); err == nil {
						val = unescaped
					}
					if clean := downloader.SanitizeFilename(val); clean != "" && clean != "download" && (strings.Contains(clean, ".") || len(clean) > 3) {
						if filepath.Ext(clean) == "" && contentType != "" {
							if ext, ok := mimeToExtMap[strings.ToLower(strings.Split(contentType, ";")[0])]; ok {
								clean += ext
							}
						}
						return clean
					}
				}
			}
		}
	}

	// 3. Path Segments from final redirected URL and initial URL
	for _, uStr := range urlsToCheck {
		if parsed, err := url.Parse(uStr); err == nil {
			cleanPath := path.Clean(parsed.Path)
			segments := strings.Split(strings.Trim(cleanPath, "/"), "/")
			for i := len(segments) - 1; i >= 0; i-- {
				seg := segments[i]
				if seg == "" || seg == "." || seg == "/" {
					continue
				}
				if unescaped, err := url.PathUnescape(seg); err == nil {
					seg = unescaped
				}
				clean := downloader.SanitizeFilename(seg)
				if clean != "" && clean != "download" && clean != "zip" && clean != "tar" {
					if strings.Contains(uStr, "github.com") || strings.Contains(uStr, "gitlab.com") {
						if len(segments) >= 2 {
							repoName := segments[1]
							if repoName != "" && !strings.HasPrefix(clean, repoName) {
								clean = repoName + "-" + clean
							}
						}
					}
					if filepath.Ext(clean) == "" && contentType != "" {
						if ext, ok := mimeToExtMap[strings.ToLower(strings.Split(contentType, ";")[0])]; ok {
							clean += ext
						}
					}
					return clean
				}
			}
		}
	}

	// 4. Fallback from host or generic
	if parsed, err := url.Parse(targetURL); err == nil && parsed.Host != "" {
		hostClean := downloader.SanitizeFilename(parsed.Host)
		if contentType != "" {
			if ext, ok := mimeToExtMap[strings.ToLower(strings.Split(contentType, ";")[0])]; ok {
				return hostClean + "_download" + ext
			}
		}
		return hostClean + "_download"
	}

	return "download"
}

func (c *DownloadCommand) FetchFileInfo(urlStr string) (*RemoteFileInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opts := downloader.ParseDownloadOptions("", urlStr)
	cleanURL := opts.CleanURL
	if cleanURL == "" {
		return nil, fmt.Errorf("Invalid or empty URL")
	}

	// Auto-lookup vault credentials and per-host settings from download_engine.json if not explicitly provided
	vItem := downloader.MatchVaultItem(cleanURL)
	if vItem != nil {
		if opts.Username == "" && opts.Password == "" {
			if vItem.User != "" || vItem.Pass != "" {
				opts.Username = vItem.User
				opts.Password = vItem.Pass
			}
		}
		if opts.UserAgent == "" && vItem.UserAgent != "" {
			opts.UserAgent = vItem.UserAgent
		}
	}

	applyHeaders := func(r *http.Request) {
		if opts.Username != "" || opts.Password != "" {
			r.SetBasicAuth(opts.Username, opts.Password)
		}
		if opts.UserAgent != "" {
			r.Header.Set("User-Agent", opts.UserAgent)
		} else if cfgUa := downloader.GetEngineConfig().UserAgent; cfgUa != "" {
			r.Header.Set("User-Agent", cfgUa)
		} else {
			r.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
		}
		r.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,application/signed-exchange;v=b3;q=0.7,*/*;q=0.8")
		r.Header.Set("Accept-Language", "en-US,en;q=0.9")
		r.Header.Set("Sec-Ch-Ua", `"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"`)
		r.Header.Set("Sec-Ch-Ua-Mobile", "?0")
		r.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
		r.Header.Set("Sec-Fetch-Dest", "document")
		r.Header.Set("Sec-Fetch-Mode", "navigate")
		r.Header.Set("Sec-Fetch-Site", "none")
		r.Header.Set("Sec-Fetch-User", "?1")
		r.Header.Set("Upgrade-Insecure-Requests", "1")
		if opts.Referer != "" {
			r.Header.Set("Referer", opts.Referer)
		}
		if opts.Cookies != "" {
			r.Header.Set("Cookie", opts.Cookies)
		}
	}

	// Handle YT-DLP URLs
	if downloader.IsYTDLPURL(cleanURL) {
		client := downloader.NewClient()
		ctype := "video/mp4"
		isInstalled := client.IsInstalled()
		if !isInstalled {
			return &RemoteFileInfo{
				FormattedSize:  "Dynamic Stream (YT-DLP)",
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsYTDLP:        true,
				YTDLPInstalled: false,
			}, nil
		}

		meta, err := client.GetVideoMetadata(cleanURL, opts.Cookies)
		if err == nil && meta != nil {
			rawTitle := strings.TrimSpace(meta.Title)
			if rawTitle == "" {
				rawTitle = strings.TrimSpace(meta.Fulltitle)
			}
			title := downloader.CleanMediaTitle(rawTitle, meta.Description, meta.Uploader)
			var fname *string
			if title != "" {
				clean := downloader.SanitizeFilename(title + ".mp4")
				fname = &clean
			}
			return &RemoteFileInfo{
				Filename:       fname,
				Title:          &title,
				FormattedSize:  "Dynamic Stream (YT-DLP)",
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsYTDLP:        true,
				YTDLPInstalled: true,
				Duration:       meta.Duration,
				Formats:        meta.Formats,
			}, nil
		}
		return &RemoteFileInfo{
			FormattedSize:  "Video Stream (YT-DLP)",
			AcceptRanges:   true,
			ContentType:    &ctype,
			IsYTDLP:        true,
			YTDLPInstalled: true,
		}, nil
	}

	// Handle HLS URLs directly
	if downloader.IsHLSURL(cleanURL) {
		playlist, err := downloader.FetchAndParseHLS(ctx, downloader.SharedHTTPClient, cleanURL, opts.Username, opts.Password, opts.UserAgent, opts.Referer, opts.Cookies)
		if err == nil && playlist != nil && len(playlist.Segments) > 0 {
			segCount := len(playlist.Segments)
			dur := playlist.TotalDuration
			min := int(dur) / 60
			sec := int(dur) % 60
			h := min / 60
			min = min % 60

			durStr := fmt.Sprintf("%02d:%02d", min, sec)
			if h > 0 {
				durStr = fmt.Sprintf("%02d:%02d:%02d", h, min, sec)
			}

			ctype := "application/vnd.apple.mpegurl"
			fname := extractFilenameHarder(nil, cleanURL, ctype)
			return &RemoteFileInfo{
				Filename:      &fname,
				FormattedSize: fmt.Sprintf("HLS Video (%d segs, %s)", segCount, durStr),
				AcceptRanges:  true,
				ContentType:   &ctype,
				IsHLS:         true,
				SegmentCount:  segCount,
				Duration:      dur,
			}, nil
		}
	}

	// Robust multi-step HTTP Probing: Try HEAD -> GET Range 0-0 -> GET Range 0-1024 -> GET Standard
	var resp *http.Response
	var lastErr error

	// Probe Step 1: HTTP HEAD
	reqHead, err := http.NewRequestWithContext(ctx, http.MethodHead, cleanURL, nil)
	if err == nil {
		applyHeaders(reqHead)
		r, errDo := downloader.SharedHTTPClient.Do(reqHead)
		if errDo == nil && r.StatusCode < 400 {
			resp = r
		} else {
			if r != nil && r.Body != nil {
				io.Copy(io.Discard, r.Body)
				r.Body.Close()
			}
			if errDo != nil {
				lastErr = errDo
			} else if r != nil {
				lastErr = fmt.Errorf("HTTP %d (%s)", r.StatusCode, http.StatusText(r.StatusCode))
			}
		}
	}

	// Probe Step 2: HTTP GET with Range bytes=0-0
	if resp == nil {
		reqRange, err := http.NewRequestWithContext(ctx, http.MethodGet, cleanURL, nil)
		if err == nil {
			reqRange.Header.Set("Range", "bytes=0-0")
			applyHeaders(reqRange)
			r, errDo := downloader.SharedHTTPClient.Do(reqRange)
			if errDo == nil && (r.StatusCode == http.StatusOK || r.StatusCode == http.StatusPartialContent || (r.StatusCode >= 200 && r.StatusCode < 400)) {
				resp = r
			} else {
				if r != nil && r.Body != nil {
					io.Copy(io.Discard, r.Body)
					r.Body.Close()
				}
				if errDo != nil {
					lastErr = errDo
				} else if r != nil {
					lastErr = fmt.Errorf("HTTP %d (%s)", r.StatusCode, http.StatusText(r.StatusCode))
				}
			}
		}
	}

	// Probe Step 3: HTTP GET with Range bytes=0-1024
	if resp == nil {
		reqRange1k, err := http.NewRequestWithContext(ctx, http.MethodGet, cleanURL, nil)
		if err == nil {
			reqRange1k.Header.Set("Range", "bytes=0-1024")
			applyHeaders(reqRange1k)
			r, errDo := downloader.SharedHTTPClient.Do(reqRange1k)
			if errDo == nil && (r.StatusCode == http.StatusOK || r.StatusCode == http.StatusPartialContent || (r.StatusCode >= 200 && r.StatusCode < 400)) {
				resp = r
			} else {
				if r != nil && r.Body != nil {
					io.Copy(io.Discard, r.Body)
					r.Body.Close()
				}
				if errDo != nil {
					lastErr = errDo
				} else if r != nil {
					lastErr = fmt.Errorf("HTTP %d (%s)", r.StatusCode, http.StatusText(r.StatusCode))
				}
			}
		}
	}

	// Probe Step 4: Standard HTTP GET
	if resp == nil {
		reqGet, err := http.NewRequestWithContext(ctx, http.MethodGet, cleanURL, nil)
		if err == nil {
			applyHeaders(reqGet)
			r, errDo := downloader.SharedHTTPClient.Do(reqGet)
			if errDo == nil && r.StatusCode < 400 {
				resp = r
			} else {
				if r != nil && r.Body != nil {
					io.Copy(io.Discard, r.Body)
					r.Body.Close()
				}
				if errDo != nil {
					lastErr = errDo
				} else if r != nil {
					lastErr = fmt.Errorf("HTTP %d (%s)", r.StatusCode, http.StatusText(r.StatusCode))
				}
			}
		}
	}

	if resp == nil {
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("Could not connect to server or retrieve headers")
	}

	defer func() {
		if resp != nil && resp.Body != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}()

	ctype := resp.Header.Get("Content-Type")

	// Detect HLS if content type indicates mpegurl
	if strings.Contains(strings.ToLower(ctype), "mpegurl") {
		playlist, err := downloader.FetchAndParseHLS(ctx, downloader.SharedHTTPClient, cleanURL, opts.Username, opts.Password, opts.UserAgent, opts.Referer)
		if err == nil && playlist != nil && len(playlist.Segments) > 0 {
			segCount := len(playlist.Segments)
			dur := playlist.TotalDuration
			min := int(dur) / 60
			sec := int(dur) % 60
			fname := extractFilenameHarder(resp, cleanURL, ctype)
			return &RemoteFileInfo{
				Filename:      &fname,
				FormattedSize: fmt.Sprintf("HLS Video (%d segs, %02d:%02d)", segCount, min, sec),
				AcceptRanges:  true,
				ContentType:   &ctype,
				IsHLS:         true,
				SegmentCount:  segCount,
				Duration:      dur,
			}, nil
		}
	}

	info := &RemoteFileInfo{}

	var size int64
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		if idx := strings.LastIndex(cr, "/"); idx != -1 {
			size, _ = strconv.ParseInt(cr[idx+1:], 10, 64)
		}
	}
	if size == 0 {
		if cl := resp.Header.Get("Content-Length"); cl != "" {
			size, _ = strconv.ParseInt(cl, 10, 64)
		}
	}

	if size > 0 {
		info.ContentLength = &size
		info.FormattedSize = formatBytesHuman(size)
	} else {
		info.FormattedSize = "Unknown"
	}

	acceptRanges := resp.Header.Get("Accept-Ranges")
	info.AcceptRanges = (acceptRanges == "bytes" || resp.StatusCode == http.StatusPartialContent)

	if ctype != "" {
		info.ContentType = &ctype
	}

	// Extract filename using hardened multi-strategy extractor
	resolvedFilename := extractFilenameHarder(resp, cleanURL, ctype)
	if resolvedFilename != "" {
		info.Filename = &resolvedFilename
	} else {
		return nil, fmt.Errorf("Could not determine filename from URL or server")
	}

	return info, nil
}

type CrawlPageOptions struct {
	URL       string `json:"url"`
	Recursive bool   `json:"recursive"`
	MaxDepth  int    `json:"maxDepth"`
}

type ScrapedFileLink struct {
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	Subfolder string `json:"subfolder,omitempty"`
	Size      int64  `json:"size"`
	SizeStr   string `json:"size_str"`
	Ext       string `json:"ext"`
	Category  string `json:"category"`
}

func detectCategoryByExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != "" {
		ext = strings.TrimPrefix(ext, ".")
	}
	switch ext {
	case "mp4", "mkv", "avi", "mov", "webm", "ts", "m4v", "flv", "m3u8":
		return "Videos"
	case "zip", "rar", "7z", "tar", "gz", "iso", "bz2", "xz":
		return "Compressed"
	case "exe", "msi", "dmg", "deb", "rpm", "apk", "bin":
		return "Programs"
	case "mp3", "flac", "wav", "aac", "ogg", "m4a", "opus":
		return "Music"
	case "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp":
		return "Pictures"
	case "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "txt", "csv", "srt", "sub", "nfo":
		return "Documents"
	default:
		return "Other"
	}
}

type dirCrawlTask struct {
	dirURL    *url.URL
	subfolder string
	depth     int
}

func isDirectoryLink(rawHref string, parsedHref *url.URL, resolved *url.URL, baseName string) bool {
	if strings.HasSuffix(rawHref, "/") || strings.HasSuffix(parsedHref.Path, "/") || strings.HasSuffix(resolved.Path, "/") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(baseName))
	if ext != "" {
		extClean := strings.TrimPrefix(ext, ".")
		if detectCategoryByExt(baseName) != "Other" || isCommonFileExt(extClean) {
			return false
		}
	}
	if !strings.Contains(baseName, ".") {
		return true
	}
	return false
}

func isCommonFileExt(ext string) bool {
	switch ext {
	case "mkv", "mp4", "avi", "mov", "webm", "ts", "m4v", "flv", "wmv", "3gp",
		"mp3", "flac", "wav", "aac", "ogg", "m4a", "opus", "wma",
		"zip", "rar", "7z", "tar", "gz", "iso", "bz2", "xz", "tgz",
		"exe", "msi", "dmg", "deb", "rpm", "apk", "bin", "appimage",
		"png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico",
		"pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "txt", "csv", "epub", "mobi",
		"srt", "sub", "vtt", "ass", "nfo", "torrent", "json", "xml":
		return true
	default:
		return false
	}
}

func normalizeDirURL(u *url.URL) string {
	if u == nil {
		return ""
	}
	clone := *u
	clone.RawQuery = ""
	clone.Fragment = ""
	p := strings.TrimSuffix(clone.Path, "/")
	clone.Path = p
	return clone.String()
}

func (c *DownloadCommand) CrawlPageLinks(rawPayload string) ([]ScrapedFileLink, error) {
	opts := CrawlPageOptions{
		Recursive: true,
		MaxDepth:  3,
	}

	trimmed := strings.TrimSpace(rawPayload)
	if strings.HasPrefix(trimmed, "{") {
		_ = json.Unmarshal([]byte(trimmed), &opts)
	} else {
		opts.URL = trimmed
	}

	rawURL := strings.TrimSpace(opts.URL)
	if rawURL == "" {
		return nil, fmt.Errorf("empty URL provided")
	}

	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") && !strings.HasPrefix(rawURL, "ftp://") {
		rawURL = "http://" + rawURL
	}

	baseURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	maxDepth := opts.MaxDepth
	if !opts.Recursive {
		maxDepth = 0
	} else {
		if maxDepth <= 0 {
			maxDepth = 3
		}
		if maxDepth > 5 {
			maxDepth = 5 // Safety bound
		}
	}

	rootBasePath := baseURL.Path
	if !strings.HasSuffix(rootBasePath, "/") && !strings.Contains(path.Base(rootBasePath), ".") {
		rootBasePath += "/"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	queue := []dirCrawlTask{
		{dirURL: baseURL, subfolder: "", depth: 0},
	}
	visitedDirs := make(map[string]bool)
	visitedDirs[normalizeDirURL(baseURL)] = true

	var results []ScrapedFileLink
	seenFiles := make(map[string]bool)
	maxTotalFiles := 2500

	for len(queue) > 0 && len(results) < maxTotalFiles {
		select {
		case <-ctx.Done():
			break
		default:
		}

		current := queue[0]
		queue = queue[1:]

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current.dirURL.String(), nil)
		if err != nil {
			continue
		}

		vItem := downloader.MatchVaultItem(current.dirURL.String())
		if vItem != nil {
			if vItem.User != "" || vItem.Pass != "" {
				req.SetBasicAuth(vItem.User, vItem.Pass)
			}
			if vItem.UserAgent != "" {
				req.Header.Set("User-Agent", vItem.UserAgent)
			}
		}
		if req.Header.Get("User-Agent") == "" {
			if cfgUa := downloader.GetEngineConfig().UserAgent; cfgUa != "" {
				req.Header.Set("User-Agent", cfgUa)
			} else {
				req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
			}
		}

		resp, err := downloader.SharedHTTPClient.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode >= 400 {
			resp.Body.Close()
			continue
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
		resp.Body.Close()
		if err != nil {
			continue
		}

		// 1. Try parsing JSON directory response
		var jsonEntries []map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &jsonEntries); err == nil && len(jsonEntries) > 0 {
			for _, entry := range jsonEntries {
				var linkURL, linkName string
				isDir := false
				if d, ok := entry["is_dir"].(bool); ok {
					isDir = d
				} else if t, ok := entry["type"].(string); ok && strings.EqualFold(t, "folder") {
					isDir = true
				}

				for _, k := range []string{"url", "href", "link", "download_url", "path"} {
					if v, ok := entry[k].(string); ok && v != "" {
						linkURL = v
						break
					}
				}
				for _, k := range []string{"name", "filename", "title", "file"} {
					if v, ok := entry[k].(string); ok && v != "" {
						linkName = v
						break
					}
				}

				if linkURL != "" {
					parsedHref, err := url.Parse(linkURL)
					if err == nil {
						resolved := current.dirURL.ResolveReference(parsedHref)
						if isDir {
							if current.depth < maxDepth {
								normDir := normalizeDirURL(resolved)
								if !visitedDirs[normDir] {
									visitedDirs[normDir] = true
									childSub := linkName
									if current.subfolder != "" {
										childSub = filepath.Join(current.subfolder, linkName)
									}
									queue = append(queue, dirCrawlTask{
										dirURL:    resolved,
										subfolder: childSub,
										depth:     current.depth + 1,
									})
								}
							}
						} else {
							finalURL := resolved.String()
							if !seenFiles[finalURL] {
								seenFiles[finalURL] = true
								if linkName == "" {
									linkName = path.Base(resolved.Path)
								}
								if unescaped, err := url.PathUnescape(linkName); err == nil && unescaped != "" {
									linkName = unescaped
								}
								linkName = downloader.SanitizeFilename(linkName)
								if linkName != "" && linkName != "." && linkName != "/" {
									results = append(results, ScrapedFileLink{
										Filename:  linkName,
										URL:       finalURL,
										Subfolder: current.subfolder,
										Ext:       strings.TrimPrefix(filepath.Ext(linkName), "."),
										Category:  detectCategoryByExt(linkName),
									})
								}
							}
						}
					}
				}
			}
			continue
		}

		// 2. Parse HTML <a> tags using regex
		bodyStr := string(bodyBytes)
		hrefPattern := regexp.MustCompile(`(?i)<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>`)
		matches := hrefPattern.FindAllStringSubmatch(bodyStr, -1)

		for _, match := range matches {
			if len(match) < 2 {
				continue
			}
			rawHref := strings.TrimSpace(match[1])
			if rawHref == "" || strings.HasPrefix(rawHref, "#") || strings.HasPrefix(rawHref, "javascript:") ||
				strings.HasPrefix(rawHref, "mailto:") || strings.HasPrefix(rawHref, "tel:") {
				continue
			}

			if strings.HasPrefix(rawHref, "?") {
				continue
			}

			if rawHref == ".." || rawHref == "../" || strings.HasPrefix(rawHref, "../") || rawHref == "." || rawHref == "./" {
				continue
			}

			parsedHref, err := url.Parse(rawHref)
			if err != nil {
				continue
			}

			if parsedHref.RawQuery != "" && (strings.Contains(parsedHref.RawQuery, "C=") || strings.Contains(parsedHref.RawQuery, "sort=") || strings.Contains(parsedHref.RawQuery, "order=")) {
				continue
			}

			resolved := current.dirURL.ResolveReference(parsedHref)
			resolvedURL := resolved.String()

			if !strings.EqualFold(resolved.Host, baseURL.Host) {
				continue
			}

			if !strings.HasPrefix(resolved.Path, rootBasePath) && !strings.HasPrefix(rootBasePath, resolved.Path) {
				continue
			}

			if len(resolved.Path) < len(rootBasePath) && !strings.HasPrefix(rootBasePath, resolved.Path) {
				continue
			}

			if normalizeDirURL(resolved) == normalizeDirURL(current.dirURL) {
				continue
			}

			baseName := path.Base(resolved.Path)
			if baseName == "" || baseName == "." || baseName == "/" || baseName == ".." ||
				strings.EqualFold(baseName, "index.html") || strings.EqualFold(baseName, "index.htm") ||
				strings.EqualFold(baseName, "favicon.ico") {
				continue
			}

			if unescaped, err := url.PathUnescape(baseName); err == nil && unescaped != "" {
				baseName = unescaped
			}
			baseName = downloader.SanitizeFilename(baseName)
			if baseName == "" {
				continue
			}

			isDir := isDirectoryLink(rawHref, parsedHref, resolved, baseName)

			if isDir {
				if current.depth < maxDepth {
					normDir := normalizeDirURL(resolved)
					if !visitedDirs[normDir] {
						visitedDirs[normDir] = true
						childSub := baseName
						if current.subfolder != "" {
							childSub = filepath.Join(current.subfolder, baseName)
						}
						queue = append(queue, dirCrawlTask{
							dirURL:    resolved,
							subfolder: childSub,
							depth:     current.depth + 1,
						})
					}
				}
			} else {
				if !seenFiles[resolvedURL] {
					seenFiles[resolvedURL] = true
					ext := strings.TrimPrefix(filepath.Ext(baseName), ".")
					cat := detectCategoryByExt(baseName)

					results = append(results, ScrapedFileLink{
						Filename:  baseName,
						URL:       resolvedURL,
						Subfolder: current.subfolder,
						Ext:       ext,
						Category:  cat,
					})
				}
			}
		}
	}

	return results, nil
}

func (c *DownloadCommand) ProbeFileSizes(urls []string) (map[string]int64, error) {
	result := make(map[string]int64)
	var mu sync.Mutex
	var wg sync.WaitGroup

	sem := make(chan struct{}, 10) // Limit concurrency to 10 parallel probes

	for _, u := range urls {
		cleanURL := strings.TrimSpace(u)
		if cleanURL == "" {
			continue
		}
		wg.Add(1)
		go func(targetURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()

			req, err := http.NewRequestWithContext(ctx, http.MethodHead, targetURL, nil)
			if err != nil {
				return
			}
			vItem := downloader.MatchVaultItem(targetURL)
			if vItem != nil {
				if vItem.User != "" || vItem.Pass != "" {
					req.SetBasicAuth(vItem.User, vItem.Pass)
				}
				if vItem.UserAgent != "" {
					req.Header.Set("User-Agent", vItem.UserAgent)
				}
			}
			if req.Header.Get("User-Agent") == "" {
				if cfgUa := downloader.GetEngineConfig().UserAgent; cfgUa != "" {
					req.Header.Set("User-Agent", cfgUa)
				} else {
					req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
				}
			}

			resp, err := downloader.SharedHTTPClient.Do(req)
			if err != nil || (resp != nil && resp.StatusCode >= 400) || resp == nil {
				if resp != nil && resp.Body != nil {
					resp.Body.Close()
				}
				// Fallback to GET byte range 0-0 probe
				req, err = http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
				if err != nil {
					return
				}
				req.Header.Set("Range", "bytes=0-0")
				resp, err = downloader.SharedHTTPClient.Do(req)
				if err != nil || (resp != nil && resp.StatusCode >= 400) || resp == nil {
					if resp != nil && resp.Body != nil {
						resp.Body.Close()
					}
					return
				}
			}
			if resp == nil {
				return
			}
			defer func() {
				if resp != nil && resp.Body != nil {
					resp.Body.Close()
				}
			}()

			var size int64
			if cr := resp.Header.Get("Content-Range"); cr != "" {
				if idx := strings.LastIndex(cr, "/"); idx != -1 {
					size, _ = strconv.ParseInt(cr[idx+1:], 10, 64)
				}
			}
			if size == 0 {
				if cl := resp.Header.Get("Content-Length"); cl != "" {
					size, _ = strconv.ParseInt(cl, 10, 64)
				}
			}

			if size > 0 {
				mu.Lock()
				result[targetURL] = size
				mu.Unlock()
			}
		}(cleanURL)
	}

	wg.Wait()
	return result, nil
}
