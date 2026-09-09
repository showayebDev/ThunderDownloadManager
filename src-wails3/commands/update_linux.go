//go:build linux

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
	log.Printf("[Updater-Linux] applyUpdateAndRestart called with: %s", downloadedPath)

	if _, err := os.Stat(downloadedPath); err != nil {
		return fmt.Errorf("staged update file does not exist at %s: %w", downloadedPath, err)
	}

	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not get self executable: %w", err)
	}

	target := self

	// Check if running inside an AppImage ($APPIMAGE environment variable)
	if appimagePath := os.Getenv("APPIMAGE"); appimagePath != "" {
		target = appimagePath
	}

	// Make sure downloaded payload is executable
	_ = os.Chmod(downloadedPath, 0755)

	targetDir := filepath.Dir(target)
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

	if !isWritable {
		// Use pkexec with sh to copy and set executable permissions
		cmd := exec.Command("pkexec", "sh", "-c", fmt.Sprintf("cp -f '%s' '%s' && chmod +x '%s'", downloadedPath, target, target))
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("pkexec cp failed: %w", err)
		}
	} else {
		// Atomic replacement to prevent ETXTBSY on running binary / AppImage
		tempTarget := filepath.Join(targetDir, fmt.Sprintf(".thunderdm_upd_%d", time.Now().UnixNano()))
		input, err := os.ReadFile(downloadedPath)
		if err != nil {
			return fmt.Errorf("failed to read downloaded update: %w", err)
		}
		if err := os.WriteFile(tempTarget, input, 0755); err != nil {
			return fmt.Errorf("failed to stage updated file: %w", err)
		}
		if err := os.Rename(tempTarget, target); err != nil {
			_ = os.Remove(tempTarget)
			return fmt.Errorf("failed to atomically update target: %w", err)
		}
	}

	// Relaunch updated binary / AppImage
	cmd := exec.Command(target)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to relaunch updated application: %w", err)
	}

	// Clean up temporary files and exit
	go func() {
		time.Sleep(400 * time.Millisecond)
		CleanUpTempUpdaterFiles()
		os.Exit(0)
	}()

	return nil
}

// CleanUpTempUpdaterFiles removes temporary updater archives and staging directories on Linux
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
