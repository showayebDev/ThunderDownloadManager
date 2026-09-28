// task_checkpoint.go manages persistence, restoration, and cleanup of HTTP download
// checkpoints (.meta files) so multi-threaded downloads can resume seamlessly across restarts.
package httptask

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"

	"ThunderDM/src-wails3/downloader/core"
)

// TaskCheckpoint stores serialized task metadata and chunk byte ranges for crash-safe resume.
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
	ForceCookie      bool              `json:"force_cookie,omitempty"`
	Chunks           []ChunkCheckpoint `json:"chunks"`
	UpdatedAt        int64             `json:"updated_at"`
}

// ChunkCheckpoint stores the byte range and status of a single download chunk.
type ChunkCheckpoint struct {
	ID          int                 `json:"id"`
	StartByte   int64               `json:"start_byte"`
	CurrentByte int64               `json:"current_byte"`
	EndByte     int64               `json:"end_byte"`
	Status      core.DownloadStatus `json:"status"`
}

// CheckpointPath returns the primary checkpoint path for the task.
func (tc *TaskController) CheckpointPath() string {
	return core.GetTaskMetaFilePath(tc.State.ID)
}

func (tc *TaskController) secondaryCheckpointPath() string {
	return core.GetTaskMetaPathByDest(tc.State.DestFilePath)
}

func (tc *TaskController) legacyCheckpointPath() string {
	if tc.State.TempFilePath != "" {
		return tc.State.TempFilePath + ".meta"
	}
	return ""
}

// CleanupCheckpoint removes all primary, secondary, and legacy checkpoint files for the task.
func (tc *TaskController) CleanupCheckpoint() {
	_ = os.Remove(tc.CheckpointPath())
	if sec := tc.secondaryCheckpointPath(); sec != "" {
		_ = os.Remove(sec)
	}
	if leg := tc.legacyCheckpointPath(); leg != "" {
		_ = os.Remove(leg)
	}
}

// saveCheckpointLocked serializes and writes the task's current chunk states to disk.
// Caller must hold at least a read lock on tc.State.Mu.
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

	metaPath := tc.CheckpointPath()
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

// SaveCheckpoint acquires a read lock on task state and writes the checkpoint to disk.
func (tc *TaskController) SaveCheckpoint() {
	tc.State.Mu.RLock()
	defer tc.State.Mu.RUnlock()
	tc.saveCheckpointLocked()
}

