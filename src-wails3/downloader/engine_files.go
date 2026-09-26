// engine_files.go handles file conflict detection, active download checks,
// and unique filename resolution across the local filesystem, in-memory tasks,
// and the persistent SQLite downloads database.
package downloader

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ThunderDM/src-wails3/storage"
)

// checkDownloadsDatabase checks if filename already exists in the SQLite database for the target savePath.
func checkDownloadsDatabase(savePath, filename string) bool {
	if filename == "" {
		return false
	}
	return storage.CheckFilenameExists(savePath, filename)
}

// IsFileActive checks if a file with the given name is currently downloading (.thunderdm / active task),
// exists on disk, or is recorded in the downloads database.
func (e *Engine) IsFileActive(savePath, filename string) bool {
	dest := filepath.Join(savePath, filename)
	tempThunderdm := dest + ".thunderdm"
	tempMerging := dest + ".merging"

	active := false
	e.tasks.Range(func(key, val any) bool {
		taskRunner, ok := val.(TaskRunner)
		if !ok {
			return true
		}
		st := taskRunner.GetState()
		status, _ := st["status"].(DownloadStatus)
		isRunningOrQueued := status == StatusDownloading ||
			status == StatusPending ||
			status == StatusMerging ||
			status == StatusPaused

		if isRunningOrQueued {
			taskDest, _ := st["dest_file_path"].(string)
			taskSavePath, _ := st["save_path"].(string)
			taskFilename, _ := st["filename"].(string)

			matchesDest := taskDest != "" && strings.EqualFold(filepath.Clean(taskDest), filepath.Clean(dest))
			matchesPathAndName := strings.EqualFold(filepath.Clean(taskSavePath), filepath.Clean(savePath)) &&
				strings.EqualFold(taskFilename, filename)

			if matchesDest || matchesPathAndName {
				active = true
				return false
			}
		}
		return true
	})

	if active {
		return true
	}

	// Check if finished destination file or active temporary container files exist on disk
	for _, candidate := range []string{dest, tempThunderdm, tempMerging} {
		if _, err := os.Stat(candidate); err == nil {
			return true
		}
	}

	// Check if active .part / .ytdl / stream format temporary files exist
	baseName := strings.TrimSuffix(filename, filepath.Ext(filename))
	if baseName != "" {
		patterns := []string{
			filepath.Join(savePath, baseName+"*.part*"),
			filepath.Join(savePath, baseName+"*.ytdl*"),
			filepath.Join(savePath, baseName+".f*"),
		}
		for _, pattern := range patterns {
			if matches, _ := filepath.Glob(pattern); len(matches) > 0 {
				return true
			}
		}
	}

	// Check if file already exists in SQLite downloads list
	return checkDownloadsDatabase(savePath, filename)
}

// ResolveUniqueFilename returns an available filename in savePath that does not conflict
// with existing files on disk, active downloads, or database records.
func (e *Engine) ResolveUniqueFilename(savePath, filename string) string {
	savePath = NormalizeSavePath(savePath)
	filename = SanitizeFilename(filename)
	if filename == "" {
		filename = "download"
	}

	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	if base == "" {
		base = "download"
	}

	finalName := filename
	for counter := 1; e.IsFileActive(savePath, finalName); counter++ {
		finalName = fmt.Sprintf("%s_%d%s", base, counter, ext)
	}

	return finalName
}
