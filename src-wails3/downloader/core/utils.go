package core

import (
	neturl "net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	// Invalid Windows / cross-platform filename characters
	invalidCharsRegex = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F]`)
	// Full-width lookalike characters commonly copied from social media descriptions
	fullWidthCharsRegex  = regexp.MustCompile(`[｜？：＂＜＞＊／＼]`)
	normalizeRegex       = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F_\-\s\(\)\[\]·｜？：＂＜＞＊／＼]+`)
	fbViewReactionsRegex = regexp.MustCompile(`(?i)^\s*\d+[\d\.,\s]*[KMBkmb]?\s*(views|reactions|likes|plays)\s*[·•|\-—]\s*(\d+[\d\.,\s]*[KMBkmb]?\s*(reactions|likes|views|plays)\s*[·•|\-—]\s*)?`)
)

// CleanMediaTitle cleans metadata titles extracted from social platforms (Facebook, TikTok, etc.)
// by removing view counts, reaction counts, and falling back to description/uploader if title is empty or generic.
func CleanMediaTitle(rawTitle, rawDesc, uploader string) string {
	title := strings.TrimSpace(rawTitle)
	// Remove Facebook view/reaction header like "342K views · 7.3K reactions | "
	title = fbViewReactionsRegex.ReplaceAllString(title, "")
	title = strings.TrimSpace(title)
	title = strings.TrimPrefix(title, "|")
	title = strings.TrimPrefix(title, "·")
	title = strings.TrimPrefix(title, "•")
	title = strings.TrimPrefix(title, "-")
	title = strings.TrimSpace(title)

	// If title is empty or generic ("watch", "video", "reel", "post"), try first non-empty line of description
	if title == "" || strings.EqualFold(title, "watch") || strings.EqualFold(title, "video") || strings.EqualFold(title, "reel") || strings.EqualFold(title, "post") {
		if rawDesc != "" {
			lines := strings.Split(rawDesc, "\n")
			for _, l := range lines {
				l = strings.TrimSpace(l)
				if l != "" {
					title = l
					break
				}
			}
		}
	}

	if title == "" && uploader != "" {
		title = uploader + " Video"
	}

	return strings.TrimSpace(title)
}

func cleanForMatching(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.TrimSpace(normalizeRegex.ReplaceAllString(s, " "))
}

// SanitizeFilename cleans a filename so that it is 100% valid across Windows, macOS, and Linux filesystems.
// It replaces invalid filesystem characters, typographic punctuation, and full-width lookalikes, strips trailing dots/spaces, and caps the length to 120 chars.
func SanitizeFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "download"
	}

	// Replace typographic curly quotes and dashes with safe ASCII
	replacer := strings.NewReplacer(
		"’", "'",
		"‘", "'",
		"“", "_",
		"”", "_",
		"„", "_",
		"«", "_",
		"»", "_",
		"—", "-",
		"–", "-",
		"…", "...",
	)
	filename = replacer.Replace(filename)

	// Replace full-width lookalikes with safe underscore
	filename = fullWidthCharsRegex.ReplaceAllString(filename, "_")

	// Replace invalid Windows characters (<>:"/\|?* and control codes) with safe underscore
	filename = invalidCharsRegex.ReplaceAllString(filename, "_")

	// Replace consecutive underscores
	for strings.Contains(filename, "__") {
		filename = strings.ReplaceAll(filename, "__", "_")
	}

	// Extract extension
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)

	// Clean trailing dots and spaces from base (Windows disallows filenames ending in dot or space)
	base = strings.Trim(base, ". ")
	ext = strings.Trim(ext, " ")

	if base == "" {
		base = "download"
	}

	// Ensure maximum length does not exceed 120 characters to respect Windows MAX_PATH limits
	maxBaseLen := 120 - len(ext)
	if maxBaseLen < 10 {
		maxBaseLen = 10
	}

	if utf8.RuneCountInString(base) > maxBaseLen {
		runes := []rune(base)
		if len(runes) > maxBaseLen {
			base = strings.TrimRight(string(runes[:maxBaseLen]), ". ")
		}
	}

	result := base + ext
	if result == "" || result == "." {
		return "download"
	}

	return result
}

