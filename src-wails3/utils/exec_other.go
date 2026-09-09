//go:build !windows

package utils

import (
	"os/exec"
	"runtime"
)

// PrepareCmd is a no-op on non-Windows platforms.
func PrepareCmd(cmd *exec.Cmd) *exec.Cmd {
	return cmd
}

// OpenFileWithDefaultApp opens a file using the default viewer on macOS or Linux.
func OpenFileWithDefaultApp(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", path).Start()
	}
	return exec.Command("xdg-open", path).Start()
}
