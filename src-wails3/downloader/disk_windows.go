//go:build windows

package downloader

import (
	"fmt"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	procGetDiskFreeSpace = kernel32.NewProc("GetDiskFreeSpaceExW")
)

// CheckFreeDiskSpace verifies if the target directory drive has enough free bytes.
func CheckFreeDiskSpace(path string, requiredBytes int64) (bool, error) {
	if requiredBytes <= 0 {
		return true, nil
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return true, nil
	}

	dir := filepath.VolumeName(absPath)
	if dir == "" {
		dir = absPath
	}
	dir = dir + string(filepath.Separator)

	pathPtr, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return true, nil
	}

	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes int64

	r1, _, errSys := procGetDiskFreeSpace.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalNumberOfBytes)),
		uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
	)

	if r1 == 0 {
		return true, fmt.Errorf("failed to query disk space: %v", errSys)
	}

	if freeBytesAvailable < requiredBytes {
		return false, fmt.Errorf("insufficient disk space: %d bytes required, but only %d bytes available", requiredBytes, freeBytesAvailable)
	}

	return true, nil
}

const fsctlSetSparse = 0x000900C4

// ApplySparseFile marks the file as sparse on Windows NTFS file systems to prevent fragmentation and optimize allocation.
func ApplySparseFile(fd uintptr) error {
	var bytesReturned uint32
	err := syscall.DeviceIoControl(
		syscall.Handle(fd),
		fsctlSetSparse,
		nil,
		0,
		nil,
		0,
		&bytesReturned,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to set sparse flag: %w", err)
	}
	return nil
}
