package utils

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var (
	normalizeRegex = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F_\-\s\(\)\[\]·｜？：＂＜＞＊／＼]+`)
	invalidChars   = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F]`)
)

func cleanForMatching(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.TrimSpace(normalizeRegex.ReplaceAllString(s, " "))
}

// ResolveExistingFilePath verifies if path exists. If not, it searches the directory
// for a file that was trimmed, sanitized, or saved with a slightly different name.
func ResolveExistingFilePath(path string) string {
	if path == "" {
		return ""
	}
	cleanPath := filepath.Clean(path)
	if fi, err := os.Stat(cleanPath); err == nil && !fi.IsDir() {
		return cleanPath
	}

	// If path is relative, try resolving against user's home Downloads folder
	if !filepath.IsAbs(cleanPath) {
		if home, err := os.UserHomeDir(); err == nil {
			cand := filepath.Join(home, "Downloads", cleanPath)
			if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
				return cand
			}
			if resolved := ResolveExistingFilePath(cand); resolved != cand && resolved != "" {
				if fi, err := os.Stat(resolved); err == nil && !fi.IsDir() {
					return resolved
				}
			}
		}
	}

	dir := filepath.Dir(cleanPath)
	filename := filepath.Base(cleanPath)

	// If dir is relative or empty, try common user download locations
	if dir == "." || dir == "" || !filepath.IsAbs(dir) {
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
				if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
					return candidate
				}
			}
		}
	}

	// 1. Try directly sanitizing invalid Windows/Unix characters from filename
	sanitizedName := invalidChars.ReplaceAllString(filename, "_")
	for strings.Contains(sanitizedName, "__") {
		sanitizedName = strings.ReplaceAll(sanitizedName, "__", "_")
	}
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

// OpenExplorerAndSelect opens the file explorer and selects the file at the given path
func OpenExplorerAndSelect(path string) error {
	if path == "" {
		return nil
	}
	cleanPath := ResolveExistingFilePath(path)
	if runtime.GOOS == "windows" {
		if fi, err := os.Stat(cleanPath); err == nil {
			if fi.IsDir() {
				cmd := exec.Command("explorer", cleanPath)
				return cmd.Start()
			}
			cmd := exec.Command("explorer", "/select,", cleanPath)
			return cmd.Start()
		}
		// If file doesn't exist, open parent folder
		dir := filepath.Dir(cleanPath)
		if _, err := os.Stat(dir); err == nil {
			cmd := exec.Command("explorer", dir)
			return cmd.Start()
		}
		cmd := exec.Command("explorer", cleanPath)
		return cmd.Start()
	} else if runtime.GOOS == "darwin" {
		if fi, err := os.Stat(cleanPath); err == nil && !fi.IsDir() {
			return exec.Command("open", "-R", cleanPath).Start()
		}
		return exec.Command("open", cleanPath).Start()
	} else {
		dir := cleanPath
		if fi, err := os.Stat(cleanPath); err == nil && !fi.IsDir() {
			dir = filepath.Dir(cleanPath)
		}
		return exec.Command("xdg-open", dir).Start()
	}
}
