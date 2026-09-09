package window

type DownloadCompletedPayload struct {
	TaskID   string `json:"taskId"`
	URL      string `json:"url"`
	FilePath string `json:"filePath"`
	FileSize int64  `json:"fileSize"`
}
