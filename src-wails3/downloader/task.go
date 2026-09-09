package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type TaskCheckpoint struct {
	ID               string            `json:"id"`
	URL              string            `json:"url"`
	SavePath         string            `json:"save_path"`
	Filename         string            `json:"filename"`
	TotalSize        int64             `json:"total_size"`
	ThreadCount      int               `json:"thread_count"`
	SpeedLimit       *int64            `json:"speed_limit,omitempty"`
	GivenCheckSum    string            `json:"given_checksum,omitempty"`
	ExpectedChecksum string            `json:"expected_checksum,omitempty"`
	AuthUsername     string            `json:"auth_username,omitempty"`
	AuthPassword     string            `json:"auth_password,omitempty"`
	UserAgent        string            `json:"user_agent,omitempty"`
	Referer          string            `json:"referer,omitempty"`
	Cookies          string            `json:"cookies,omitempty"`
	Chunks           []ChunkCheckpoint `json:"chunks"`
	UpdatedAt        int64             `json:"updated_at"`
}

type ChunkCheckpoint struct {
	ID          int            `json:"id"`
	StartByte   int64          `json:"start_byte"`
	CurrentByte int64          `json:"current_byte"`
	EndByte     int64          `json:"end_byte"`
	Status      DownloadStatus `json:"status"`
}

type TaskController struct {
	wailsCtx      context.Context
	ctx           context.Context
	cancel        context.CancelFunc
	State         *TaskState
	limiter       *SpeedLimiter
	workers       sync.WaitGroup
	chunkSignal   chan struct{}
	speedEMA      float64
	targetFile    *os.File
	workerCancels map[*ChunkState]context.CancelFunc
	cancelsMu     sync.Mutex
}

func NewTaskController(wailsCtx context.Context, id, url, savePath, filename string, threadCount int, opts ...interface{}) *TaskController {
	savePath = NormalizeSavePath(savePath)
	ctx, cancel := context.WithCancel(context.Background())
	var spLimit *int64
	var limitBytes int64 = 0
	var checksumStr string
	var authUser, authPass, userAgent, referer, cookies string
	showCompletion := true

	for _, opt := range opts {
		if opt == nil {
			continue
		}
		switch v := opt.(type) {
		case *int64:
			spLimit = v
			if v != nil && *v > 0 {
				limitBytes = *v
			}
		case DownloadExtraOptions:
			if v.ShowCompletion != nil {
				showCompletion = *v.ShowCompletion
			}
			if v.Checksum != "" && checksumStr == "" {
				checksumStr = v.Checksum
			}
			if v.Username != "" {
				authUser = v.Username
			}
			if v.Password != "" {
				authPass = v.Password
			}
			if v.UserAgent != "" {
				userAgent = v.UserAgent
			}
			if v.Referer != "" {
				referer = v.Referer
			}
			if v.Cookies != "" {
				cookies = v.Cookies
			}
		case string:
			if v != "" && checksumStr == "" {
				checksumStr = v
			}
		}
	}

	// Also extract credentials embedded in URL (http://user:pass@host/path)
	cleanURL := strings.TrimSpace(url)
	if parsed, err := neturl.Parse(cleanURL); err == nil && parsed.User != nil {
		if u := parsed.User.Username(); u != "" && authUser == "" {
			authUser = u
		}
		if p, ok := parsed.User.Password(); ok && authPass == "" {
			authPass = p
		}
	}

	// Auto-lookup per-host settings from download_engine.json if not explicitly provided
	vItem := MatchVaultItem(cleanURL)
	if vItem != nil {
		if authUser == "" && authPass == "" {
			if vItem.User != "" || vItem.Pass != "" {
				authUser = vItem.User
				authPass = vItem.Pass
			}
		}
		if userAgent == "" && vItem.UserAgent != "" {
			userAgent = vItem.UserAgent
		}
		if threadCount <= 0 && vItem.ThreadCount > 0 {
			threadCount = vItem.ThreadCount
		}
		if spLimit == nil && vItem.SpeedLimit > 0 {
			sl := vItem.SpeedLimit
			spLimit = &sl
			limitBytes = sl
		}
	}

	engineCfg := GetEngineConfig()
	if userAgent == "" && engineCfg.UserAgent != "" {
		userAgent = engineCfg.UserAgent
	}

	if threadCount <= 0 {
		threadCount = engineCfg.DefaultThreadCount
		if threadCount <= 0 {
			threadCount = 8
		}
	}

	taskLimiter := NewSpeedLimiter(limitBytes)
	if spLimit != nil {
		taskLimiter.SetExplicitLimit(limitBytes)
	} else {
		taskLimiter.SetDefaultLimit(0)
	}

	return &TaskController{
		wailsCtx:      wailsCtx,
		ctx:           ctx,
		cancel:        cancel,
		limiter:       taskLimiter,
		chunkSignal:   make(chan struct{}, 10),
		workerCancels: make(map[*ChunkState]context.CancelFunc),
		State: &TaskState{
			ID:               id,
			URL:              cleanURL,
			SavePath:         savePath,
			Filename:         filename,
			ThreadCount:      threadCount,
			SpeedLimit:       spLimit,
			GivenCheckSum:    checksumStr,
			ExpectedChecksum: checksumStr,
			AuthUsername:     authUser,
			AuthPassword:     authPass,
			UserAgent:        userAgent,
			Referer:          referer,
			Cookies:          cookies,
			Status:           StatusPending,
			ShowCompletion:   showCompletion,
			Chunks:           make([]*ChunkState, 0),
		},
	}
}

func (tc *TaskController) checkpointPath() string {
	return GetTaskMetaFilePath(tc.State.ID)
}

func (tc *TaskController) secondaryCheckpointPath() string {
	return GetTaskMetaPathByDest(tc.State.DestFilePath)
}

func (tc *TaskController) legacyCheckpointPath() string {
	if tc.State.TempFilePath != "" {
		return tc.State.TempFilePath + ".meta"
	}
	return ""
}