// loadCheckpoint attempts to restore chunk states from primary, secondary, or legacy checkpoint files.
// Caller must hold tc.State.Mu lock.
func (tc *TaskController) loadCheckpoint() bool {
	pathsToTry := []string{
		tc.CheckpointPath(),
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
	if err := json.Unmarshal(data, &meta); err != nil || len(meta.Chunks) == 0 {
		return false
	}

	if tc.State.TotalSize > 0 && meta.TotalSize > 0 && meta.TotalSize != tc.State.TotalSize {
		return false
	}

	restoreSavedCredentialsAndHeaders(tc.State, &meta)
	restoreSavedChecksums(tc.State, &meta)

	if meta.SpeedLimit != nil && *meta.SpeedLimit > 0 {
		tc.State.SpeedLimit = meta.SpeedLimit
		tc.limiter.SetLimit(*meta.SpeedLimit)
	}

	targetThreadCount := resolveCheckpointThreadCount(tc.State.ThreadCount, meta.ThreadCount, len(meta.Chunks))
	tc.State.ThreadCount = targetThreadCount
	tc.State.Chunks = make([]*core.ChunkState, 0, len(meta.Chunks))

	for _, cp := range meta.Chunks {
		st := cp.Status
		if cp.EndByte > 0 && cp.CurrentByte <= cp.EndByte {
			st = core.StatusPending
		} else if cp.EndByte > 0 && cp.CurrentByte > cp.EndByte {
			st = core.StatusFinished
		} else if st == core.StatusDownloading || st == core.StatusError {
			st = core.StatusPending
		}

		chunk := &core.ChunkState{
			ID:          cp.ID,
			StartByte:   cp.StartByte,
			CurrentByte: cp.CurrentByte,
			EndByte:     cp.EndByte,
			Status:      st,
		}
		tc.State.Chunks = append(tc.State.Chunks, chunk)
	}

	// Sort chunks by StartByte, consolidate excess unstarted chunks, and normalize IDs
	if len(tc.State.Chunks) > 0 {
		sort.Slice(tc.State.Chunks, func(i, j int) bool {
			return tc.State.Chunks[i].StartByte < tc.State.Chunks[j].StartByte
		})

		if len(tc.State.Chunks) > targetThreadCount {
			tc.State.Chunks = consolidateExcessChunks(tc.State.Chunks, targetThreadCount)
		}

		for idx, chk := range tc.State.Chunks {
			chk.ID = idx
		}
	}

	// If the user requested more threads than existing chunks, split the largest uncompleted chunks
	if targetThreadCount > len(tc.State.Chunks) && tc.State.TotalSize > 0 {
		diff := targetThreadCount - len(tc.State.Chunks)
		for i := 0; i < diff; i++ {
			if !tc.SplitLargestChunk() {
				break
			}
		}
	}

	return true
}

func restoreSavedCredentialsAndHeaders(state *core.TaskState, meta *TaskCheckpoint) {
	if meta.AuthUsername != "" && state.AuthUsername == "" {
		state.AuthUsername = meta.AuthUsername
	}
	if meta.AuthPassword != "" && state.AuthPassword == "" {
		state.AuthPassword = meta.AuthPassword
	}
	if meta.UserAgent != "" && state.UserAgent == "" {
		state.UserAgent = meta.UserAgent
	}
	if meta.Referer != "" && state.Referer == "" {
		state.Referer = meta.Referer
	}
	if meta.Cookies != "" && state.Cookies == "" {
		state.Cookies = meta.Cookies
	}
}

func restoreSavedChecksums(state *core.TaskState, meta *TaskCheckpoint) {
	if meta.GivenCheckSum != "" {
		state.GivenCheckSum = meta.GivenCheckSum
	}
	if meta.ExpectedChecksum != "" {
		state.ExpectedChecksum = meta.ExpectedChecksum
	}
	if state.GivenCheckSum == "" && state.ExpectedChecksum != "" {
		state.GivenCheckSum = state.ExpectedChecksum
	}
	if state.ExpectedChecksum == "" && state.GivenCheckSum != "" {
		state.ExpectedChecksum = state.GivenCheckSum
	}
}

func resolveCheckpointThreadCount(current, saved, numChunks int) int {
	if current > 0 {
		return current
	}
	if saved > 0 {
		return saved
	}
	if numChunks > 0 {
		return numChunks
	}
	if def := core.GetEngineConfig().DefaultThreadCount; def > 0 {
		return def
	}
	return 8
}

func consolidateExcessChunks(chunks []*core.ChunkState, targetThreadCount int) []*core.ChunkState {
	consolidated := make([]*core.ChunkState, 0, len(chunks))
	for i := 0; i < len(chunks); i++ {
		c := chunks[i]
		// Merge adjacent pending chunks that have 0 bytes downloaded
		for len(consolidated) > 0 &&
			c.CurrentByte == c.StartByte &&
			c.Status == core.StatusPending &&
			(len(chunks)-i+len(consolidated)) > targetThreadCount {
			prev := consolidated[len(consolidated)-1]
			if prev.EndByte+1 == c.StartByte && (prev.Status == core.StatusPending || prev.Status == core.StatusDownloading) {
				prev.EndByte = c.EndByte
				c = nil
				break
			}
			break
		}
		if c != nil {
			consolidated = append(consolidated, c)
		}
	}
	return consolidated
}
