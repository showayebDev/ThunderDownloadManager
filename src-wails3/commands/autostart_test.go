package commands

import (
	"testing"
)

func TestAutostartEnableDisable(t *testing.T) {
	// 1. Test disabling
	if err := setLaunchOnStartup(false); err != nil {
		t.Fatalf("setLaunchOnStartup(false) failed: %v", err)
	}

	enabled, err := isLaunchOnStartupEnabled()
	if err != nil {
		t.Fatalf("isLaunchOnStartupEnabled() after disable failed: %v", err)
	}
	if enabled {
		t.Errorf("expected autostart to be false after disabling, got true")
	}

	// 2. Test enabling
	if err := setLaunchOnStartup(true); err != nil {
		t.Fatalf("setLaunchOnStartup(true) failed: %v", err)
	}

	enabled, err = isLaunchOnStartupEnabled()
	if err != nil {
		t.Fatalf("isLaunchOnStartupEnabled() after enable failed: %v", err)
	}
	if !enabled {
		t.Errorf("expected autostart to be true after enabling, got false")
	}

	// 3. Clean up (disable)
	_ = setLaunchOnStartup(false)
	enabled, _ = isLaunchOnStartupEnabled()
	if enabled {
		t.Errorf("expected autostart cleanup to be false, got true")
	}
}