func (tc *TaskController) cleanupCheckpoint() {
	_ = os.Remove(tc.checkpointPath())
	if sec := tc.secondaryCheckpointPath(); sec != "" {
		_ = os.Remove(sec)
	}
	if leg := tc.legacyCheckpointPath(); leg != "" {
		_ = os.Remove(leg)
	}
}

func (tc *TaskController) saveCheckpointLocked() {
	totalSize := tc.State.TotalSize
	if totalSize <= 0 || len(tc.State.Chunks) == 0 {
		return
	}

	chunks := make([]ChunkCheckpoint, len(tc.State.Chunks))
	for i, c := range tc.State.Chunks {
		id, start, cur, end, st := c.Snapshot()
		chunks[i] = ChunkCheckpoint{
			ID:          id,
			StartByte:   start,
			CurrentByte: cur,
			EndByte:     end,
			Status:      st,
		}
	}

	meta := TaskCheckpoint{
		ID:               tc.State.ID,
		URL:              tc.State.URL,
		SavePath:         tc.State.SavePath,
		Filename:         tc.State.Filename,
		TotalSize:        totalSize,
		ThreadCount:      tc.State.ThreadCount,
		SpeedLimit:       tc.State.SpeedLimit,
		GivenCheckSum:    tc.State.GivenCheckSum,
		ExpectedChecksum: tc.State.ExpectedChecksum,
		AuthUsername:     tc.State.AuthUsername,
		AuthPassword:     tc.State.AuthPassword,
		UserAgent:        tc.State.UserAgent,
		Referer:          tc.State.Referer,
		Cookies:          tc.State.Cookies,
		Chunks:           chunks,
		UpdatedAt:        time.Now().UnixMilli(),
	}

	data, err := json.Marshal(meta)
	if err != nil {
		return
	}

	metaPath := tc.checkpointPath()
	if metaPath != "" {
		_ = os.MkdirAll(filepath.Dir(metaPath), 0755)
		_ = os.WriteFile(metaPath, data, 0644)
	}

	// Also update secondary checkpoint for destination path lookup
	if secPath := tc.secondaryCheckpointPath(); secPath != "" && secPath != metaPath {
		_ = os.MkdirAll(filepath.Dir(secPath), 0755)
		_ = os.WriteFile(secPath, data, 0644)
	}
}

func (tc *TaskController) saveCheckpoint() {
	tc.State.mu.RLock()
	defer tc.State.mu.RUnlock()
	tc.saveCheckpointLocked()
}

func (tc *TaskController) loadCheckpoint() bool {
	pathsToTry := []string{
		tc.checkpointPath(),
		tc.secondaryCheckpointPath(),
		tc.legacyCheckpointPath(),
	}

	var data []byte
	var err error
	for _, p := range pathsToTry {
		if p == "" {
			continue
		}
		data, err = os.ReadFile(p)
		if err == nil && len(data) > 0 {
			break
		}
	}

	if len(data) == 0 {
		return false
	}

	var meta TaskCheckpoint
	if err := json.Unmarshal(data, &meta); err != nil {
		return false
	}

	if len(meta.Chunks) == 0 {
		return false
	}

	if tc.State.TotalSize > 0 && meta.TotalSize > 0 && meta.TotalSize != tc.State.TotalSize {
		return false
	}

	if meta.AuthUsername != "" && tc.State.AuthUsername == "" {
		tc.State.AuthUsername = meta.AuthUsername
	}
	if meta.AuthPassword != "" && tc.State.AuthPassword == "" {
		tc.State.AuthPassword = meta.AuthPassword
	}
	if meta.UserAgent != "" && tc.State.UserAgent == "" {
		tc.State.UserAgent = meta.UserAgent
	}
	if meta.Referer != "" && tc.State.Referer == "" {
		tc.State.Referer = meta.Referer
	}
	if meta.Cookies != "" && tc.State.Cookies == "" {
		tc.State.Cookies = meta.Cookies
	}

	if meta.GivenCheckSum != "" {
		tc.State.GivenCheckSum = meta.GivenCheckSum
	}
	if meta.ExpectedChecksum != "" {
		tc.State.ExpectedChecksum = meta.ExpectedChecksum
	}
	if tc.State.GivenCheckSum == "" && tc.State.ExpectedChecksum != "" {
		tc.State.GivenCheckSum = tc.State.ExpectedChecksum
	}
	if tc.State.ExpectedChecksum == "" && tc.State.GivenCheckSum != "" {
		tc.State.ExpectedChecksum = tc.State.GivenCheckSum
	}

	if meta.SpeedLimit != nil && *meta.SpeedLimit > 0 {
		tc.State.SpeedLimit = meta.SpeedLimit
		tc.limiter.SetLimit(*meta.SpeedLimit)
	}

	targetThreadCount := tc.State.ThreadCount
	if targetThreadCount <= 0 {
		targetThreadCount = meta.ThreadCount
	}
	if targetThreadCount <= 0 {
		targetThreadCount = len(meta.Chunks)
	}
	if targetThreadCount <= 0 {
		engineCfg := GetEngineConfig()
		targetThreadCount = engineCfg.DefaultThreadCount
		if targetThreadCount <= 0 {
			targetThreadCount = 8
		}
	}

	tc.State.ThreadCount = targetThreadCount
	tc.State.Chunks = make([]*ChunkState, 0, len(meta.Chunks))

	for _, cp := range meta.Chunks {
		st := cp.Status
		if cp.EndByte > 0 && cp.CurrentByte <= cp.EndByte {
			st = StatusPending
		} else if cp.EndByte > 0 && cp.CurrentByte > cp.EndByte {
			st = StatusFinished
		} else if st == StatusDownloading || st == StatusError {
			st = StatusPending
		}

		chunk := &ChunkState{
			ID:          cp.ID,
			StartByte:   cp.StartByte,
			CurrentByte: cp.CurrentByte,
			EndByte:     cp.EndByte,
			Status:      st,
		}
		tc.State.Chunks = append(tc.State.Chunks, chunk)
	}

	// Sort chunks by StartByte and normalize IDs
	if len(tc.State.Chunks) > 0 {
		sort.Slice(tc.State.Chunks, func(i, j int) bool {
			return tc.State.Chunks[i].StartByte < tc.State.Chunks[j].StartByte
		})

		// Consolidate adjacent unstarted chunks if chunk count exceeds targetThreadCount
		if len(tc.State.Chunks) > targetThreadCount {
			consolidated := make([]*ChunkState, 0, len(tc.State.Chunks))
			for i := 0; i < len(tc.State.Chunks); i++ {
				c := tc.State.Chunks[i]
				// Merge adjacent pending chunks that have 0 bytes downloaded
				for len(consolidated) > 0 && c.CurrentByte == c.StartByte && c.Status == StatusPending && (len(tc.State.Chunks)-i+len(consolidated)) > targetThreadCount {
					prev := consolidated[len(consolidated)-1]
					if prev.EndByte+1 == c.StartByte && (prev.Status == StatusPending || prev.Status == StatusDownloading) {
						prev.EndByte = c.EndByte
						c = nil
						break
					} else {
						break
					}
				}
				if c != nil {
					consolidated = append(consolidated, c)
				}
			}
			tc.State.Chunks = consolidated
		}

		for idx, chk := range tc.State.Chunks {
			chk.ID = idx
		}
	}

	// If the user requested more threads than existing chunks, split the largest uncompleted chunks
	if targetThreadCount > len(tc.State.Chunks) && tc.State.TotalSize > 0 {
		diff := targetThreadCount - len(tc.State.Chunks)
		for i := 0; i < diff; i++ {
			if !tc.splitLargestChunk() {
				break
			}
		}
	}

	return true
}

