package downloader

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
// It removes invalid characters, emojis/corrupt unicode lookalikes, strips trailing dots/spaces, and caps the length to 120 chars.
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
	sanitizedPath := filepath.Join(dir, sanitizedName)
	if fi, err := os.Stat(sanitizedPath); err == nil && !fi.IsDir() {
		return sanitizedPath
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
		nameLower := strings.ToLower(name)
		if strings.HasSuffix(nameLower, ".part") ||
			strings.HasSuffix(nameLower, ".ytdl") ||
			strings.HasSuffix(nameLower, ".thunderdm") ||
			strings.HasSuffix(nameLower, ".temp") ||
			strings.HasSuffix(nameLower, ".tmp") ||
			strings.HasSuffix(nameLower, ".merging") {
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
	ShowCompletion *bool
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
	} else if strings.HasPrefix(tag, "show_completion=") || strings.HasPrefix(tag, "showCompletion=") || strings.HasPrefix(tag, "showCompletionWindow=") {
		val := strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(tag, "showCompletionWindow="), "showCompletion="), "show_completion=")
		b := val == "true" || val == "1"
		opts.ShowCompletion = &b
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

