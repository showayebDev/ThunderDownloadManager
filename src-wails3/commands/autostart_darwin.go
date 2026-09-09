//go:build darwin

package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

const darwinPlistName = "com.thunderdm.thunderdm.plist"

func getLaunchAgentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", darwinPlistName), nil
}

func isLaunchOnStartupEnabled() (bool, error) {
	plistPath, err := getLaunchAgentPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(plistPath)
	return err == nil, nil
}

func setLaunchOnStartup(enabled bool) error {
	plistPath, err := getLaunchAgentPath()
	if err != nil {
		return err
	}

	if !enabled {
		dir := filepath.Dir(plistPath)
		for _, name := range []string{darwinPlistName, "thunderdm.plist", "ThunderDownloadManager.plist"} {
			_ = os.Remove(filepath.Join(dir, name))
		}
		return nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	dir := filepath.Dir(plistPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	plistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.thunderdm.thunderdm</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>--startup</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
`, exePath)

	return os.WriteFile(plistPath, []byte(plistContent), 0644)
}