func (tc *TaskController) Start() {
	err := tc.preCheck()
	if err != nil {
		tc.changeStatusWithError(StatusError, err)
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": err.Error()})
		}
		return
	}

	tc.changeStatus(StatusDownloading)
	tc.emitCurrentProgress()
	go tc.orchestratorLoop()
	go tc.progressEmitter()
}

func (tc *TaskController) preCheck() error {
	ctxProbe, cancelProbe := context.WithTimeout(tc.ctx, 25*time.Second)
	defer cancelProbe()

	applyHeaders := func(r *http.Request) {
		if tc.State.AuthUsername != "" || tc.State.AuthPassword != "" {
			r.SetBasicAuth(tc.State.AuthUsername, tc.State.AuthPassword)
		}
		if tc.State.UserAgent != "" {
			r.Header.Set("User-Agent", tc.State.UserAgent)
		}
		if tc.State.Referer != "" {
			r.Header.Set("Referer", tc.State.Referer)
		}
		if tc.State.Cookies != "" {
			r.Header.Set("Cookie", tc.State.Cookies)
		}
	}

	var resp *http.Response
	var err error

	cfg := GetEngineConfig()
	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctxProbe.Done():
				return ctxProbe.Err()
			case <-time.After(time.Duration(attempt*200) * time.Millisecond):
			}
		}

		var req *http.Request
		req, err = http.NewRequestWithContext(ctxProbe, http.MethodHead, tc.State.URL, nil)
		if err != nil {
			return err
		}
		applyHeaders(req)

		resp, err = SharedHTTPClient.Do(req)
		if resp != nil && (resp.StatusCode == 404 || resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 410) {
			if resp.Body != nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
			return fmt.Errorf("HTTP %d (%s)", resp.StatusCode, http.StatusText(resp.StatusCode))
		}
		if err != nil || (resp != nil && resp.StatusCode >= 400) || resp == nil {
			if resp != nil && resp.Body != nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
			// Fallback to GET with Range: bytes=0-0 to probe length and range support safely
			req, err = http.NewRequestWithContext(ctxProbe, http.MethodGet, tc.State.URL, nil)
			if err != nil {
				return err
			}
			req.Header.Set("Range", "bytes=0-0")
			applyHeaders(req)
			resp, err = SharedHTTPClient.Do(req)
			if resp != nil && (resp.StatusCode == 404 || resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 410) {
				if resp.Body != nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
				}
				return fmt.Errorf("HTTP %d (%s)", resp.StatusCode, http.StatusText(resp.StatusCode))
			}
			if err != nil || (resp != nil && resp.StatusCode >= 400) || resp == nil {
				if resp != nil && resp.Body != nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
				}
				req, err = http.NewRequestWithContext(ctxProbe, http.MethodGet, tc.State.URL, nil)
				if err != nil {
					return err
				}
				applyHeaders(req)
				resp, err = SharedHTTPClient.Do(req)
			}
		}

		if err == nil && resp != nil && resp.StatusCode >= 200 && resp.StatusCode < 400 {
			break
		}
	}
	defer func() {
		if resp != nil && resp.Body != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}()

	if err != nil && resp == nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	if resp == nil {
		return fmt.Errorf("server returned no response")
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("server returned status: %s", resp.Status)
	}

	// Capture Last-Modified timestamp from server response
	if lmStr := resp.Header.Get("Last-Modified"); lmStr != "" {
		if parsedTime, err := http.ParseTime(lmStr); err == nil {
			tc.State.LastModified = parsedTime
		}
	}

	var totalSize int64
	// Parse Content-Range if returned for byte probe
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		if idx := strings.LastIndex(cr, "/"); idx != -1 {
			totalSize, _ = strconv.ParseInt(cr[idx+1:], 10, 64)
		}
	}

	// Fallback to Content-Length
	if totalSize == 0 {
		if cl := resp.Header.Get("Content-Length"); cl != "" {
			totalSize, _ = strconv.ParseInt(cl, 10, 64)
		}
	}

	if totalSize <= 0 {
		// Stream / dynamic content: fallback to 1 thread streaming
		tc.State.TotalSize = -1
		tc.State.ThreadCount = 1
	} else {
		tc.State.TotalSize = totalSize
		// Validate free disk space
		if ok, spaceErr := CheckFreeDiskSpace(tc.State.SavePath, totalSize); !ok {
			return spaceErr
		}
	}

	acceptRanges := resp.Header.Get("Accept-Ranges")
	isResumable := (acceptRanges == "bytes" || resp.StatusCode == http.StatusPartialContent || resp.Header.Get("Content-Range") != "") && tc.State.TotalSize > 0
	tc.State.Resumable = isResumable
	if !isResumable || (tc.State.TotalSize > 0 && tc.State.TotalSize < 512*1024) {
		// Server does not support ranges or file is small (< 512KB), fallback to 1 thread
		tc.State.ThreadCount = 1
	} else if tc.State.TotalSize > 0 {
		maxThreads := int(tc.State.TotalSize / (64 * 1024))
		if maxThreads < 1 {
			maxThreads = 1
		}
		if tc.State.ThreadCount > maxThreads {
			tc.State.ThreadCount = maxThreads
		}
	}

	// Prepare directories & target .thunderdm container file
	tc.State.SavePath = NormalizeSavePath(tc.State.SavePath)
	if err := os.MkdirAll(tc.State.SavePath, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	destPath := filepath.Join(tc.State.SavePath, tc.State.Filename)
	tempPath := destPath + ".thunderdm"
	tc.State.DestFilePath = destPath
	tc.State.TempFilePath = tempPath

	// Check if the temporary container file already existed on disk with content
	tempFileExisted := false
	if fi, err := os.Stat(tempPath); err == nil && fi.Size() > 0 {
		tempFileExisted = true
	}

	// Open or create target file with read/write permissions
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return fmt.Errorf("failed to create container file: %w", err)
	}

	if tc.State.TotalSize > 0 {
		// Apply NTFS Sparse File Allocation on Windows if enabled
		if GetEngineConfig().SparseFileAllocation {
			_ = ApplySparseFile(file.Fd())
		}
		// Pre-allocate disk space if newly created
		if fi, err := file.Stat(); err == nil && fi.Size() < tc.State.TotalSize {
			_ = file.Truncate(tc.State.TotalSize)
		}
	}
	tc.targetFile = file

	tc.initializeChunks(tempFileExisted)
	return nil
}

