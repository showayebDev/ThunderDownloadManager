//go:build linux

package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

const linuxDesktopFileName = "thunderdm.desktop"

func getLinuxAutostartPath() (string, error) {
	configDir := os.Getenv("XDG_CONFIG_HOME")
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		configDir = filepath.Join(home, ".config")
	}
	return filepath.Join(configDir, "autostart", linuxDesktopFileName), nil
}

func isLaunchOnStartupEnabled() (bool, error) {
	desktopPath, err := getLinuxAutostartPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(desktopPath)
	return err == nil, nil
}

func setLaunchOnStartup(enabled bool) error {
	desktopPath, err := getLinuxAutostartPath()
	if err != nil {
		return err
	}

	if !enabled {
		dir := filepath.Dir(desktopPath)
		for _, name := range []string{"thunderdm.desktop", "ThunderDownloadManager.desktop", "ThunderDM.desktop"} {
			_ = os.Remove(filepath.Join(dir, name))
		}
		return nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	dir := filepath.Dir(desktopPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	content := fmt.Sprintf(`[Desktop Entry]
Type=Application
Version=1.0
Name=Thunder Download Manager
Comment=High-performance multi-threaded download manager
Exec=%s --startup
Icon=thunderdm
Terminal=false
StartupNotify=false
Categories=Network;FileTransfer;
X-GNOME-Autostart-enabled=true
`, exePath)

	return os.WriteFile(desktopPath, []byte(content), 0644)
}
