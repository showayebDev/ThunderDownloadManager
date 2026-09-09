package downloader

import (
	"crypto/tls"
	"net"
	"net/http"
	neturl "net/url"
	"sync"
	"time"
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
var SharedHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy: func(req *http.Request) (*neturl.URL, error) {
			if GlobalProxyManager != nil {
				return GlobalProxyManager.GetProxyForURL(req.URL)
			}
			return nil, nil
		},
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        256,
		MaxIdleConnsPerHost: 128, // Allows up to 128 concurrent connections per host
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // Allow self-signed or internal movie server certificates
		},
	},
}

type ChunkState struct {
	ID          int
	StartByte   int64
	CurrentByte int64
	EndByte     int64
	Status      DownloadStatus
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
	Status            DownloadStatus
	ErrorMessage      string
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
	mu                sync.RWMutex
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
	ETA              float64        `json:"eta"`   // Seconds
	Protocol         string         `json:"protocol,omitempty"`
	IsYTDLP          bool           `json:"is_ytdlp,omitempty"`
	Resumable        bool           `json:"resumable"`
	ResumeSupport    string         `json:"resume_support,omitempty"`
	ProxyUsed        string         `json:"proxy_used,omitempty"`
	ErrorMessage     string         `json:"error_message,omitempty"`
	Error            string         `json:"error,omitempty"`
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