func (tc *TaskController) initializeChunks(opts ...bool) {
	tc.State.mu.Lock()
	defer tc.State.mu.Unlock()

	tempFileExisted := true
	if len(opts) > 0 {
		tempFileExisted = opts[0]
	} else if tc.State.TempFilePath != "" {
		if fi, err := os.Stat(tc.State.TempFilePath); err != nil || fi.Size() == 0 {
			tempFileExisted = false
		}
	}

	// If the temporary container file does NOT exist on disk, any saved checkpoint is invalid.
	// We MUST purge the checkpoint and start fresh from 0 (0%) to prevent file corruption.
	if !tempFileExisted {
		tc.cleanupCheckpoint()
	} else if tc.loadCheckpoint() {
		log.Printf("[TaskController] Resuming task %s from OS app storage checkpoint: %d chunks restored", tc.State.ID, len(tc.State.Chunks))
		return
	}

	tc.State.Chunks = make([]*ChunkState, 0)
	if tc.State.TotalSize <= 0 || tc.State.ThreadCount <= 1 {
		tc.State.ThreadCount = 1
		var endByte int64 = -1
		if tc.State.TotalSize > 0 {
			endByte = tc.State.TotalSize - 1
		}
		tc.State.Chunks = []*ChunkState{
			{
				ID:          0,
				StartByte:   0,
				CurrentByte: 0,
				EndByte:     endByte,
				Status:      StatusPending,
			},
		}
		tc.saveCheckpointLocked()
		return
	}

	chunkSize := tc.State.TotalSize / int64(tc.State.ThreadCount)
	for i := 0; i < tc.State.ThreadCount; i++ {
		start := int64(i) * chunkSize
		end := start + chunkSize - 1
		if i == tc.State.ThreadCount-1 {
			end = tc.State.TotalSize - 1
		}
		chunk := &ChunkState{
			ID:          i,
			StartByte:   start,
			CurrentByte: start,
			EndByte:     end,
			Status:      StatusPending,
		}
		tc.State.Chunks = append(tc.State.Chunks, chunk)
	}

	tc.saveCheckpointLocked()
}

