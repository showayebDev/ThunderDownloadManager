// Package probe handles remote file metadata probing (FetchFileInfo, ProbeFileSizes),
// hardened filename extraction, HLS/YT-DLP/Torrent detection, and cookie/auth header application.
package probe

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader"
)

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
	IsTorrent      bool                `json:"is_torrent,omitempty"`
	TorrentFiles   []string            `json:"torrent_files,omitempty"`
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
	"application/zip":              ".zip",
	"application/x-zip-compressed": ".zip",
	"application/x-rar":            ".rar",
	"application/x-rar-compressed": ".rar",
	"application/vnd.rar":          ".rar",
	"application/x-7z-compressed":  ".7z",
	"application/x-tar":            ".tar",
	"application/gzip":             ".gz",
	"application/x-gzip":           ".tar.gz",
	"application/x-bzip2":          ".bz2",
	"application/x-xz":             ".xz",
	"application/pdf":              ".pdf",
	"application/msword":           ".doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
	"application/vnd.ms-excel": ".xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ".xlsx",
	"application/vnd.ms-powerpoint":                                             ".ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
	"application/vnd.android.package-archive":                                   ".apk",
	"application/x-msdownload":                                                  ".exe",
	"application/x-msdos-program":                                               ".exe",
	"application/x-iso9660-image":                                               ".iso",
	"application/x-apple-diskimage":                                             ".dmg",
	"application/x-debian-package":                                              ".deb",
	"application/x-redhat-package-manager":                                      ".rpm",
	"video/mp4":                                                                 ".mp4",
	"video/x-matroska":                                                          ".mkv",
	"video/webm":                                                                ".webm",
	"video/quicktime":                                                           ".mov",
	"video/x-msvideo":                                                           ".avi",
	"video/x-flv":                                                               ".flv",
	"audio/mpeg":                                                                ".mp3",
	"audio/mp4":                                                                 ".m4a",
	"audio/flac":                                                                ".flac",
	"audio/wav":                                                                 ".wav",
	"audio/ogg":                                                                 ".ogg",
	"audio/aac":                                                                 ".aac",
	"image/jpeg":                                                                ".jpg",
	"image/png":                                                                 ".png",
	"image/gif":                                                                 ".gif",
	"image/webp":                                                                ".webp",
	"image/svg+xml":                                                             ".svg",
	"text/plain":                                                                ".txt",
	"text/csv":                                                                  ".csv",
	"text/html":                                                                 ".html",
	"application/json":                                                          ".json",
	"application/xml":                                                           ".xml",
	"application/x-bittorrent":                                                  ".torrent",
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

// FetchFileInfo probes a remote URL (HTTP, HLS, YT-DLP, Torrent) for metadata, size, and filename.
func FetchFileInfo(urlStr string) (*RemoteFileInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opts := downloader.ParseDownloadOptions("", urlStr)
	cleanURL := opts.CleanURL
	if cleanURL == "" {
		return nil, fmt.Errorf("Invalid or empty URL")
	}

	// Auto-lookup vault credentials and per-host settings from the credential vault if not explicitly provided
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
		effectiveProto := opts.Protocol
		if effectiveProto == "" {
			effectiveProto = "http"
		}
		if opts.Cookies != "" && (opts.ForceCookie || !downloader.ShouldBypassCookies(cleanURL, effectiveProto)) {
			r.Header.Set("Cookie", opts.Cookies)
		}
	}

	// Handle Torrent and Magnet URLs
	if downloader.IsTorrentURL(cleanURL) || downloader.IsTorrentFile(cleanURL) {
		tInfo, err := downloader.ParseTorrentInfo(cleanURL)
		if err == nil && tInfo != nil {
			fname := downloader.SanitizeFilename(tInfo.Name)
			formatted := "Magnet Link (BitTorrent)"
			if tInfo.TotalSize > 0 {
				formatted = formatBytesHuman(tInfo.TotalSize)
			}
			ctype := "application/x-bittorrent"
			var clen *int64
			if tInfo.TotalSize > 0 {
				sz := tInfo.TotalSize
				clen = &sz
			}
			return &RemoteFileInfo{
				Filename:       &fname,
				Title:          &tInfo.Name,
				ContentLength:  clen,
				FormattedSize:  formatted,
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsTorrent:      true,
				TorrentFiles:   tInfo.Files,
				YTDLPInstalled: downloader.NewClient().IsInstalled(),
			}, nil
		}
	}

	// Handle YT-DLP URLs
	isYTDLPExplicit := strings.EqualFold(opts.Protocol, "Yt-DLP") ||
		strings.EqualFold(opts.Protocol, "YT-DLP") ||
		strings.EqualFold(opts.Protocol, "ytdlp") ||
		strings.HasPrefix(strings.ToLower(opts.Protocol), "yt-dlp") ||
		strings.HasPrefix(strings.ToLower(opts.Protocol), "ytdlp")
	isYTDLP := isYTDLPExplicit || downloader.IsYTDLPURL(cleanURL)

	if isYTDLP {
		client := downloader.NewClient()
		ctype := "video/mp4"
		isInstalled := client.IsInstalled()
		if !isInstalled {
			fallbackName := downloader.ExtractYTDLPFallbackFilename(cleanURL)
			return &RemoteFileInfo{
				Filename:       &fallbackName,
				FormattedSize:  "Dynamic Stream (YT-DLP)",
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsYTDLP:        true,
				YTDLPInstalled: false,
			}, nil
		}

		fcStr := "false"
		if opts.ForceCookie {
			fcStr = "true"
		}
		meta, err := client.GetVideoMetadata(cleanURL, opts.Cookies, fcStr)
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
			if fname == nil || *fname == "" || *fname == "video.mp4" || *fname == "download.mp4" {
				fallback := downloader.ExtractYTDLPFallbackFilename(cleanURL)
				fname = &fallback
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

		fallbackName := downloader.ExtractYTDLPFallbackFilename(cleanURL)
		return &RemoteFileInfo{
			Filename:       &fallbackName,
			FormattedSize:  "Dynamic Stream (YT-DLP)",
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
				Filename:       &fname,
				FormattedSize:  fmt.Sprintf("HLS Video (%d segs, %s)", segCount, durStr),
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsHLS:          true,
				SegmentCount:   segCount,
				Duration:       dur,
				YTDLPInstalled: downloader.NewClient().IsInstalled(),
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
				Filename:       &fname,
				FormattedSize:  fmt.Sprintf("HLS Video (%d segs, %02d:%02d)", segCount, min, sec),
				AcceptRanges:   true,
				ContentType:    &ctype,
				IsHLS:          true,
				SegmentCount:   segCount,
				Duration:       dur,
				YTDLPInstalled: downloader.NewClient().IsInstalled(),
			}, nil
		}
	}

	info := &RemoteFileInfo{
		YTDLPInstalled: downloader.NewClient().IsInstalled(),
	}

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

// ProbeFileSizes concurrently probes Content-Length / Content-Range for a batch of URLs.
func ProbeFileSizes(urls []string) (map[string]int64, error) {
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
