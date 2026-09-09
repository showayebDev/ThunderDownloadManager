package commands

import (
	"testing"
)

func TestGetSystemFonts(t *testing.T) {
	cmd := NewSystemCommand()
	fonts, err := cmd.GetSystemFonts()
	if err != nil {
		t.Fatalf("GetSystemFonts returned error: %v", err)
	}

	if len(fonts) == 0 {
		t.Fatalf("Expected at least 1 font (Default), got 0")
	}

	if fonts[0] != "Default" {
		t.Errorf("Expected first font to be 'Default', got '%s'", fonts[0])
	}

	t.Logf("Retrieved %d system fonts. First 10:", len(fonts))
	for i := 0; i < len(fonts) && i < 10; i++ {
		t.Logf(" - [%d] %s", i, fonts[i])
	}
}