func (tc *TaskController) orchestratorLoop() {
	tc.triggerWorkerCheck()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-tc.ctx.Done():
			if tc.targetFile != nil {
				_ = tc.targetFile.Sync()
				_ = tc.targetFile.Close()
			}
			return
		case <-ticker.C:
			tc.triggerWorkerCheck()
		case <-tc.chunkSignal:
			tc.State.mu.Lock()
			activeWorkers := 0
			pendingChunks := make([]*ChunkState, 0)
			errorChunks := make([]*ChunkState, 0)
			allFinished := len(tc.State.Chunks) > 0
			var totalDownloaded int64 = 0

			for _, c := range tc.State.Chunks {
				id, start, cur, end, status := c.Snapshot()
				_ = id
				if cur > start {
					totalDownloaded += (cur - start)
				}

				isChunkFinished := (status == StatusFinished) && (end <= 0 || cur > end)

				if !isChunkFinished {
					allFinished = false
					if status == StatusDownloading {
						activeWorkers++
					} else if status == StatusError {
						errorChunks = append(errorChunks, c)
					} else {
						pendingChunks = append(pendingChunks, c)
					}
				}
			}

			// For fixed-size downloads, require all chunks finished AND total downloaded >= total size
			if tc.State.TotalSize > 0 && totalDownloaded < tc.State.TotalSize {
				allFinished = false
			}

			if allFinished {
				tc.State.mu.Unlock()
				tc.finalizeDownload()
				return
			}

			// If no workers active, no pending chunks, and not all finished:
			// Fail the task cleanly to prevent infinite loop or freeze
			if activeWorkers == 0 && len(pendingChunks) == 0 && !allFinished {
				tc.State.Status = StatusError
				if tc.State.ErrorMessage == "" {
					tc.State.ErrorMessage = "Download failed: connection or server error"
				}
				errMsg := tc.State.ErrorMessage
				taskID := tc.State.ID
				filename := tc.State.Filename
				tc.State.mu.Unlock()

				if tc.targetFile != nil {
					_ = tc.targetFile.Sync()
					_ = tc.targetFile.Close()
					tc.targetFile = nil
				}

				log.Printf("[TaskController] Task %s (%s) failed with error: %s", taskID, filename, errMsg)
				tc.emitCurrentProgress()
				if application.Get() != nil {
					application.Get().Event.Emit("download-error", map[string]interface{}{
						"task_id": taskID,
						"id":      taskID,
						"error":   errMsg,
					})
				}
				tc.cancel()
				return
			}

			threadCount := tc.State.ThreadCount
			tc.State.mu.Unlock()

			// IDM Dynamic File Relocation: Only split if dynamic part creation is enabled,
			// active workers < threadCount, NO chunks in error state, and total chunks < threadCount
			if GetEngineConfig().DynamicPartCreation && activeWorkers < threadCount && len(errorChunks) == 0 && tc.State.TotalSize > 0 {
				tc.State.mu.Lock()
				if len(errorChunks) == 0 && len(tc.State.Chunks) < threadCount {
					slotsNeeded := threadCount - (activeWorkers + len(pendingChunks))
					for s := 0; s < slotsNeeded && len(tc.State.Chunks) < threadCount; s++ {
						if !tc.splitLargestChunk() {
							break
						}
					}
					pendingChunks = make([]*ChunkState, 0)
					for _, c := range tc.State.Chunks {
						if c.GetStatus() == StatusPending {
							pendingChunks = append(pendingChunks, c)
						}
					}
				}
				tc.State.mu.Unlock()
			}

			// Spawn workers if under limit
			for i := 0; i < len(pendingChunks) && activeWorkers < threadCount; i++ {
				c := pendingChunks[i]
				c.SetStatus(StatusDownloading)
				activeWorkers++
				tc.workers.Add(1)

				workerCtx, workerCancel := context.WithCancel(tc.ctx)
				tc.cancelsMu.Lock()
				tc.workerCancels[c] = workerCancel
				tc.cancelsMu.Unlock()

				go func(chk *ChunkState, wCtx context.Context) {
					defer func() {
						tc.cancelsMu.Lock()
						delete(tc.workerCancels, chk)
						tc.cancelsMu.Unlock()
						tc.workers.Done()
					}()
					err := DownloadChunk(wCtx, tc.State.URL, chk, tc.targetFile, SharedHTTPClient, tc.limiter, func(c0 *ChunkState) {
						tc.FallbackToSingleStream(c0)
					}, tc.State.AuthUsername, tc.State.AuthPassword, tc.State.UserAgent, tc.State.Referer, tc.State.Cookies)
					if err != nil && wCtx.Err() == nil {
						tc.State.mu.Lock()
						if tc.State.ErrorMessage == "" {
							tc.State.ErrorMessage = err.Error()
						}
						tc.State.mu.Unlock()
					}
					tc.triggerWorkerCheck()
				}(c, workerCtx)
			}
		}
	}
}

func (tc *TaskController) FallbackToSingleStream(chunk0 *ChunkState) {
	tc.State.mu.Lock()
	tc.State.ThreadCount = 1
	tc.State.Resumable = false
	if tc.State.TotalSize > 0 {
		chunk0.SetEndByte(tc.State.TotalSize - 1)
	} else {
		chunk0.SetEndByte(-1)
	}
	// Cancel other chunk workers
	for _, c := range tc.State.Chunks {
		if c != chunk0 {
			tc.cancelWorker(c)
		}
	}
	tc.State.Chunks = []*ChunkState{chunk0}
	tc.State.mu.Unlock()

	go tc.saveCheckpoint()
}

func (tc *TaskController) triggerWorkerCheck() {
	select {
	case tc.chunkSignal <- struct{}{}:
	default:
	}
}

func (tc *TaskController) cancelWorker(chk *ChunkState) {
	tc.cancelsMu.Lock()
	if cancel, exists := tc.workerCancels[chk]; exists {
		cancel()
		delete(tc.workerCancels, chk)
	}
	tc.cancelsMu.Unlock()
}

func (tc *TaskController) UpdateSpeedLimit(speedLimit *int64) {
	tc.State.mu.Lock()
	tc.State.SpeedLimit = speedLimit
	tc.State.mu.Unlock()

	var limit int64 = 0
	if speedLimit != nil && *speedLimit > 0 {
		limit = *speedLimit
	}
	if tc.limiter != nil {
		tc.limiter.SetExplicitLimit(limit)
	}
	go tc.saveCheckpoint()
}

func (tc *TaskController) UpdateThreadCount(newCount int) {
	tc.State.mu.Lock()

	if newCount <= 0 {
		newCount = 1
	}

	tc.State.ThreadCount = newCount

	// When decreasing threads: gracefully pause excess active downloading workers back to StatusPending.
	// We NEVER delete chunks that have downloaded bytes, preventing any data loss or percentage drop!
	activeCount := 0
	for _, c := range tc.State.Chunks {
		if c.GetStatus() == StatusDownloading {
			activeCount++
			if activeCount > newCount {
				c.SetStatus(StatusPending)
				tc.cancelWorker(c)
			}
		}
	}

	// When increasing threads and we have fewer chunks than threads, split largest chunk to utilize available threads
	if newCount > len(tc.State.Chunks) && tc.State.TotalSize > 0 {
		diff := newCount - len(tc.State.Chunks)
		for i := 0; i < diff; i++ {
			tc.splitLargestChunk()
		}
	}

	tc.State.mu.Unlock()

	tc.triggerWorkerCheck()
	go tc.saveCheckpoint()

	// Real-time notification to frontend so UI thread table updates immediately
	tc.emitCurrentProgress()
}

func (tc *TaskController) getEffectiveSpeedLimitLocked() *int64 {
	if tc.limiter != nil && tc.limiter.IsExplicit() {
		return tc.State.SpeedLimit
	}

	cfg := GetEngineConfig()
	if cfg.GlobalSpeedLimiter && cfg.GlobalSpeedLimit > 0 {
		limit := cfg.GlobalSpeedLimit
		return &limit
	}

	return nil
}

func (tc *TaskController) getEffectiveSpeedLimit() *int64 {
	tc.State.mu.RLock()
	defer tc.State.mu.RUnlock()
	return tc.getEffectiveSpeedLimitLocked()
}

