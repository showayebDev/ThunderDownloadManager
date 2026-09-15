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
	normalizeRegex = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F_\-\.\+\s\(\)\[\]·｜？：＂＜＞＊／＼]+`)
	invalidChars   = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F]`)
)

func cleanForMatching(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.TrimSpace(normalizeRegex.ReplaceAllString(s, " "))
}

// GetDirSize computes the total size in bytes of all regular files in a directory recursively.
func GetDirSize(path string) int64 {
	var total int64
	_ = filepath.Walk(path, func(_ string, fi os.FileInfo, err error) error {
		if err == nil && fi != nil && !fi.IsDir() {
			total += fi.Size()
		}
		return nil
	})
	return total
}

// ResolveExistingFilePath verifies if path exists. If not, it searches the directory
// and category locations for a file or folder that was trimmed, sanitized, or saved with a slightly different name.
func ResolveExistingFilePath(path string) string {
	if path == "" {
		return ""
	}
	cleanPath := filepath.Clean(path)
	if _, err := os.Stat(cleanPath); err == nil {
		return cleanPath
	}

	// If path is relative, try resolving against user's home Downloads folder and subcategories
	if !filepath.IsAbs(cleanPath) {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			homeDownloads := filepath.Join(home, "Downloads")
			cand := filepath.Join(homeDownloads, cleanPath)
			if _, err := os.Stat(cand); err == nil {
				return cand
			}
			if resolved := ResolveExistingFilePath(cand); resolved != cand && resolved != "" {
				if _, err := os.Stat(resolved); err == nil {
					return resolved
				}
			}
		}
	}

	dir := filepath.Dir(cleanPath)
	filename := filepath.Base(cleanPath)

	standardCategories := []string{"Torrents", "Videos", "Music", "Programs", "Documents", "Compressed", "Pictures"}

	// 1. Try directly sanitizing invalid Windows/Unix characters from filename
	sanitizedName := invalidChars.ReplaceAllString(filename, "_")
	for strings.Contains(sanitizedName, "__") {
		sanitizedName = strings.ReplaceAll(sanitizedName, "__", "_")
	}

	// Build comprehensive list of directories to search
	var searchDirs []string
	seenDirs := make(map[string]bool)
	addDir := func(d string) {
		if d == "" || d == "." {
			return
		}
		clean := filepath.Clean(d)
		if !seenDirs[strings.ToLower(clean)] {
			seenDirs[strings.ToLower(clean)] = true
			searchDirs = append(searchDirs, clean)
		}
	}

	addDir(dir)

	if filepath.IsAbs(dir) {
		for _, cat := range standardCategories {
			addDir(filepath.Join(dir, cat))
		}
		isCatSubdir := false
		for _, cat := range standardCategories {
			if strings.EqualFold(filepath.Base(dir), cat) {
				isCatSubdir = true
				break
			}
		}
		if isCatSubdir {
			parentDir := filepath.Dir(dir)
			addDir(parentDir)
			for _, cat := range standardCategories {
				addDir(filepath.Join(parentDir, cat))
			}
		}
	}

	if home, err := os.UserHomeDir(); err == nil && home != "" {
		homeDownloads := filepath.Join(home, "Downloads")
		addDir(homeDownloads)
		for _, cat := range standardCategories {
			addDir(filepath.Join(homeDownloads, cat))
		}
	}

	// Step 1: Direct exact and sanitized candidate lookup across all candidate directories
	for _, d := range searchDirs {
		cand := filepath.Join(d, filename)
		if _, err := os.Stat(cand); err == nil {
			return cand
		}
		if sanitizedName != filename {
			candSan := filepath.Join(d, sanitizedName)
			if _, err := os.Stat(candSan); err == nil {
				return candSan
			}
		}
	}

	// Step 2: Search directory entries with robust normalized fuzzy & prefix matching
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	cleanBase := cleanForMatching(base)

	for _, d := range searchDirs {
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			name := entry.Name()
			nameLower := strings.ToLower(name)
			if strings.HasSuffix(nameLower, ".part") ||
				strings.HasSuffix(nameLower, ".ytdl") ||
				strings.HasSuffix(nameLower, ".thunderdm") ||
				strings.HasSuffix(nameLower, ".temp") ||
				strings.HasSuffix(nameLower, ".tmp") ||
				strings.HasSuffix(nameLower, ".merging") ||
				strings.HasSuffix(nameLower, ".bolt.db") {
				continue
			}

			nameBase := strings.TrimSuffix(name, filepath.Ext(name))
			cleanEntryBase := cleanForMatching(nameBase)

			if cleanBase != "" && cleanEntryBase != "" {
				if cleanBase == cleanEntryBase ||
					strings.HasPrefix(cleanEntryBase, cleanBase) ||
					strings.HasPrefix(cleanBase, cleanEntryBase) ||
					(len(cleanBase) >= 6 && strings.Contains(cleanEntryBase, cleanBase)) ||
					(len(cleanEntryBase) >= 6 && strings.Contains(cleanBase, cleanEntryBase)) {
					foundPath := filepath.Join(d, name)
					if _, err := os.Stat(foundPath); err == nil {
						return foundPath
					}
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