// IsIntermediateDownloadFile checks if a file is an active partial/temporary file (.part, .ytdl, .f137.mp4, etc.)
func IsIntermediateDownloadFile(name string) bool {
	nameLower := strings.ToLower(name)
	if strings.HasSuffix(nameLower, ".part") ||
		strings.HasSuffix(nameLower, ".ytdl") ||
		strings.HasSuffix(nameLower, ".thunderdm") ||
		strings.HasSuffix(nameLower, ".temp") ||
		strings.HasSuffix(nameLower, ".tmp") ||
		strings.HasSuffix(nameLower, ".merging") ||
		strings.HasSuffix(nameLower, ".bolt.db") ||
		strings.Contains(nameLower, ".part-frag") ||
		strings.Contains(nameLower, ".temp.") {
		return true
	}
	if intermediateFormatRegex.MatchString(nameLower) {
		return true
	}
	return false
}

var intermediateFormatRegex = regexp.MustCompile(`(?i)\.f\d+\.[a-z0-9]+$|\.part-Frag\d+|\.frag\d+\.part$`)

// ResolveExistingFilePath verifies if path exists. If not, it searches the parent directory
// for a file that was trimmed, sanitized, or saved with a slightly different name.
func ResolveExistingFilePath(path string) string {
	if path == "" {
		return ""
	}
	cleanPath := filepath.Clean(path)
	if fi, err := os.Stat(cleanPath); err == nil && !fi.IsDir() {
		return cleanPath
	}

	dir := filepath.Dir(cleanPath)
	filename := filepath.Base(cleanPath)

	// If dir is relative or empty, try common user download locations
	if dir == "." || dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			defaultDirs := []string{
				filepath.Join(home, "Downloads"),
				filepath.Join(home, "Downloads", "Videos"),
				filepath.Join(home, "Downloads", "Music"),
				filepath.Join(home, "Downloads", "Programs"),
				filepath.Join(home, "Downloads", "Documents"),
				filepath.Join(home, "Downloads", "Compressed"),
				filepath.Join(home, "Downloads", "Pictures"),
			}
			for _, d := range defaultDirs {
				candidate := filepath.Join(d, filename)
				if resolved := ResolveExistingFilePath(candidate); resolved != candidate {
					return resolved
				}
			}
		}
	}

	// 1. Try directly sanitizing invalid Windows/Unix characters from filename
	sanitizedName := SanitizeFilename(filename)
	if !IsIntermediateDownloadFile(sanitizedName) {
		sanitizedPath := filepath.Join(dir, sanitizedName)
		if fi, err := os.Stat(sanitizedPath); err == nil && !fi.IsDir() {
			return sanitizedPath
		}
	}

	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	cleanBase := cleanForMatching(base)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return cleanPath
	}

	// 2. Search directory entries with robust normalized fuzzy & prefix matching
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if IsIntermediateDownloadFile(name) {
			continue
		}

		nameBase := strings.TrimSuffix(name, filepath.Ext(name))
		cleanEntryBase := cleanForMatching(nameBase)

		if cleanBase != "" && cleanEntryBase != "" {
			if cleanBase == cleanEntryBase ||
				strings.HasPrefix(cleanEntryBase, cleanBase) ||
				strings.HasPrefix(cleanBase, cleanEntryBase) ||
				(len(cleanBase) >= 8 && strings.Contains(cleanEntryBase, cleanBase)) ||
				(len(cleanEntryBase) >= 8 && strings.Contains(cleanBase, cleanEntryBase)) {
				foundPath := filepath.Join(dir, name)
				if fi, err := os.Stat(foundPath); err == nil && !fi.IsDir() {
					return foundPath
				}
			}
		}
	}

	return cleanPath
}

// DownloadExtraOptions stores parsed extended download configurations.
type DownloadExtraOptions struct {
	Protocol       string
	Quality        string
	Checksum       string
	Username       string
	Password       string
	UserAgent      string
	Referer        string
	Cookies        string
	CleanURL       string
	Category       string
	Queue          string
	ShowCompletion *bool
	ForceCookie    bool
}