func (tc *TaskController) emitCurrentProgress() {
	tc.State.mu.RLock()
	status := tc.State.Status
	totalSize := tc.State.TotalSize
	taskID := tc.State.ID
	threadCount := tc.State.ThreadCount

	var totalDownloaded int64
	chunkPayloads := make([]ChunkPayload, 0, len(tc.State.Chunks))
	for _, c := range tc.State.Chunks {
		id, start, cur, end, st := c.Snapshot()
		dl := cur - start
		total := end - start + 1
		if end <= 0 || total < 0 {
			total = 0
		}
		totalDownloaded += dl
		chunkPayloads = append(chunkPayloads, ChunkPayload{
			ID:         id,
			Status:     st,
			Downloaded: dl,
			Total:      total,
		})
	}

	resumeSupportStr := "No"
	if tc.State.Resumable {
		resumeSupportStr = "Yes"
	}

	payload := ProgressPayload{
		ID:              taskID,
		TaskID:          taskID,
		Filename:        tc.State.Filename,
		SavePath:        tc.State.SavePath,
		Status:          status,
		DownloadedBytes: totalDownloaded,
		Downloaded:      totalDownloaded,
		TotalBytes:      totalSize,
		TotalSize:       totalSize,
		ThreadCount:     threadCount,
		Speed:           tc.speedEMA,
		SpeedLimit:      tc.getEffectiveSpeedLimitLocked(),
		ETA:             0,
		ProxyUsed:       GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
		Chunks:          chunkPayloads,
		Resumable:       tc.State.Resumable,
		ResumeSupport:   resumeSupportStr,
	}
	tc.State.mu.RUnlock()

	if application.Get() != nil {
		application.Get().Event.Emit("download-progress", payload)
	}
	if OnProgressUpdate != nil {
		OnProgressUpdate(taskID, tc.State.Filename, totalDownloaded, totalSize)
	}
}

func (tc *TaskController) splitLargestChunk() bool {
	var largestChunk *ChunkState
	var maxRemaining int64 = 0

	for _, c := range tc.State.Chunks {
		if c.GetStatus() == StatusDownloading || c.GetStatus() == StatusPending {
			remaining := c.GetEndByte() - c.GetCurrentByte()
			if remaining > maxRemaining {
				maxRemaining = remaining
				largestChunk = c
			}
		}
	}

	// Only split if reasonable size left (>= 256KB)
	if largestChunk != nil && maxRemaining >= 256*1024 {
		cur := largestChunk.GetCurrentByte()
		end := largestChunk.GetEndByte()
		midPoint := cur + (end-cur)/2

		newChunk := &ChunkState{
			ID:          len(tc.State.Chunks),
			StartByte:   midPoint + 1,
			CurrentByte: midPoint + 1,
			EndByte:     end,
			Status:      StatusPending,
		}

		largestChunk.SetEndByte(midPoint)
		tc.State.Chunks = append(tc.State.Chunks, newChunk)

		// Keep chunks sorted by StartByte and re-index IDs
		sort.Slice(tc.State.Chunks, func(i, j int) bool {
			return tc.State.Chunks[i].StartByte < tc.State.Chunks[j].StartByte
		})
		for idx, chk := range tc.State.Chunks {
			chk.ID = idx
		}
		go tc.saveCheckpoint()
		return true
	}
	return false
}

func (tc *TaskController) progressEmitter() {
	ticker := time.NewTicker(GetProgressInterval())
	defer ticker.Stop()

	var lastDownloaded int64 = -1
	lastTime := time.Now()
	lastCheckpointTime := time.Now()

	for {
		select {
		case <-tc.ctx.Done():
			return
		case <-ticker.C:
			tc.State.mu.RLock()
			status := tc.State.Status
			totalSize := tc.State.TotalSize
			taskID := tc.State.ID

			if status == StatusFinished || status == StatusError {
				tc.State.mu.RUnlock()
				return
			}

			var totalDownloaded int64
			chunkPayloads := make([]ChunkPayload, 0, len(tc.State.Chunks))
			for _, c := range tc.State.Chunks {
				id, start, cur, end, st := c.Snapshot()
				dl := cur - start
				total := end - start + 1
				if end <= 0 || total < 0 {
					total = 0
				}
				totalDownloaded += dl
				chunkPayloads = append(chunkPayloads, ChunkPayload{
					ID:         id,
					Status:     st,
					Downloaded: dl,
					Total:      total,
				})
			}
			tc.State.mu.RUnlock()

			now := time.Now()
			duration := now.Sub(lastTime).Seconds()

			// Update speed moving average over 0.5s window for faster and smoother response
			if duration >= 0.5 {
				if lastDownloaded != -1 && totalDownloaded >= lastDownloaded && duration > 0 {
					instantSpeed := float64(totalDownloaded-lastDownloaded) / duration
					if instantSpeed >= 0 {
						if tc.speedEMA <= 0 {
							tc.speedEMA = instantSpeed
						} else {
							tc.speedEMA = (instantSpeed * 0.3) + (tc.speedEMA * 0.7)
						}
					}
				} else if totalDownloaded < lastDownloaded {
					lastDownloaded = totalDownloaded
				}
				lastDownloaded = totalDownloaded
				lastTime = now
			}

			// Periodic checkpoint flush to OS app storage every 500 milliseconds
			if now.Sub(lastCheckpointTime).Milliseconds() >= 500 {
				tc.saveCheckpoint()
				lastCheckpointTime = now
			}

			var eta float64
			if tc.speedEMA > 0 && totalSize > totalDownloaded {
				eta = float64(totalSize-totalDownloaded) / tc.speedEMA
			}

			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}

			payload := ProgressPayload{
				ID:               taskID,
				TaskID:           taskID,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Status:           status,
				DownloadedBytes:  totalDownloaded,
				Downloaded:       totalDownloaded,
				TotalBytes:       totalSize,
				TotalSize:        totalSize,
				ThreadCount:      tc.State.ThreadCount,
				Speed:            tc.speedEMA,
				SpeedLimit:       tc.getEffectiveSpeedLimitLocked(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              eta,
				Chunks:           chunkPayloads,
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
				ProxyUsed:        GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
			}

			if application.Get() != nil {
				application.Get().Event.Emit("download-progress", payload)
			}
			if OnProgressUpdate != nil {
				OnProgressUpdate(taskID, tc.State.Filename, totalDownloaded, totalSize)
			}
		}
	}
}

