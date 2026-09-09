package window

type DownloadConfirmationPayload struct {
	URL           string `json:"url"`
	SuggestedName string `json:"suggestedName"`
	FileSize      int64  `json:"fileSize"`
	MimeType      string `json:"mimeType"`
}
