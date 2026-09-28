//go:build windows

package utils

import (
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	shell32           = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW = shell32.NewProc("ShellExecuteW")
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

// OpenFileWithDefaultApp opens a file using the registered default application on Windows.
func OpenFileWithDefaultApp(path string) error {
	verbPtr, _ := syscall.UTF16PtrFromString("open")
	filePtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	dirPtr, _ := syscall.UTF16PtrFromString(filepath.Dir(path))

	ret, _, _ := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verbPtr)),
		uintptr(unsafe.Pointer(filePtr)),
		0,
		uintptr(unsafe.Pointer(dirPtr)),
		1, // SW_SHOWNORMAL = 1
	)
	// ShellExecute returns an HINSTANCE > 32 if successful
	if ret > 32 {
		return nil
	}

	// Fallback to cmd /c start "" "<path>"
	cmd := exec.Command("cmd", "/c", "start", "", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}
