//go:build windows

package downloader

import (
	"os/exec"
	"syscall"
)

// PrepareCmd configures the command to run completely silently without creating or showing a console/terminal window on Windows.
func PrepareCmd(cmd *exec.Cmd) *exec.Cmd {
	if cmd == nil {
		return nil
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= 0x08000000 // CREATE_NO_WINDOW
	return cmd
}
