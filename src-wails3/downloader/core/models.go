package core

import (
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader/proxy"
)

type DownloadStatus string

const (
	StatusPending     DownloadStatus = "Pending"
	StatusDownloading DownloadStatus = "Downloading"
	StatusPaused      DownloadStatus = "Paused"
	StatusMerging     DownloadStatus = "Merging"
	StatusFinished    DownloadStatus = "Finished"
	StatusCanceled    DownloadStatus = "Canceled"
	StatusError       DownloadStatus = "Error"
)

// SharedHTTPClient provides a high-throughput, connection-pooled HTTP client for all download workers.
var SharedHTTPClient = proxy.SharedHTTPClient

type ChunkState struct {
	ID          int
	StartByte   int64
	CurrentByte int64
	EndByte     int64
	Status      DownloadStatus
	RetryCount  int
	mu          sync.RWMutex
}

func (c *ChunkState) GetStartByte() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.StartByte
}

func (c *ChunkState) GetEndByte() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.EndByte
}

func (c *ChunkState) SetEndByte(val int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.EndByte = val
}

func (c *ChunkState) GetCurrentByte() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.CurrentByte
}

func (c *ChunkState) SetCurrentByte(val int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.CurrentByte = val
}

func (c *ChunkState) GetStatus() DownloadStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Status
}

func (c *ChunkState) SetStatus(status DownloadStatus) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Status = status
}

func (c *ChunkState) GetRetryCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.RetryCount
}

func (c *ChunkState) SetRetryCount(count int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RetryCount = count
}

func (c *ChunkState) IncrementRetryCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RetryCount++
	return c.RetryCount
}

func (c *ChunkState) ResetRetryCount() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RetryCount = 0
}

func (c *ChunkState) Snapshot() (id int, start, cur, end int64, status DownloadStatus) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ID, c.StartByte, c.CurrentByte, c.EndByte, c.Status
}

type TaskRunner interface {
	Start()
	Pause() error
	Cancel() error
	UpdateThreadCount(threads int)
	UpdateSpeedLimit(speedLimit *int64)
	GetState() map[string]interface{}
}

type TaskState struct {
	ID                string
	URL               string
	SavePath          string
	Filename          string
	TempFilePath      string
	DestFilePath      string
	TotalSize         int64
	ThreadCount       int
	SpeedLimit        *int64
	GivenCheckSum     string
	ExpectedChecksum  string
	AuthUsername      string
	AuthPassword      string
	UserAgent         string
	Referer           string
	Cookies           string
	ForceCookie       bool
	Status            DownloadStatus
	ErrorMessage      string
	RetryCount        int
	Chunks            []*ChunkState
	CacheDir          string
	IsHLS             bool
	TotalSegments     int
	CompletedSegments int
	Duration          float64
	Protocol          string
	Resumable         bool
	ShowCompletion    bool
	LastModified      time.Time
	Mu                sync.RWMutex
}

func (ts *TaskState) Lock() {
	ts.Mu.Lock()
}

func (ts *TaskState) Unlock() {
	ts.Mu.Unlock()
}

func (ts *TaskState) RLock() {
	ts.Mu.RLock()
}

func (ts *TaskState) RUnlock() {
	ts.Mu.RUnlock()
}

type ChunkPayload struct {
	ID         int            `json:"id"`
	Status     DownloadStatus `json:"status"`
	Downloaded int64          `json:"downloaded"`
	Total      int64          `json:"total"`
}

type ProgressPayload struct {
	ID               string         `json:"id"`
	TaskID           string         `json:"task_id"`
	URL              string         `json:"url,omitempty"`
	Filename         string         `json:"filename,omitempty"`
	SavePath         string         `json:"save_path,omitempty"`
	Status           DownloadStatus `json:"status"`
	DownloadedBytes  int64          `json:"downloaded_bytes"`
	Downloaded       int64          `json:"downloaded"`
	TotalBytes       int64          `json:"total_bytes"`
	TotalSize        int64          `json:"total_size"`
	Speed            float64        `json:"speed"` // Bytes per second
	SpeedLimit       *int64         `json:"speed_limit,omitempty"`
	ThreadCount      int            `json:"thread_count,omitempty"`
	GivenCheckSum    string         `json:"given_checksum,omitempty"`
	ExpectedChecksum string         `json:"expected_checksum,omitempty"`
	ETA              float64        `json:"eta"` // Seconds
	Protocol         string         `json:"protocol,omitempty"`
	IsYTDLP          bool           `json:"is_ytdlp,omitempty"`
	IsTorrent        bool           `json:"is_torrent,omitempty"`
	IsHLS            bool           `json:"is_hls,omitempty"`
	Resumable        bool           `json:"resumable"`
	ResumeSupport    string         `json:"resume_support,omitempty"`
	ProxyUsed        string         `json:"proxy_used,omitempty"`
	ErrorMessage     string         `json:"error_message,omitempty"`
	Error            string         `json:"error,omitempty"`
	RetryAttempt     int            `json:"retry_attempt,omitempty"`
	MaxRetries       int            `json:"max_retries,omitempty"`
	Chunks           []ChunkPayload `json:"chunks"`
}

type CompletedWindowPayload struct {
	TaskID     string `json:"task_id"`
	Filename   string `json:"filename"`
	SavePath   string `json:"save_path"`
	TotalSize  int64  `json:"total_size"`
	Downloaded int64  `json:"downloaded"`
}

type ActiveTaskInfo struct {
	ID       string
	Filename string
	Progress int
	Status   DownloadStatus
}

var LatestDownloadCompletedPayload map[string]interface{}
var OnDownloadCompleted func(payload map[string]interface{})
var OnProgressUpdate func(taskId string, filename string, downloaded int64, totalSize int64)

// EmitProgressUpdate notifies the registered OnProgressUpdate callback if set.
func EmitProgressUpdate(taskId, filename string, dl, total int64) {
	if OnProgressUpdate != nil {
		OnProgressUpdate(taskId, filename, dl, total)
	}
}

// EmitDownloadCompleted updates LatestDownloadCompletedPayload and notifies OnDownloadCompleted if set.
func EmitDownloadCompleted(payload map[string]interface{}) {
	LatestDownloadCompletedPayload = payload
	if OnDownloadCompleted != nil {
		OnDownloadCompleted(payload)
	}
}
