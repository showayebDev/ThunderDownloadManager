package downloader

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ThunderDM/src-wails3/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Engine struct {
	ctx           context.Context
	tasks         sync.Map // map[string]TaskRunner
	globalLimiter *SpeedLimiter
}

var instance *Engine
var once sync.Once

// GetEngine returns the singleton instance of the download engine.
func GetEngine() *Engine {
	once.Do(func() {
		instance = &Engine{
			globalLimiter: NewSpeedLimiter(0),
		}
		CleanBinDirectory()
		InitProxyManager()
		LoadEngineConfig()
	})
	return instance
}

// GetGlobalLimiter returns the shared token bucket rate limiter for all active downloads.
func (e *Engine) GetGlobalLimiter() *SpeedLimiter {
	if e == nil {
		return nil
	}
	return e.globalLimiter
}

// SetGlobalSpeedLimit updates the global aggregate bandwidth cap in bytes per second.
func (e *Engine) SetGlobalSpeedLimit(bytesPerSec int64) {
	if e == nil || e.globalLimiter == nil {
		return
	}
	e.globalLimiter.SetLimit(bytesPerSec)
}

// Startup initializes the engine with the Wails application context.
func (e *Engine) Startup(ctx context.Context) {
	e.ctx = ctx
	InitProxyManager()
	LoadEngineConfig()
}

// checkDownloadsDatabase checks if filename already exists in SQLite database for the target savePath.
func checkDownloadsDatabase(savePath, filename string) bool {
	if filename == "" {
		return false
	}
	return storage.CheckFilenameExists(savePath, filename)
}

// IsFileActive checks if a file with the given name is currently downloading (.thunderdm / active task), exists on disk, or is in downloads.json.
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
		if status == StatusDownloading || status == StatusPending || status == StatusMerging || status == StatusPaused {
			taskDest, _ := st["dest_file_path"].(string)
			taskSavePath, _ := st["save_path"].(string)
			taskFilename, _ := st["filename"].(string)
			if (taskDest != "" && strings.EqualFold(filepath.Clean(taskDest), filepath.Clean(dest))) ||
				(strings.EqualFold(filepath.Clean(taskSavePath), filepath.Clean(savePath)) && strings.EqualFold(taskFilename, filename)) {
				active = true
				return false
			}
		}
		return true
	})

	if active {
		return true
	}

	// Check if finished destination file exists
	if _, err := os.Stat(dest); err == nil {
		return true
	}
	// Check if active .thunderdm temporary container exists
	if _, err := os.Stat(tempThunderdm); err == nil {
		return true
	}
	// Check if active .merging temporary file exists
	if _, err := os.Stat(tempMerging); err == nil {
		return true
	}

	// Check if active .part / .ytdl temporary files exist
	baseName := strings.TrimSuffix(filename, filepath.Ext(filename))
	if baseName != "" {
		if matches, _ := filepath.Glob(filepath.Join(savePath, baseName+".*.part*")); len(matches) > 0 {
			return true
		}
		if matches, _ := filepath.Glob(filepath.Join(savePath, baseName+".*.ytdl*")); len(matches) > 0 {
			return true
		}
	}

	// Check if file already exists in SQLite downloads list
	if checkDownloadsDatabase(savePath, filename) {
		return true
	}

	return false
}

// ResolveUniqueFilename returns an available filename in savePath that does not conflict with existing files or active downloads.
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
	counter := 1

	for {
		if !e.IsFileActive(savePath, finalName) {
			break
		}
		finalName = fmt.Sprintf("%s_%d%s", base, counter, ext)
		counter++
	}

	return finalName
}

// AddDownload adds a new download task, auto-detecting Yt-DLP, HLS streams, or standard HTTP files.
func (e *Engine) AddDownload(id, url, savePath, filename string, threadCount int, protoOpt ...string) error {
	return e.AddDownloadWithLimit(id, url, savePath, filename, threadCount, nil, protoOpt...)
}

// AddDownloadWithLimit adds a new download task with speed limit support.
func (e *Engine) AddDownloadWithLimit(id, url, savePath, filename string, threadCount int, speedLimit *int64, protoOpt ...string) error {
	savePath = NormalizeSavePath(savePath)
	rawProto := ""
	if len(protoOpt) > 0 {
		rawProto = protoOpt[0]
	}

	parsedOpts := ParseDownloadOptions(rawProto, url)
	proto := parsedOpts.Protocol
	quality := parsedOpts.Quality
	checksumStr := parsedOpts.Checksum
	cleanURL := parsedOpts.CleanURL

	if len(protoOpt) > 1 && protoOpt[1] != "" {
		quality = protoOpt[1]
		parsedOpts.Quality = quality
	}

	if len(protoOpt) > 2 && protoOpt[2] != "" && checksumStr == "" {
		checksumStr = protoOpt[2]
		parsedOpts.Checksum = checksumStr
	}

	var prevDL int64 = 0
	var prevTotal int64 = 0

	if val, exists := e.tasks.Load(id); exists {
		taskRunner := val.(TaskRunner)
		state := taskRunner.GetState()
		status, _ := state["status"].(DownloadStatus)
		if status != StatusPaused && status != StatusError && status != StatusCanceled {
			log.Printf("[DownloadEngine] Task with ID %s already exists and is active, continuing execution", id)
			return nil
		}
		if dl, ok := state["downloaded"].(int64); ok && dl > 0 {
			prevDL = dl
		}
		if tot, ok := state["total_size"].(int64); ok && tot > 0 {
			prevTotal = tot
		}
		// Task is inactive, we can safely overwrite it to resume
	}

	isYTDLP := strings.EqualFold(proto, "Yt-DLP") || strings.EqualFold(proto, "YT-DLP") || strings.EqualFold(proto, "ytdlp") || (strings.EqualFold(proto, "Auto") && IsYTDLPURL(cleanURL))
	isHLS := !isYTDLP && (strings.EqualFold(proto, "HLS") || IsHLSURL(cleanURL))

	var taskRunner TaskRunner
	if isYTDLP {
		taskRunner = NewYTDLPTaskController(e.ctx, id, cleanURL, savePath, filename, quality, prevDL, prevTotal, parsedOpts)
	} else if isHLS {
		taskRunner = NewHLSTaskController(e.ctx, id, cleanURL, savePath, filename, threadCount, speedLimit, parsedOpts)
	} else {
		taskRunner = NewTaskController(e.ctx, id, cleanURL, savePath, filename, threadCount, speedLimit, parsedOpts)
	}

	e.tasks.Store(id, taskRunner)
	go taskRunner.Start()

	// Notify frontend that a new download has been added
	if application.Get() != nil {
		application.Get().Event.Emit("download-added", map[string]interface{}{
			"id":             id,
			"url":            cleanURL,
			"filename":       filename,
			"save_path":      savePath,
			"is_hls":         isHLS,
			"is_ytdlp":       isYTDLP,
			"protocol":       proto,
			"given_checksum": checksumStr,
			"givenCheckSum":  checksumStr,
			"thread_count":   taskRunner.GetState()["thread_count"],
		})
	}

	return nil
}