func (tc *TaskController) changeStatus(s DownloadStatus) {
	tc.State.mu.Lock()
	tc.State.Status = s
	tc.State.mu.Unlock()
}

func (tc *TaskController) changeStatusWithError(s DownloadStatus, err error) {
	tc.State.mu.Lock()
	tc.State.Status = s
	if err != nil {
		tc.State.ErrorMessage = err.Error()
	}
	tc.State.mu.Unlock()
}

func (tc *TaskController) finalizeDownload() {
	tc.workers.Wait()

	tc.State.mu.RLock()
	chunks := tc.State.Chunks
	totalSize := tc.State.TotalSize
	tc.State.mu.RUnlock()

	if len(chunks) == 0 {
		tc.changeStatusWithError(StatusError, fmt.Errorf("cannot finalize download: no chunks configured"))
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": "cannot finalize download: no chunks configured"})
		}
		tc.cancel()
		return
	}

	// Strict verification: ensure every chunk completed its range and calculate cumulative downloaded
	var actualDownloaded int64 = 0
	for _, c := range chunks {
		_, start, cur, end, status := c.Snapshot()
		if cur > start {
			actualDownloaded += (cur - start)
		}
		if status != StatusFinished || (end > 0 && cur <= end) {
			log.Printf("[TaskController] finalizeDownload rejected: chunk not finished (status=%s, cur=%d, end=%d)", status, cur, end)
			if tc.targetFile != nil {
				_ = tc.targetFile.Sync()
				_ = tc.targetFile.Close()
				tc.targetFile = nil
			}
			tc.changeStatusWithError(StatusError, fmt.Errorf("download verification failed: incomplete chunk data"))
			tc.emitCurrentProgress()
			if application.Get() != nil {
				application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": "download verification failed: incomplete chunk data"})
			}
			tc.cancel()
			return
		}
	}

	if totalSize > 0 && actualDownloaded < totalSize {
		log.Printf("[TaskController] finalizeDownload rejected: total downloaded %d < total size %d", actualDownloaded, totalSize)
		if tc.targetFile != nil {
			_ = tc.targetFile.Sync()
			_ = tc.targetFile.Close()
			tc.targetFile = nil
		}
		tc.changeStatusWithError(StatusError, fmt.Errorf("download verification failed: received %d of %d bytes", actualDownloaded, totalSize))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": fmt.Sprintf("received %d of %d bytes", actualDownloaded, totalSize)})
		}
		tc.cancel()
		return
	}

	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
		_ = tc.targetFile.Close()
		tc.targetFile = nil
	}

	// Instant atomic rename from .thunderdm to final destination
	tempPath := tc.State.TempFilePath
	destPath := tc.State.DestFilePath

	// Validate container on disk before renaming
	if fi, err := os.Stat(tempPath); err != nil || (totalSize > 0 && fi.Size() < totalSize) {
		var currentSize int64 = 0
		if fi != nil {
			currentSize = fi.Size()
		}
		tc.changeStatusWithError(StatusError, fmt.Errorf("cannot finalize: container size mismatch (expected %d bytes, got %d)", totalSize, currentSize))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": fmt.Sprintf("container size mismatch (expected %d bytes, got %d)", totalSize, currentSize)})
		}
		tc.cancel()
		return
	}

	// Remove destination if it already exists to ensure rename succeeds
	_ = os.Remove(destPath)
	if err := os.Rename(tempPath, destPath); err != nil {
		tc.changeStatusWithError(StatusError, fmt.Errorf("failed to finalize download file: %w", err))
		tc.emitCurrentProgress()
		if application.Get() != nil {
			application.Get().Event.Emit("download-error", map[string]interface{}{"task_id": tc.State.ID, "id": tc.State.ID, "error": err.Error()})
		}
		tc.cancel()
		return
	}

	// Apply Server's Last-Modified timestamp to local file if enabled
	if GetEngineConfig().UseServersLastModified && !tc.State.LastModified.IsZero() {
		_ = os.Chtimes(destPath, tc.State.LastModified, tc.State.LastModified)
	}

	// Clean up checkpoint metadata from OS local app storage upon successful completion
	tc.cleanupCheckpoint()

	tc.changeStatus(StatusFinished)

	finalDL := totalSize
	if finalDL <= 0 {
		finalDL = actualDownloaded
	}

	if application.Get() != nil {
		resumeSupportStr := "No"
		if tc.State.Resumable {
			resumeSupportStr = "Yes"
		}
		application.Get().Event.Emit("download-progress", ProgressPayload{
			ID:               tc.State.ID,
			TaskID:           tc.State.ID,
			Filename:         tc.State.Filename,
			SavePath:         tc.State.SavePath,
			Status:           StatusFinished,
			DownloadedBytes:  finalDL,
			Downloaded:       finalDL,
			TotalBytes:       tc.State.TotalSize,
			TotalSize:        tc.State.TotalSize,
			ThreadCount:      tc.State.ThreadCount,
			Speed:            0,
			SpeedLimit:       tc.getEffectiveSpeedLimit(),
			GivenCheckSum:    tc.State.GivenCheckSum,
			ExpectedChecksum: tc.State.ExpectedChecksum,
			ETA:              0,
			Resumable:        tc.State.Resumable,
			ResumeSupport:    resumeSupportStr,
		})
	}

	payload := map[string]interface{}{
		"id":                tc.State.ID,
		"task_id":           tc.State.ID,
		"filename":          tc.State.Filename,
		"save_path":         tc.State.SavePath,
		"dest_file_path":    tc.State.DestFilePath,
		"filePath":          tc.State.DestFilePath,
		"total_size":        tc.State.TotalSize,
		"total_bytes":       tc.State.TotalSize,
		"downloaded":        finalDL,
		"downloaded_bytes":  finalDL,
		"status":            StatusFinished,
		"given_checksum":    tc.State.GivenCheckSum,
		"givenCheckSum":     tc.State.GivenCheckSum,
		"expected_checksum": tc.State.ExpectedChecksum,
		"expectedChecksum":  tc.State.ExpectedChecksum,
		"showCompletion":    tc.State.ShowCompletion,
	}

	LatestDownloadCompletedPayload = payload

	if OnDownloadCompleted != nil {
		OnDownloadCompleted(payload)
	}

	tc.cancel()
}

