//go:build windows

package commands

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func applyUpdateAndRestart(downloadedPath string) error {
	log.Printf("[Updater] applyUpdateAndRestart called with: %s", downloadedPath)

	if _, err := os.Stat(downloadedPath); err != nil {
		return fmt.Errorf("staged update file does not exist at %s: %w", downloadedPath, err)
	}

	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not get self executable: %w", err)
	}

	lowerDl := strings.ToLower(filepath.Base(downloadedPath))
	isInstaller := strings.Contains(lowerDl, "setup") ||
		strings.Contains(lowerDl, "installer") ||
		strings.Contains(lowerDl, "universal") ||
		strings.Contains(lowerDl, "windows") ||
		strings.HasPrefix(lowerDl, "install") ||
		(strings.HasSuffix(lowerDl, ".exe") && !strings.EqualFold(filepath.Base(downloadedPath), filepath.Base(self)))

	if isInstaller {
		// Copy installer to a fixed, clean temp file
		tempInstaller := filepath.Join(os.TempDir(), "ThunderDM-Setup-Update.exe")
		_ = os.Remove(tempInstaller)

		input, err := os.ReadFile(downloadedPath)
		if err == nil && len(input) > 0 {
			if err := os.WriteFile(tempInstaller, input, 0755); err == nil {
				downloadedPath = tempInstaller
			}
		}

		log.Printf("[Updater] Spawning detached installer watcher: %s", downloadedPath)

		// Create a launcher batch watcher that waits for old app to close, runs installer, relaunches updated app, then self-deletes
		launcherBat := filepath.Join(os.TempDir(), "thunderdm_launch_update.bat")
		batContent := fmt.Sprintf(`@echo off
timeout /t 1 /nobreak >nul
start /wait "" "%s"
start "" "%s"
:retry
timeout /t 1 /nobreak >nul
del /f /q "%s" >nul 2>&1
if exist "%s" goto retry
(goto) 2>nul & del /f /q "%%%%~f0"
`, downloadedPath, self, downloadedPath, downloadedPath)
		_ = os.WriteFile(launcherBat, []byte(batContent), 0644)

		// Launch the launcher batch file detached in background with no console window
		cmd := exec.Command("cmd.exe", "/c", launcherBat)
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: 0x08000000 | windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
			HideWindow:    true,
		}
		if err := cmd.Start(); err != nil {
			// Fallback to direct ShellExecute
			verbPtr := windows.StringToUTF16Ptr("open")
			filePtr := windows.StringToUTF16Ptr(downloadedPath)
			_ = windows.ShellExecute(0, verbPtr, filePtr, nil, nil, windows.SW_SHOWNORMAL)
		}

		// Cleanly exit current application so files are freed
		go func() {
			time.Sleep(300 * time.Millisecond)
			log.Println("[Updater] Exiting current application for installer...")
			os.Exit(0)
		}()
		return nil
	}

	// Case 2: Standalone binary or extracted update payload
	targetDir := filepath.Dir(self)
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

	scriptPath := filepath.Join(os.TempDir(), fmt.Sprintf("thunderdm_swap_%d.bat", os.Getpid()))
	scriptContent := fmt.Sprintf(`@echo off
timeout /t 1 /nobreak >nul
copy /y "%s" "%s"
start "" "%s"
:retry
timeout /t 1 /nobreak >nul
del /f /q "%s" >nul 2>&1
if exist "%s" goto retry
(goto) 2>nul & del /f /q "%%%%~f0"
`, downloadedPath, self, self, downloadedPath, downloadedPath)
	if err := os.WriteFile(scriptPath, []byte(scriptContent), 0644); err != nil {
		return fmt.Errorf("failed to write update script: %w", err)
	}

	if !isWritable || strings.Contains(strings.ToLower(self), "program files") {
		verbPtr := windows.StringToUTF16Ptr("runas")
		cmdPtr := windows.StringToUTF16Ptr("cmd.exe")
		argsPtr := windows.StringToUTF16Ptr(fmt.Sprintf(`/c "%s"`, scriptPath))
		_ = windows.ShellExecute(0, verbPtr, cmdPtr, argsPtr, nil, windows.SW_HIDE)
	} else {
		cmd := exec.Command("cmd.exe", "/c", scriptPath)
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: 0x08000000 | windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
			HideWindow:    true,
		}
		_ = cmd.Start()
	}

	go func() {
		time.Sleep(300 * time.Millisecond)
		os.Exit(0)
	}()
	return nil
}

// CleanUpTempUpdaterFiles cleans leftover update files from %TEMP%
func CleanUpTempUpdaterFiles() {
	go func() {
		// Periodically retry cleanup over 10 seconds to catch installer exit
		for i := 0; i < 5; i++ {
			time.Sleep(2 * time.Second)
			tempDir := os.TempDir()
			_ = os.Remove(filepath.Join(tempDir, "ThunderDM-Setup-Update.exe"))
			_ = os.Remove(filepath.Join(tempDir, "thunderdm_launch_update.bat"))

			entries, err := os.ReadDir(tempDir)
			if err == nil {
				for _, e := range entries {
					name := strings.ToLower(e.Name())
					if strings.HasPrefix(name, "thunderdm_") && strings.HasSuffix(name, ".bat") {
						_ = os.Remove(filepath.Join(tempDir, e.Name()))
					}
					if strings.HasPrefix(name, "wails-update-") && e.IsDir() {
						_ = os.RemoveAll(filepath.Join(tempDir, e.Name()))
					}
				}
			}
		}
	}()
}

func init() {
	CleanUpTempUpdaterFiles()
}
