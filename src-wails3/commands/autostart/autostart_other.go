//go:build !windows && !darwin && !linux

package autostart

// IsEnabled checks if the app is registered in Startup on unsupported platforms.
func IsEnabled() (bool, error) {
	return false, nil
}

// SetEnabled is a no-op on unsupported platforms.
func SetEnabled(enabled bool) error {
	return nil
}