func (tc *TaskController) Pause() error {
	tc.State.mu.RLock()
	st := tc.State.Status
	tc.State.mu.RUnlock()
	if st == StatusFinished || st == StatusError || st == StatusCanceled || st == StatusPaused {
		return nil
	}

	tc.cancel()
	tc.changeStatus(StatusPaused)

	// Wait for workers to cleanly stop writing
	tc.workers.Wait()

	// Gracefully reset all non-finished chunks to StatusPending
	tc.State.mu.Lock()
	for _, c := range tc.State.Chunks {
		if c.GetStatus() != StatusFinished {
			c.SetStatus(StatusPending)
		}
	}
	tc.State.mu.Unlock()

	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
	}

	// Save final checkpoint to OS local app storage on pause
	tc.saveCheckpoint()

	if application.Get() != nil {
		state := tc.GetState()
		if state != nil {
			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}
			application.Get().Event.Emit("download-progress", ProgressPayload{
				ID:               tc.State.ID,
				TaskID:           tc.State.ID,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Status:           StatusPaused,
				DownloadedBytes:  state["downloaded"].(int64),
				Downloaded:       state["downloaded"].(int64),
				TotalBytes:       state["total_size"].(int64),
				TotalSize:        state["total_size"].(int64),
				ThreadCount:      tc.State.ThreadCount,
				Speed:            0,
				SpeedLimit:       tc.getEffectiveSpeedLimit(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              0,
				Chunks:           state["chunks"].([]ChunkPayload),
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
			})
		}
	}
	return nil
}

func (tc *TaskController) Cancel() error {
	tc.State.mu.RLock()
	st := tc.State.Status
	tc.State.mu.RUnlock()
	if st == StatusFinished {
		return nil
	}

	tc.cancel()
	tc.changeStatus(StatusCanceled)

	if tc.targetFile != nil {
		_ = tc.targetFile.Sync()
		_ = tc.targetFile.Close()
		tc.targetFile = nil
	}

	if application.Get() != nil {
		state := tc.GetState()
		if state != nil {
			resumeSupportStr := "No"
			if tc.State.Resumable {
				resumeSupportStr = "Yes"
			}
			application.Get().Event.Emit("download-progress", ProgressPayload{
				ID:               tc.State.ID,
				TaskID:           tc.State.ID,
				Filename:         tc.State.Filename,
				SavePath:         tc.State.SavePath,
				Status:           StatusCanceled,
				DownloadedBytes:  state["downloaded"].(int64),
				Downloaded:       state["downloaded"].(int64),
				TotalBytes:       state["total_size"].(int64),
				TotalSize:        state["total_size"].(int64),
				Speed:            0,
				SpeedLimit:       tc.getEffectiveSpeedLimit(),
				GivenCheckSum:    tc.State.GivenCheckSum,
				ExpectedChecksum: tc.State.ExpectedChecksum,
				ETA:              0,
				Resumable:        tc.State.Resumable,
				ResumeSupport:    resumeSupportStr,
			})
		}
	}

	// Delete partial files & clean up checkpoint ONLY IF enabled
	if GetEngineConfig().DeletePartialOnFileCancel {
		tc.cleanupCheckpoint()
		if tc.State.TempFilePath != "" {
			_ = os.Remove(tc.State.TempFilePath)
		}
		if tc.State.CacheDir != "" {
			_ = os.RemoveAll(tc.State.CacheDir)
		}
	} else {
		// When keeping partial files on cancel, save the current checkpoint so it can be resumed
		tc.saveCheckpoint()
	}
	return nil
}

func (tc *TaskController) GetState() map[string]interface{} {
	tc.State.mu.RLock()
	defer tc.State.mu.RUnlock()

	var totalDownloaded int64
	var chunkPayloads []ChunkPayload
	for _, c := range tc.State.Chunks {
		id, start, cur, end, st := c.Snapshot()
		dl := cur - start
		total := end - start + 1
		if end <= 0 || total < 0 {
			total = 0
		}
		totalDownloaded += dl
		chunkPayloads = append(chunkPayloads, ChunkPayload{
			ID:         id,
			Status:     st,
			Downloaded: dl,
			Total:      total,
		})
	}

	resumeSupportStr := "No"
	if tc.State.Resumable {
		resumeSupportStr = "Yes"
	}

	return map[string]interface{}{
		"id":                tc.State.ID,
		"task_id":           tc.State.ID,
		"status":            tc.State.Status,
		"downloaded":        totalDownloaded,
		"downloaded_bytes":  totalDownloaded,
		"total_size":        tc.State.TotalSize,
		"total_bytes":       tc.State.TotalSize,
		"url":               tc.State.URL,
		"filename":          tc.State.Filename,
		"save_path":         tc.State.SavePath,
		"error_message":     tc.State.ErrorMessage,
		"thread_count":      tc.State.ThreadCount,
		"given_checksum":    tc.State.GivenCheckSum,
		"givenCheckSum":     tc.State.GivenCheckSum,
		"expected_checksum": tc.State.ExpectedChecksum,
		"expectedChecksum":  tc.State.ExpectedChecksum,
		"chunks":            chunkPayloads,
		"is_hls":            false,
		"speed_limit":       tc.getEffectiveSpeedLimit(),
		"resumable":         tc.State.Resumable,
		"resume_support":    resumeSupportStr,
		"accept_ranges":     tc.State.Resumable,
		"proxy_used":        GetProxyManager().GetActiveProxyLabelForURL(tc.State.URL),
	}
}