// ParseDownloadOptions parses protocol strings, metadata tags, and URL credentials.
func ParseDownloadOptions(rawProto string, rawURL string) DownloadExtraOptions {
	opts := DownloadExtraOptions{
		Protocol: "Auto",
		Quality:  "best",
		CleanURL: strings.TrimSpace(rawURL),
	}

	// 1. Parse credentials or metadata from rawURL if present
	if strings.Contains(opts.CleanURL, "::") {
		parts := strings.Split(opts.CleanURL, "::")
		opts.CleanURL = parts[0]
		for _, part := range parts[1:] {
			parseOptionTag(part, &opts)
		}
	}

	// Extract standard URL User credentials (e.g. http://user:pass@host/path)
	if parsed, err := neturl.Parse(opts.CleanURL); err == nil && parsed.User != nil {
		if u := parsed.User.Username(); u != "" && opts.Username == "" {
			opts.Username = u
		}
		if p, ok := parsed.User.Password(); ok && opts.Password == "" {
			opts.Password = p
		}
	}

	// 2. Parse rawProto tags (e.g. "Auto::checksum=...::auth=...::ua=...::ref=...::cookie=...")
	if rawProto != "" {
		parts := strings.Split(rawProto, "::")
		mainProto := parts[0]
		for _, part := range parts[1:] {
			parseOptionTag(part, &opts)
		}

		if strings.Contains(mainProto, ":") {
			subParts := strings.SplitN(mainProto, ":", 2)
			opts.Protocol = subParts[0]
			opts.Quality = subParts[1]
		} else if mainProto != "" {
			opts.Protocol = mainProto
		}
	}

	return opts
}

func parseOptionTag(tag string, opts *DownloadExtraOptions) {
	if strings.HasPrefix(tag, "checksum=") {
		val := strings.TrimPrefix(tag, "checksum=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.Checksum = unescaped
		} else {
			opts.Checksum = val
		}
	} else if strings.HasPrefix(tag, "auth=") {
		val := strings.TrimPrefix(tag, "auth=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			val = unescaped
		}
		if strings.Contains(val, ":") {
			parts := strings.SplitN(val, ":", 2)
			opts.Username = parts[0]
			opts.Password = parts[1]
		} else {
			opts.Username = val
		}
	} else if strings.HasPrefix(tag, "ua=") {
		val := strings.TrimPrefix(tag, "ua=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.UserAgent = unescaped
		} else {
			opts.UserAgent = val
		}
	} else if strings.HasPrefix(tag, "ref=") {
		val := strings.TrimPrefix(tag, "ref=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.Referer = unescaped
		} else {
			opts.Referer = val
		}
	} else if strings.HasPrefix(tag, "cookie=") || strings.HasPrefix(tag, "cookies=") {
		val := strings.TrimPrefix(strings.TrimPrefix(tag, "cookies="), "cookie=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.Cookies = unescaped
		} else {
			opts.Cookies = val
		}
	} else if strings.HasPrefix(tag, "category=") {
		val := strings.TrimPrefix(tag, "category=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.Category = unescaped
		} else {
			opts.Category = val
		}
	} else if strings.HasPrefix(tag, "queue=") {
		val := strings.TrimPrefix(tag, "queue=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			opts.Queue = unescaped
		} else {
			opts.Queue = val
		}
	} else if strings.HasPrefix(tag, "proto=") || strings.HasPrefix(tag, "protocol=") {
		val := strings.TrimPrefix(strings.TrimPrefix(tag, "protocol="), "proto=")
		if unescaped, err := neturl.QueryUnescape(val); err == nil {
			val = unescaped
		}
		if strings.Contains(val, ":") {
			parts := strings.SplitN(val, ":", 2)
			opts.Protocol = parts[0]
			opts.Quality = parts[1]
		} else if val != "" {
			opts.Protocol = val
		}
	} else if strings.HasPrefix(tag, "show_completion=") || strings.HasPrefix(tag, "showCompletion=") || strings.HasPrefix(tag, "showCompletionWindow=") {
		val := strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(tag, "showCompletionWindow="), "showCompletion="), "show_completion=")
		b := val == "true" || val == "1"
		opts.ShowCompletion = &b
	} else if strings.HasPrefix(tag, "force_cookie=") || strings.HasPrefix(tag, "forceCookie=") || strings.HasPrefix(tag, "use_cookie=") || strings.HasPrefix(tag, "useCookie=") {
		val := strings.ToLower(strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(tag, "force_cookie="), "forceCookie="), "use_cookie="), "useCookie="))
		opts.ForceCookie = val == "true" || val == "1"
	}
}

