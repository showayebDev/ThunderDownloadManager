package downloader

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
)

// GetAppStorageDir returns the OS-standard local application data directory for ThunderDM.
// On Windows: %APPDATA%\ThunderDM
// On macOS:   ~/Library/Application Support/ThunderDM
// On Linux:   ~/.config/ThunderDM (or $XDG_CONFIG_HOME/ThunderDM)
func GetAppStorageDir() string {
	configDir, err := os.UserConfigDir()
	if err == nil && configDir != "" {
		appDir := filepath.Join(configDir, "ThunderDM")
		_ = os.MkdirAll(appDir, 0755)
		return appDir
	}

	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		appDir := filepath.Join(home, ".thunderdm")
		_ = os.MkdirAll(appDir, 0755)
		return appDir
	}

	appDir := filepath.Join(os.TempDir(), "ThunderDM")
	_ = os.MkdirAll(appDir, 0755)
	return appDir
}

// GetTaskMetaDir returns the dedicated directory inside local app storage for task metadata checkpoints.
func GetTaskMetaDir() string {
	tasksDir := filepath.Join(GetAppStorageDir(), "tasks")
	_ = os.MkdirAll(tasksDir, 0755)
	return tasksDir
}

// GetTaskMetaFilePath returns the primary metadata checkpoint path for a given task ID.
func GetTaskMetaFilePath(taskID string) string {
	return filepath.Join(GetTaskMetaDir(), fmt.Sprintf("%s.meta", taskID))
}

// GetTaskMetaPathByDest returns the secondary/hash metadata checkpoint path for a destination file path.
func GetTaskMetaPathByDest(destFilePath string) string {
	if destFilePath == "" {
		return ""
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(filepath.Clean(destFilePath))))
	return filepath.Join(GetTaskMetaDir(), fmt.Sprintf("path_%s.meta", hash))
}