// SetThreadCount dynamically changes the thread count for a running download.
func (e *Engine) SetThreadCount(id string, threadCount int) error {
	val, exists := e.tasks.Load(id)
	if !exists {
		return nil
	}

	taskRunner := val.(TaskRunner)
	taskRunner.UpdateThreadCount(threadCount)
	return nil
}

// SetSpeedLimit dynamically changes the bandwidth limit for a running download.
func (e *Engine) SetSpeedLimit(id string, speedLimit *int64) error {
	val, exists := e.tasks.Load(id)
	if !exists {
		return nil
	}

	taskRunner := val.(TaskRunner)
	taskRunner.UpdateSpeedLimit(speedLimit)
	return nil
}

// Pause stops a download task.
func (e *Engine) Pause(id string) error {
	val, exists := e.tasks.Load(id)
	if !exists {
		return nil
	}
	taskRunner := val.(TaskRunner)
	st := taskRunner.GetState()
	if s, ok := st["status"].(DownloadStatus); ok && s == StatusFinished {
		return nil
	}
	return taskRunner.Pause()
}

// PauseAll stops and saves checkpoints for all active download tasks.
func (e *Engine) PauseAll() {
	var wg sync.WaitGroup
	e.tasks.Range(func(key, val interface{}) bool {
		if taskRunner, ok := val.(TaskRunner); ok && taskRunner != nil {
			st := taskRunner.GetState()
			if s, ok := st["status"].(DownloadStatus); ok {
				if s == StatusFinished || s == StatusError || s == StatusCanceled || s == StatusPaused {
					return true
				}
			}
			wg.Add(1)
			go func(tr TaskRunner) {
				defer wg.Done()
				_ = tr.Pause()
			}(taskRunner)
		}
		return true
	})

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(1500 * time.Millisecond):
		log.Println("[DownloadEngine] PauseAll timed out after 1.5s, proceeding with shutdown")
	}
}

// Cancel stops and removes a download task.
func (e *Engine) Cancel(id string) error {
	val, exists := e.tasks.Load(id)
	if !exists {
		return nil
	}
	taskRunner := val.(TaskRunner)
	err := taskRunner.Cancel()
	e.tasks.Delete(id)
	return err
}

// GetTaskState returns a map representing the current state of a task.
func (e *Engine) GetTaskState(id string) map[string]interface{} {
	val, exists := e.tasks.Load(id)
	if !exists {
		return nil
	}
	taskRunner := val.(TaskRunner)
	return taskRunner.GetState()
}

// GetActiveTasksInfo returns summary information for all currently active (downloading/pending/merging) tasks.
func (e *Engine) GetActiveTasksInfo() []ActiveTaskInfo {
	if e == nil {
		return nil
	}
	var results []ActiveTaskInfo
	e.tasks.Range(func(key, val any) bool {
		taskRunner, ok := val.(TaskRunner)
		if !ok || taskRunner == nil {
			return true
		}
		st := taskRunner.GetState()
		if st == nil {
			return true
		}
		status, _ := st["status"].(DownloadStatus)
		if status != StatusDownloading && status != StatusPending && status != StatusMerging {
			if statusStr, ok := st["status"].(string); ok {
				status = DownloadStatus(statusStr)
			}
		}
		if status == StatusDownloading || status == StatusPending || status == StatusMerging {
			id, _ := st["id"].(string)
			if id == "" {
				if idVal, ok := key.(string); ok {
					id = idVal
				}
			}
			fn, _ := st["filename"].(string)
			if fn == "" {
				fn = "download"
			}
			var dl, tot int64
			if v, ok := st["downloaded"].(int64); ok {
				dl = v
			}
			if v, ok := st["total_size"].(int64); ok {
				tot = v
			}
			pct := 0
			if tot > 0 {
				pct = int((dl * 100) / tot)
				if pct > 100 {
					pct = 100
				}
			}
			results = append(results, ActiveTaskInfo{
				ID:       id,
				Filename: fn,
				Progress: pct,
				Status:   status,
			})
		}
		return true
	})
	return results
}

