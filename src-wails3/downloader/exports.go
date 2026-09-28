// exports.go provides a backward-compatible facade for ThunderDM/src-wails3/downloader,
// re-exporting types, constants, and functions from the category sub-packages:
//   - downloader/core
//   - downloader/http
//   - downloader/hls
//   - downloader/ytdlp
//   - downloader/torrent
//   - downloader/proxy
//   - downloader/limiter
//   - downloader/sys
package downloader

import (
	"context"

	"ThunderDM/src-wails3/downloader/core"
	"ThunderDM/src-wails3/downloader/hls"
	httptask "ThunderDM/src-wails3/downloader/http"
	"ThunderDM/src-wails3/downloader/limiter"
	"ThunderDM/src-wails3/downloader/proxy"
	"ThunderDM/src-wails3/downloader/sys"
	"ThunderDM/src-wails3/downloader/torrent"
	"ThunderDM/src-wails3/downloader/ytdlp"
)

// Core Models & Status Constants
type (
	DownloadStatus         = core.DownloadStatus
	ChunkState             = core.ChunkState
	TaskRunner             = core.TaskRunner
	TaskState              = core.TaskState
	ChunkPayload           = core.ChunkPayload
	ProgressPayload        = core.ProgressPayload
	CompletedWindowPayload = core.CompletedWindowPayload
	ActiveTaskInfo         = core.ActiveTaskInfo
	CookieBypassRule       = core.CookieBypassRule
	EngineConfig           = core.EngineConfig
	VaultItem              = core.VaultItem
	DownloadExtraOptions   = core.DownloadExtraOptions
)

const (
	StatusPending     = core.StatusPending
	StatusDownloading = core.StatusDownloading
	StatusPaused      = core.StatusPaused
	StatusMerging     = core.StatusMerging
	StatusFinished    = core.StatusFinished
	StatusCanceled    = core.StatusCanceled
	StatusError       = core.StatusError
)

// Protocol Task Controllers & Types
type (
	TaskController        = httptask.TaskController
	TaskCheckpoint        = httptask.TaskCheckpoint
	ChunkCheckpoint       = httptask.ChunkCheckpoint
	HLSTaskController     = hls.HLSTaskController
	HLSPlaylist           = hls.HLSPlaylist
	HLSSegment            = hls.HLSSegment
	HLSStreamVariant      = hls.HLSStreamVariant
	HLSSegmentState       = hls.HLSSegmentState
	HLSKeyCache           = hls.HLSKeyCache
	YTDLPTaskController   = ytdlp.YTDLPTaskController
	Client                = ytdlp.Client
	VideoMetadata         = ytdlp.VideoMetadata
	Format                = ytdlp.Format
	DownloadOptions       = ytdlp.DownloadOptions
	UpdateResult          = ytdlp.UpdateResult
	TorrentTaskController = torrent.TorrentTaskController
	TorrentInfo           = torrent.TorrentInfo
)

// Proxy & Rate Limiter Types
type (
	ProxyMode       = proxy.ProxyMode
	ProxyType       = proxy.ProxyType
	ProxyConfig     = proxy.ProxyConfig
	ProxyTestResult = proxy.ProxyTestResult
	ProxyManager    = proxy.ProxyManager
	SpeedLimiter    = limiter.SpeedLimiter
)

const (
	ProxyModeNone   = proxy.ProxyModeNone
	ProxyModeSystem = proxy.ProxyModeSystem
	ProxyModePAC    = proxy.ProxyModePAC
	ProxyModeManual = proxy.ProxyModeManual
	ProxyTypeHTTP   = proxy.ProxyTypeHTTP
	ProxyTypeSOCKS  = proxy.ProxyTypeSOCKS
)

// Shared HTTP Client, Proxy Singleton, and Event Callbacks
var (
	SharedHTTPClient               = core.SharedHTTPClient
	GlobalProxyManager             = proxy.GetProxyManager()
	LatestDownloadCompletedPayload map[string]interface{}
	OnDownloadCompleted            func(payload map[string]interface{})
	OnProgressUpdate               func(taskId string, filename string, downloaded int64, totalSize int64)
)

func init() {
	core.OnProgressUpdate = func(taskId string, filename string, downloaded int64, totalSize int64) {
		if OnProgressUpdate != nil {
			OnProgressUpdate(taskId, filename, downloaded, totalSize)
		}
	}
	core.OnDownloadCompleted = func(payload map[string]interface{}) {
		LatestDownloadCompletedPayload = payload
		if OnDownloadCompleted != nil {
			OnDownloadCompleted(payload)
		}
	}
}

