//go:build !windows

package downloader

// CheckFreeDiskSpace fallback for non-windows platforms.
func CheckFreeDiskSpace(path string, requiredBytes int64) (bool, error) {
	// Fallback permits download if OS-specific check is not implemented
	return true, nil
}

// ApplySparseFile fallback for non-windows platforms.
func ApplySparseFile(fd uintptr) error {
	return nil
}
