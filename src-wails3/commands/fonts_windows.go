//go:build windows

package commands

import (
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/sys/windows/registry"
)

var parentheticalRegex = regexp.MustCompile(`\s*\([^)]*\)`)
var styleSuffixes = []string{
	" extra bold italic", " extrabold italic", " extra-bold italic",
	" extra light italic", " extralight italic", " extra-light italic",
	" semi bold italic", " semibold italic", " semi-bold italic",
	" semi light italic", " semilight italic", " semi-light italic",
	" ultra bold italic", " ultrabold italic",
	" ultra light italic", " ultralight italic",
	" bold italic", " italic bold", " bold oblique", " oblique bold",
	" medium italic", " light italic", " black italic", " heavy italic",
	" thin italic", " book italic",
	" extra bold", " extrabold", " extra-bold",
	" extra light", " extralight", " extra-light",
	" semi bold", " semibold", " semi-bold",
	" semi light", " semilight", " semi-light",
	" ultra bold", " ultrabold",
	" ultra light", " ultralight",
	" bold", " italic", " oblique",
	" regular", " normal", " plain", " standard",
	" light", " medium", " black", " heavy", " thin", " book", " demi",
}

// Known non-English / symbol font name fragments (lowercase) to exclude
var nonEnglishFontSubstrings = []string{
	"simsun", "simhei", "mingliu", "pmingliu", "ms gothic", "ms pgothic", "ms ui gothic",
	"ms mincho", "ms pmincho", "malgun", "meiryo", "yu gothic", "yu mincho",
	"batang", "dotum", "gulim", "gungsuh", "fangsong", "kaiti", "dengxian",
	"dfkai-sb", "heiti", "stheiti", "stkaiti", "stsong", "stfangsong",
	"jhenghei", "yahei", "leelawadee", "khmer", "lao", "myanmar", "tibetan",
	"devanagari", "bengali", "gujarati", "gurmukhi", "kannada", "malayalam",
	"oriya", "sinhala", "tamil", "telugu", "thaana", "thai", "hebrew",
	"arabic", "syriac", "marlett", "webdings", "wingdings", "symbol", "mt extra",
	"holomdl2",
}

func isEnglishFontName(name string) bool {
	if len(name) < 2 {
		return false
	}
	// Vertical fonts in Windows start with @
	if strings.HasPrefix(name, "@") {
		return false
	}
	// Reject fonts with non-ASCII or unprintable characters
	for _, r := range name {
		if r > 127 || unicode.IsControl(r) {
			return false
		}
	}
	// Check against non-English / symbol substrings
	nameLower := strings.ToLower(name)
	for _, sub := range nonEnglishFontSubstrings {
		if strings.Contains(nameLower, sub) {
			return false
		}
	}
	return true
}

func cleanFontName(raw string) string {
	// Strip parenthetical descriptors like (TrueType), (OpenType), (All res), etc.
	name := parentheticalRegex.ReplaceAllString(raw, "")
	name = strings.TrimSpace(name)

	// If contains '&', e.g. "Segoe UI & Segoe UI Bold", take the main font
	if idx := strings.Index(name, "&"); idx != -1 {
		name = strings.TrimSpace(name[:idx])
	}

	// Remove common style suffixes repeatedly
	cleaned := name
	for {
		modified := false
		lower := strings.ToLower(cleaned)
		for _, suffix := range styleSuffixes {
			if strings.HasSuffix(lower, suffix) {
				cleaned = strings.TrimSpace(cleaned[:len(cleaned)-len(suffix)])
				modified = true
				break
			}
		}
		if !modified {
			break
		}
	}

	cleaned = strings.Trim(cleaned, " -_")
	return cleaned
}

func getSystemFontsOS() []string {
	fontMap := make(map[string]bool)

	keys := []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`},
		{registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`},
	}

	for _, kInfo := range keys {
		k, err := registry.OpenKey(kInfo.root, kInfo.path, registry.READ)
		if err != nil {
			continue
		}
		names, err := k.ReadValueNames(-1)
		k.Close()
		if err != nil {
			continue
		}

		for _, rawName := range names {
			cleaned := cleanFontName(rawName)
			if cleaned != "" && isEnglishFontName(cleaned) {
				fontMap[cleaned] = true
			}
		}
	}

	// Fallback standard fonts if registry returned no English fonts
	standardEnglishFonts := []string{
		"Arial", "Calibri", "Cambria", "Candara", "Cascadia Code", "Cascadia Mono",
		"Century Gothic", "Comic Sans MS", "Consolas", "Constantia", "Corbel",
		"Courier New", "Franklin Gothic Medium", "Gabriola", "Georgia", "Helvetica",
		"Impact", "Inter", "Lucida Console", "Lucida Sans Unicode", "Palatino Linotype",
		"Roboto", "Segoe Print", "Segoe Script", "Segoe UI", "Segoe UI Variable",
		"Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
	}

	if len(fontMap) == 0 {
		for _, sf := range standardEnglishFonts {
			fontMap[sf] = true
		}
	}

	fonts := make([]string, 0, len(fontMap)+1)
	for f := range fontMap {
		fonts = append(fonts, f)
	}

	sort.Slice(fonts, func(i, j int) bool {
		return strings.ToLower(fonts[i]) < strings.ToLower(fonts[j])
	})

	// Prepend "Default"
	result := append([]string{"Default"}, fonts...)
	return result
}