// NormalizeSavePath ensures that savePath is always a valid, non-empty, absolute directory path.
// If savePath is relative (e.g. "Pictures", "Videos", "subfolder") or empty,
// it resolves against the configured DownloadPath or the user's home Downloads folder.
func NormalizeSavePath(savePath string, category ...string) string {
	savePath = strings.TrimSpace(savePath)

	// Determine the base download directory
	cfg := GetEngineConfig()
	baseDir := strings.TrimSpace(cfg.DownloadPath)
	if baseDir == "" {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			baseDir = filepath.Join(home, "Downloads")
		} else {
			baseDir = "."
		}
	}

	if savePath == "" {
		cat := ""
		if len(category) > 0 {
			cat = strings.TrimSpace(category[0])
		}
		if cat != "" && cat != "All" && cat != "Other" && cat != "None" && cfg.UseCategoryByDefault {
			if cfg.CategoryPaths != nil && cfg.CategoryPaths[cat] != "" {
				return filepath.Clean(cfg.CategoryPaths[cat])
			}
			return filepath.Clean(filepath.Join(baseDir, cat))
		}
		return filepath.Clean(baseDir)
	}

	if !filepath.IsAbs(savePath) {
		// If savePath is just a category or relative path, check if it matches a configured category path
		if cfg.CategoryPaths != nil && cfg.CategoryPaths[savePath] != "" {
			return filepath.Clean(cfg.CategoryPaths[savePath])
		}
		return filepath.Clean(filepath.Join(baseDir, savePath))
	}

	return filepath.Clean(savePath)
}

// CleanTorrentSource strips quotes, option tags (::...), and file:// schemes from local paths or URLs.
func CleanTorrentSource(source string) string {
	s := strings.TrimSpace(source)
	s = strings.Trim(s, "\"'")
	if idx := strings.Index(s, "::"); idx != -1 {
		s = s[:idx]
	}
	s = strings.TrimSpace(s)

	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "file://") {
		clean := s[7:]
		if strings.HasPrefix(clean, "/") && len(clean) > 2 && clean[2] == ':' {
			clean = clean[1:] // Clean Windows /C:/... to C:/...
		}
		return filepath.Clean(clean)
	}

	return s
}

// IsTorrentURL checks if the provided URL or file path represents a BitTorrent source (Magnet link or .torrent file).
func IsTorrentURL(urlStr string) bool {
	s := CleanTorrentSource(urlStr)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "magnet:") {
		return true
	}
	if strings.HasSuffix(lower, ".torrent") {
		return true
	}
	if strings.Contains(lower, ".torrent?") || strings.Contains(lower, ".torrent#") {
		return true
	}
	return false
}

// IsTorrentFile checks if the provided file path is a local .torrent file.
func IsTorrentFile(filePath string) bool {
	clean := CleanTorrentSource(filePath)
	if clean == "" {
		return false
	}
	return strings.EqualFold(filepath.Ext(clean), ".torrent")
}

// IsHLSURL checks if the provided URL looks like an HLS manifest.
func IsHLSURL(rawURL string) bool {
	parsed, err := neturl.Parse(rawURL)
	if err != nil {
		return false
	}
	lowerPath := strings.ToLower(parsed.Path)
	return strings.HasSuffix(lowerPath, ".m3u8") || strings.Contains(lowerPath, ".m3u8")
}

var ytdlpSupportedDomains = []string{
	"youtube.com", "youtu.be", "music.youtube.com",
	"vimeo.com", "dailymotion.com", "dai.ly",
	"tiktok.com", "douyin.com", "kuaishou.com",
	"instagram.com", "threads.net",
	"facebook.com", "fb.watch", "fb.com",
	"twitter.com", "x.com",
	"twitch.tv", "soundcloud.com", "bandcamp.com", "mixcloud.com",
	"bilibili.com", "bilibili.tv", "bilibili.co", "bili.im", "bilibili.to", "bilibili.global",
	"reddit.com", "streamable.com", "loom.com",
	"pinterest.com", "pin.it",
	"vk.com", "ok.ru", "rumble.com", "odysee.com", "bitchute.com",
	"weibo.com", "nicovideo.jp", "coub.com", "patreon.com",
	"vlive.tv", "ted.com", "archive.org",
}

