package main

import (
	"log"
	"strings"

	"ThunderDM/src-wails3/commands"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// initAppUpdater configures and registers the GitHub release updater for the Wails application.
func initAppUpdater(app *application.App) {
	ghProvider, err := github.New(github.Config{
		Repository:   "showayebDev/ThunderDownloadManager",
		Prerelease:   false,
		AssetMatcher: matchReleaseAsset,
	})
	if err != nil {
		log.Printf("[Main] Failed to create GitHub updater provider: %v", err)
		return
	}

	err = app.Updater.Init(updater.Config{
		CurrentVersion: commands.AppVersion,
		Providers: []updater.Provider{
			ghProvider,
		},
	})
	if err != nil {
		log.Printf("[Main] Failed to initialize App Updater: %v", err)
		return
	}

	log.Printf("[Main] App Updater initialized successfully (Repo: showayebDev/ThunderDownloadManager, Version: %s)", commands.AppVersion)
}

// isIgnoredReleaseAsset checks if a release asset is a signature, checksum, documentation, or browser extension file.
func isIgnoredReleaseAsset(name string) bool {
	return strings.HasSuffix(name, ".sig") ||
		strings.HasSuffix(name, ".asc") ||
		strings.HasSuffix(name, ".sha256") ||
		strings.HasSuffix(name, ".sums") ||
		strings.HasSuffix(name, ".txt") ||
		strings.HasSuffix(name, ".md") ||
		strings.Contains(name, "extension") ||
		strings.HasSuffix(name, ".xpi") ||
		strings.HasSuffix(name, ".crx")
}

// matchReleaseAsset selects the most appropriate GitHub release binary for the current OS platform.
func matchReleaseAsset(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	plat := strings.ToLower(req.Platform) // "windows", "darwin", "linux"

	// 1. Primary platform-specific matches
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if isIgnoredReleaseAsset(name) {
			continue
		}

		switch plat {
		case "windows":
			if strings.Contains(name, "mac") || strings.Contains(name, "darwin") || strings.Contains(name, "linux") ||
				strings.HasSuffix(name, ".deb") || strings.HasSuffix(name, ".rpm") || strings.HasSuffix(name, ".dmg") {
				continue
			}
			if strings.HasSuffix(name, ".exe") && (strings.Contains(name, "universal") || strings.Contains(name, "windows") || strings.Contains(name, "win") || strings.Contains(name, "setup")) {
				return i
			}
		case "darwin":
			if strings.Contains(name, "windows") || strings.Contains(name, "linux") || strings.HasSuffix(name, ".exe") ||
				strings.HasSuffix(name, ".deb") || strings.HasSuffix(name, ".rpm") {
				continue
			}
			if strings.HasSuffix(name, ".zip") && (strings.Contains(name, "mac") || strings.Contains(name, "darwin") || strings.Contains(name, "apple") || strings.Contains(name, "universal")) {
				return i
			}
			if strings.HasSuffix(name, ".dmg") {
				return i
			}
		case "linux":
			if strings.Contains(name, "windows") || strings.Contains(name, "mac") || strings.Contains(name, "darwin") ||
				strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".dmg") {
				continue
			}
			if strings.HasSuffix(name, ".appimage") || strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") {
				return i
			}
		}
	}

	// 2. Secondary fallback matching
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if isIgnoredReleaseAsset(name) {
			continue
		}

		if plat == "windows" && (strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".zip")) {
			return i
		} else if plat == "darwin" && (strings.HasSuffix(name, ".zip") || strings.HasSuffix(name, ".dmg") || strings.Contains(name, "mac") || strings.Contains(name, "darwin")) {
			return i
		} else if plat == "linux" && (strings.HasSuffix(name, ".appimage") || strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") || strings.Contains(name, "linux")) {
			return i
		}
	}

	// 3. Final fallback: first non-ignored asset
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if !isIgnoredReleaseAsset(name) {
			return i
		}
	}

	return -1
}
