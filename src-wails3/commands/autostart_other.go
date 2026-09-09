//go:build !windows && !darwin && !linux

package commands

func isLaunchOnStartupEnabled() (bool, error) {
	return false, nil
}

func setLaunchOnStartup(enabled bool) error {
	return nil
}
