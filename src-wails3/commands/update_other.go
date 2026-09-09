//go:build !windows && !darwin && !linux

package commands

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func applyUpdateAndRestart(downloadedPath string) error {
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not get self executable: %w", err)
	}

	if err := os.Rename(downloadedPath, self); err != nil {
		input, err := os.ReadFile(downloadedPath)
		if err != nil {
			return err
		}
		if err := os.WriteFile(self, input, 0755); err != nil {
			return err
		}
	}

	cmd := exec.Command(self)
	if err := cmd.Start(); err != nil {
		return err
	}

	go func() {
		time.Sleep(500 * time.Millisecond)
		CleanUpTempUpdaterFiles()
		os.Exit(0)
	}()
	return nil
}

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
