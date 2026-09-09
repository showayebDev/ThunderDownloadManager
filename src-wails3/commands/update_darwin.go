//go:build darwin

package commands

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func applyUpdateAndRestart(downloadedPath string) error {
	log.Printf("[Updater-Darwin] applyUpdateAndRestart called with: %s", downloadedPath)

	if _, err := os.Stat(downloadedPath); err != nil {
		return fmt.Errorf("staged update file does not exist at %s: %w", downloadedPath, err)
	}

	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not get self executable: %w", err)
	}

	// Resolve macOS .app bundle path if running inside a bundle
	appBundle := self
	for {
		if strings.HasSuffix(appBundle, ".app") {
			break
		}
		parent := filepath.Dir(appBundle)
		if parent == appBundle || parent == "/" || parent == "." {
			appBundle = self
			break
		}
		appBundle = parent
	}

	lowerDl := strings.ToLower(filepath.Base(downloadedPath))

	// If downloaded update is a .dmg, open the disk image for user
	if strings.HasSuffix(lowerDl, ".dmg") {
		log.Printf("[Updater-Darwin] Opening DMG installer: %s", downloadedPath)
		_ = exec.Command("open", downloadedPath).Start()
		go func() {
			time.Sleep(500 * time.Millisecond)
			os.Exit(0)
		}()
		return nil
	}

	// Locate .app in downloaded path if unpacked
	newApp := downloadedPath
	if fi, err := os.Stat(downloadedPath); err == nil && fi.IsDir() {
		if !strings.HasSuffix(newApp, ".app") {
			// Search for .app inside directory
			entries, _ := os.ReadDir(downloadedPath)
			for _, e := range entries {
				if strings.HasSuffix(e.Name(), ".app") {
					newApp = filepath.Join(downloadedPath, e.Name())
					break
				}
			}
		}
	}

	targetDir := filepath.Dir(appBundle)
	isWritable := func(dir string) bool {
		testFile := filepath.Join(dir, fmt.Sprintf(".test_perm_%d", time.Now().UnixNano()))
		f, err := os.Create(testFile)
		if err != nil {
			return false
		}
		_ = f.Close()
		_ = os.Remove(testFile)
		return true
	}(targetDir)

	if strings.HasSuffix(appBundle, ".app") && strings.HasSuffix(newApp, ".app") {
		if !isWritable {
			// Elevated replacement using AppleScript with administrator privileges & quarantine removal
			script := fmt.Sprintf(`do shell script "rm -rf '%s' && cp -R '%s' '%s' && xattr -dr com.apple.quarantine '%s' 2>/dev/null || true" with administrator privileges`, appBundle, newApp, appBundle, appBundle)
			cmd := exec.Command("osascript", "-e", script)
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("failed to replace application with admin privileges: %w", err)
			}
		} else {
			_ = exec.Command("rm", "-rf", appBundle).Run()
			if err := exec.Command("cp", "-R", newApp, appBundle).Run(); err != nil {
				return fmt.Errorf("failed to copy new app bundle: %w", err)
			}
			_ = exec.Command("xattr", "-dr", "com.apple.quarantine", appBundle).Run()
		}

		// Relaunch the application bundle
		_ = exec.Command("open", "-n", appBundle).Start()
	} else {
		// Single binary replacement
		_ = os.Chmod(downloadedPath, 0755)
		if !isWritable {
			script := fmt.Sprintf(`do shell script "cp '%s' '%s' && chmod +x '%s' && xattr -d com.apple.quarantine '%s' 2>/dev/null || true" with administrator privileges`, downloadedPath, self, self, self)
			_ = exec.Command("osascript", "-e", script).Run()
		} else {
			input, err := os.ReadFile(downloadedPath)
			if err == nil {
				_ = os.WriteFile(self, input, 0755)
			}
			_ = exec.Command("xattr", "-d", "com.apple.quarantine", self).Run()
		}
		_ = exec.Command(self).Start()
	}

	// Clean up temporary downloaded files
	go func() {
		time.Sleep(400 * time.Millisecond)
		CleanUpTempUpdaterFiles()
		os.Exit(0)
	}()

	return nil
}

// CleanUpTempUpdaterFiles removes temporary updater archives and staging directories on macOS
func CleanUpTempUpdaterFiles() {
	tempDir := os.TempDir()
	entries, err := os.ReadDir(tempDir)
	if err == nil {
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if strings.HasPrefix(name, "thunderdm_") || strings.HasPrefix(name, "wails-update-") {
				_ = os.RemoveAll(filepath.Join(tempDir, e.Name()))
			}
		}
	}
}

func init() {
	go CleanUpTempUpdaterFiles()
}
