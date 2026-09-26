// Package crawler implements recursive directory and webpage link scraping
// (CrawlPageLinks), HTML/JSON directory parsing, and file extension category classification.
package crawler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ThunderDM/src-wails3/downloader"
)

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

// DetectCategoryByExt classifies a filename into its download category by extension.
func DetectCategoryByExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != "" {
		ext = strings.TrimPrefix(ext, ".")
	}
	switch ext {
	case "mp4", "mkv", "avi", "mov", "webm", "ts", "m4v", "flv", "m3u8", "3gp", "wmv", "mpg", "mpeg", "vob", "ogv":
		return "Videos"
	case "zip", "rar", "7z", "tar", "gz", "iso", "bz2", "xz", "tgz", "zipx", "7zip", "zst", "lzma", "cab", "arj", "lzh", "ace", "uue", "bz", "tbz", "tbz2", "txz", "wim", "r00", "r01", "r02", "part1":
		return "Compressed"
	case "exe", "msi", "dmg", "deb", "rpm", "apk", "bin", "app", "bat", "cmd", "sh", "jar", "run", "appimage", "pkg":
		return "Programs"
	case "mp3", "flac", "wav", "aac", "ogg", "m4a", "opus", "wma", "alac", "aiff", "mid", "midi", "mka", "ape":
		return "Music"
	case "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico", "tiff", "avif", "heic", "psd", "ai", "raw", "cr2", "nef":
		return "Pictures"
	case "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "txt", "csv", "srt", "sub", "nfo", "md", "epub", "rtf", "odt", "ods", "odp", "pages", "numbers", "key", "vtt", "log":
		return "Documents"
	case "torrent":
		return "Torrents"
	default:
		lower := strings.ToLower(filename)
		if strings.Contains(lower, ".rar") || strings.Contains(lower, ".zip") || strings.Contains(lower, ".7z") || strings.Contains(lower, ".tar.gz") {
			return "Compressed"
		}
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
		if DetectCategoryByExt(baseName) != "Other" || isCommonFileExt(extClean) {
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

// CrawlPageLinks recursively scrapes downloadable file links from an HTML or JSON directory listing.
func CrawlPageLinks(rawPayload string) ([]ScrapedFileLink, error) {
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
										Category:  DetectCategoryByExt(linkName),
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
					cat := DetectCategoryByExt(baseName)

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
