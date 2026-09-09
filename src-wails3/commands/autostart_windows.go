//go:build windows

package commands

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const runRegistryKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const startupApprovedRunKey = `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`

var candidateAppNames = []string{
	"Thunder Download Manager",
	"ThunderDownloadManager",
	"ThunderDM",
}

func isLaunchOnStartupEnabled() (bool, error) {
	var foundName string
	var foundInRun bool

	// 1. Check HKCU Run
	if k, err := registry.OpenKey(registry.CURRENT_USER, runRegistryKey, registry.QUERY_VALUE); err == nil {
		for _, name := range candidateAppNames {
			if val, _, err := k.GetStringValue(name); err == nil && val != "" {
				foundName = name
				foundInRun = true
				break
			}
		}
		k.Close()
	}

	// 2. Check HKLM Run if not found in HKCU
	if !foundInRun {
		if k, err := registry.OpenKey(registry.LOCAL_MACHINE, runRegistryKey, registry.QUERY_VALUE); err == nil {
			for _, name := range candidateAppNames {
				if val, _, err := k.GetStringValue(name); err == nil && val != "" {
					foundName = name
					foundInRun = true
					break
				}
			}
			k.Close()
		}
	}

	// 3. Check Startup folders
	if !foundInRun {
		for _, name := range candidateAppNames {
			lnkName := name + ".lnk"
			if appData := os.Getenv("APPDATA"); appData != "" {
				if _, err := os.Stat(filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", lnkName)); err == nil {
					foundName = name
					foundInRun = true
					break
				}
			}
			if progData := os.Getenv("ProgramData"); progData != "" {
				if _, err := os.Stat(filepath.Join(progData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", lnkName)); err == nil {
					foundName = name
					foundInRun = true
					break
				}
			}
		}
	}

	if !foundInRun {
		return false, nil
	}

	// 4. Verify with Windows Task Manager StartupApproved key
	if kApproved, err := registry.OpenKey(registry.CURRENT_USER, startupApprovedRunKey, registry.QUERY_VALUE); err == nil {
		defer kApproved.Close()
		buf := make([]byte, 12)
		if n, valType, err := kApproved.GetValue(foundName, buf); err == nil && valType == registry.BINARY && n > 0 {
			// In Windows 10/11: first byte odd/3/1 means disabled in Task Manager
			if buf[0] == 0x03 || buf[0] == 0x01 || buf[0] == 0x07 {
				return false, nil
			}
		}
	}

	return true, nil
}

func setLaunchOnStartup(enabled bool) error {
	if enabled {
		exePath, err := os.Executable()
		if err != nil {
			return err
		}
		cmdVal := fmt.Sprintf(`"%s" --startup`, exePath)

		// 1. Write to HKCU Run
		kRun, _, err := registry.CreateKey(registry.CURRENT_USER, runRegistryKey, registry.SET_VALUE)
		if err != nil {
			return err
		}
		defer kRun.Close()
		if err := kRun.SetStringValue(candidateAppNames[0], cmdVal); err != nil {
			return err
		}

		// 2. Set StartupApproved to Enabled (0x02) so Task Manager immediately reflects Enabled
		if kApproved, _, err := registry.CreateKey(registry.CURRENT_USER, startupApprovedRunKey, registry.SET_VALUE); err == nil {
			enabledBinary := []byte{0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
			_ = kApproved.SetBinaryValue(candidateAppNames[0], enabledBinary)
			kApproved.Close()
		}

		return nil
	}

	// Disabling startup: Clean all candidate names from HKCU, HKLM, StartupApproved, and Startup folders
	if kRun, err := registry.OpenKey(registry.CURRENT_USER, runRegistryKey, registry.SET_VALUE); err == nil {
		for _, name := range candidateAppNames {
			_ = kRun.DeleteValue(name)
		}
		kRun.Close()
	}

	if kRunLM, err := registry.OpenKey(registry.LOCAL_MACHINE, runRegistryKey, registry.SET_VALUE); err == nil {
		for _, name := range candidateAppNames {
			_ = kRunLM.DeleteValue(name)
		}
		kRunLM.Close()
	}

	if kApproved, err := registry.OpenKey(registry.CURRENT_USER, startupApprovedRunKey, registry.SET_VALUE); err == nil {
		for _, name := range candidateAppNames {
			_ = kApproved.DeleteValue(name)
		}
		kApproved.Close()
	}

	if kApprovedLM, err := registry.OpenKey(registry.LOCAL_MACHINE, startupApprovedRunKey, registry.SET_VALUE); err == nil {
		for _, name := range candidateAppNames {
			_ = kApprovedLM.DeleteValue(name)
		}
		kApprovedLM.Close()
	}

	// Remove shortcuts from Startup folders if any
	for _, name := range candidateAppNames {
		lnkName := name + ".lnk"
		if appData := os.Getenv("APPDATA"); appData != "" {
			_ = os.Remove(filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", lnkName))
		}
		if progData := os.Getenv("ProgramData"); progData != "" {
			_ = os.Remove(filepath.Join(progData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", lnkName))
		}
	}

	return nil
}

