package autostart

import (
	"testing"
)

func TestAutostartEnableDisable(t *testing.T) {
	// 1. Test disabling
	if err := SetEnabled(false); err != nil {
		t.Fatalf("SetEnabled(false) failed: %v", err)
	}

	enabled, err := IsEnabled()
	if err != nil {
		t.Fatalf("IsEnabled() after disable failed: %v", err)
	}
	if enabled {
		t.Errorf("expected autostart to be false after disabling, got true")
	}

	// 2. Test enabling
	if err := SetEnabled(true); err != nil {
		t.Fatalf("SetEnabled(true) failed: %v", err)
	}

	enabled, err = IsEnabled()
	if err != nil {
		t.Fatalf("IsEnabled() after enable failed: %v", err)
	}
	if !enabled {
		t.Errorf("expected autostart to be true after enabling, got false")
	}

	// 3. Clean up (disable)
	_ = SetEnabled(false)
	enabled, _ = IsEnabled()
	if enabled {
		t.Errorf("expected autostart cleanup to be false, got true")
	}
}