// IsYTDLPURL checks if a URL belongs to video hosting platforms handled best by yt-dlp.
func IsYTDLPURL(urlStr string) bool {
	if urlStr == "" {
		return false
	}
	u, err := neturl.Parse(urlStr)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Host)
	if host == "" {
		return false
	}

	for _, d := range ytdlpSupportedDomains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}

	// Match common video paths on media/streaming hosts
	path := strings.ToLower(u.Path)
	hasVideoPath := strings.Contains(path, "/video/") ||
		strings.Contains(path, "/videos/") ||
		strings.Contains(path, "/shorts/") ||
		strings.Contains(path, "/reel/") ||
		strings.Contains(path, "/reels/") ||
		strings.Contains(path, "/watch") ||
		strings.Contains(path, "/bangumi/") ||
		strings.Contains(path, "/clip/")

	if hasVideoPath {
		hasMediaHost := strings.Contains(host, "bilibili") ||
			strings.Contains(host, "video") ||
			strings.Contains(host, "stream") ||
			strings.Contains(host, "media") ||
			strings.Contains(host, "tube") ||
			strings.Contains(host, "tv")
		if hasMediaHost {
			return true
		}
	}

	return false
}

// ExtractYTDLPFallbackFilename generates a clean, readable fallback filename from any video URL.
func ExtractYTDLPFallbackFilename(rawURL string) string {
	parsed, err := neturl.Parse(rawURL)
	if err != nil {
		return "video.mp4"
	}
	q := parsed.Query()
	if v := q.Get("v"); v != "" {
		return SanitizeFilename(v + ".mp4")
	}
	cleanPath := strings.Trim(strings.ReplaceAll(parsed.Path, "\\", "/"), "/")
	parts := strings.Split(cleanPath, "/")

	host := strings.ToLower(parsed.Host)
	for i, p := range parts {
		lowerP := strings.ToLower(p)
		isMediaSegmentPrefix := lowerP == "p" ||
			lowerP == "reel" ||
			lowerP == "reels" ||
			lowerP == "tv" ||
			lowerP == "shorts" ||
			lowerP == "video" ||
			lowerP == "videos" ||
			lowerP == "status" ||
			lowerP == "clip" ||
			lowerP == "watch"

		if isMediaSegmentPrefix && i+1 < len(parts) {
			candidate := parts[i+1]
			if candidate != "" && candidate != "watch" && candidate != "video" && candidate != "index" {
				candidate = strings.TrimSuffix(candidate, ".html")
				candidate = strings.TrimSuffix(candidate, ".htm")
				switch {
				case strings.Contains(host, "instagram"):
					return SanitizeFilename("Instagram_" + candidate + ".mp4")
				case strings.Contains(host, "tiktok"):
					return SanitizeFilename("TikTok_" + candidate + ".mp4")
				case strings.Contains(host, "twitter") || strings.Contains(host, "x.com"):
					return SanitizeFilename("Twitter_" + candidate + ".mp4")
				default:
					return SanitizeFilename(candidate + ".mp4")
				}
			}
		}
	}

	last := ""
	if len(parts) > 0 {
		last = parts[len(parts)-1]
	}
	if last != "" && last != "watch" && last != "video" && last != "index" && last != "default" && last != "reel" && last != "reels" && last != "p" {
		last = strings.TrimSuffix(last, ".html")
		last = strings.TrimSuffix(last, ".htm")
		if !strings.Contains(last, ".") {
			last += ".mp4"
		}
		return SanitizeFilename(last)
	}

	if host != "" {
		hostClean := SanitizeFilename(host)
		return hostClean + "_video.mp4"
	}

	return "video.mp4"
}

// IsCookieBrokenHost checks if passing raw header cookies (--add-header "Cookie: ...") is bypassed for the host in yt-dlp.
func IsCookieBrokenHost(uStr string) bool {
	return ShouldBypassCookies(uStr, "ytdlp")
}
