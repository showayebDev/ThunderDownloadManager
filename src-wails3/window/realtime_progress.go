package window

import (
	"ThunderDM/src-wails3/downloader"
)

type RealtimeProgressPayload struct {
	TaskID          string                   `json:"taskId"`
	BytesDownloaded int64                    `json:"bytesDownloaded"`
	TotalBytes      int64                    `json:"totalBytes"`
	SpeedBytesSec   float64                  `json:"speedBytesSec"`
	State           string                   `json:"state"`
	Chunks          []*downloader.ChunkState `json:"chunks"`
}