// Core Config, Storage, Vault & Utility Functions
var (
	DefaultEngineConfig           = core.DefaultEngineConfig
	GetEngineConfig               = core.GetEngineConfig
	LoadEngineConfig              = core.LoadEngineConfig
	UpdateEngineConfig            = core.UpdateEngineConfig
	SetProgressFPS                = core.SetProgressFPS
	GetProgressInterval           = core.GetProgressInterval
	ShouldBypassCookies           = core.ShouldBypassCookies
	MatchVaultItem                = core.MatchVaultItem
	GetAppStorageDir              = core.GetAppStorageDir
	GetTaskMetaDir                = core.GetTaskMetaDir
	GetTaskMetaFilePath           = core.GetTaskMetaFilePath
	GetTaskMetaPathByDest         = core.GetTaskMetaPathByDest
	MergeChunks                   = core.MergeChunks
	SanitizeFilename              = core.SanitizeFilename
	CleanMediaTitle               = core.CleanMediaTitle
	NormalizeSavePath             = core.NormalizeSavePath
	ParseDownloadOptions          = core.ParseDownloadOptions
	IsHLSURL                      = core.IsHLSURL
	IsYTDLPURL                    = core.IsYTDLPURL
	IsCookieBrokenHost            = core.IsCookieBrokenHost
	ExtractYTDLPFallbackFilename  = core.ExtractYTDLPFallbackFilename
	IsTorrentURL                  = core.IsTorrentURL
	IsTorrentFile                 = core.IsTorrentFile
	CleanTorrentSource            = core.CleanTorrentSource
	IsIntermediateDownloadFile    = core.IsIntermediateDownloadFile
	ResolveExistingFilePath       = core.ResolveExistingFilePath
)

// Proxy, Limiter & System Functions
var (
	DefaultProxyConfig      = proxy.DefaultProxyConfig
	GetProxyManager         = proxy.GetProxyManager
	OpenSystemProxySettings = proxy.OpenSystemProxySettings
	NewSpeedLimiter         = limiter.NewSpeedLimiter
	LimitReader             = limiter.LimitReader
	ApplySparseFile         = sys.ApplySparseFile
	CheckFreeDiskSpace      = sys.CheckFreeDiskSpace
	PrepareCmd              = sys.PrepareCmd
)

func InitProxyManager() {
	GlobalProxyManager = proxy.GetProxyManager()
}

// Protocol Constructors & Helpers
var (
	NewTaskController                 = httptask.NewTaskController
	DownloadChunk                     = httptask.DownloadChunk
	NewHLSTaskController              = hls.NewHLSTaskController
	FetchAndParseHLS                  = hls.FetchAndParseHLS
	ParseIV                           = hls.ParseIV
	DecryptAES128Segment              = hls.DecryptAES128Segment
	NewYTDLPTaskController            = ytdlp.NewYTDLPTaskController
	NewClient                         = ytdlp.NewClient
	GetYTDLPExecutable                = ytdlp.GetYTDLPExecutable
	CleanBinDirectory                 = ytdlp.CleanBinDirectory
	UpdateYTDLP                       = ytdlp.UpdateYTDLP
	FetchVideoMetadata                = ytdlp.FetchVideoMetadata
	CleanYTDLPTempFiles               = ytdlp.CleanYTDLPTempFiles
	GetFFmpegExecutable               = ytdlp.GetFFmpegExecutable
	GetFFmpegLocation                 = ytdlp.GetFFmpegLocation
	IsFFmpegInstalled                 = ytdlp.IsFFmpegInstalled
	CheckFFmpegVersion                = ytdlp.CheckFFmpegVersion
	InstallFFmpeg                     = ytdlp.InstallFFmpeg
	EmitMediaToolsProgress            = ytdlp.EmitMediaToolsProgress
	NewTorrentTaskController          = torrent.NewTorrentTaskController
	GetGlobalTorrentClient            = torrent.GetGlobalTorrentClient
	GetGlobalTorrentPieceCompletion   = torrent.GetGlobalTorrentPieceCompletion
	CloseGlobalTorrentPieceCompletion = torrent.CloseGlobalTorrentPieceCompletion
	NewThunderTorrentStorage          = torrent.NewThunderTorrentStorage
	ParseTorrentInfo                  = torrent.ParseTorrentInfo
	ParseTorrentBytes                 = torrent.ParseTorrentBytes
	DownloadTorrentFileToTemp         = torrent.DownloadTorrentFileToTemp
)

// Ensure context import is used
var _ context.Context
