package utils

import (
	"os/exec"
	"runtime"
)

// ShutdownSystem initiates a system shutdown (Windows specific)
func ShutdownSystem() error {
	if runtime.GOOS == "windows" {
		cmd := PrepareCmd(exec.Command("shutdown", "/s", "/t", "0"))
		return cmd.Run()
	}
	return nil
}

// SleepSystem initiates system sleep (Windows specific)
func SleepSystem() error {
	if runtime.GOOS == "windows" {
		cmd := PrepareCmd(exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"))
		return cmd.Run()
	}
	return nil
}

// HibernateSystem initiates system hibernate (Windows specific)
func HibernateSystem() error {
	if runtime.GOOS == "windows" {
		cmd := PrepareCmd(exec.Command("shutdown", "/h"))
		return cmd.Run()
	}
	return nil
}
