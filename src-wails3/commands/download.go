// Package commands exposes Wails v3 service bindings for download management, window orchestration,
// file operations, queues, and system integration.
//
// This file (download.go) defines the DownloadCommand service and its RPC bindings, delegating
// remote probing to commands/probe and directory link crawling to commands/crawler.
package commands

import (
	"context"
	"log"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"ThunderDM/src-wails3/commands/crawler"
	"ThunderDM/src-wails3/commands/probe"
	"ThunderDM/src-wails3/commands/winmgr"
	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/storage"
	"ThunderDM/src-wails3/utils"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type RemoteFileInfo = probe.RemoteFileInfo
type CrawlPageOptions = crawler.CrawlPageOptions
type ScrapedFileLink = crawler.ScrapedFileLink

type DownloadCommand struct {
	ctx context.Context
	app *application.App
}

func NewDownloadCommand() *DownloadCommand {
	return &DownloadCommand{}
}

func (c *DownloadCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

func (c *DownloadCommand) SetApp(app *application.App) {
	c.app = app
}

func (c *DownloadCommand) FetchFileInfo(urlStr string) (*RemoteFileInfo, error) {
	return probe.FetchFileInfo(urlStr)
}

func (c *DownloadCommand) ProbeFileSizes(urls []string) (map[string]int64, error) {
	return probe.ProbeFileSizes(urls)
}

func (c *DownloadCommand) CrawlPageLinks(rawPayload string) ([]ScrapedFileLink, error) {
	return crawler.CrawlPageLinks(rawPayload)
}

func (c *DownloadCommand) ProcessNewDownload(rawUrl string) error {
	log.Printf("[DownloadCommand] ProcessNewDownload started for URL: %s\n", rawUrl)

	var filename string
	var fileSize int64 = 0
	cleanURL := downloader.CleanTorrentSource(rawUrl)
	isTorrent := downloader.IsTorrentURL(rawUrl) || downloader.IsTorrentFile(rawUrl)
	isYTDLP := !isTorrent && downloader.IsYTDLPURL(cleanURL)
	isHLS := !isTorrent && !isYTDLP && downloader.IsHLSURL(cleanURL)

	// Extract basic filename from URL or local file path first
	parsedUrl, err := url.Parse(cleanURL)
	if isTorrent && downloader.IsTorrentFile(cleanURL) {
		filename = filepath.Base(cleanURL)
	} else if err == nil {
		p := strings.ReplaceAll(parsedUrl.Path, "\\", "/")
		filename = path.Base(p)
		log.Printf("[DownloadCommand] Extracted base filename from URL: %s\n", filename)
	} else {
		cleanPath := strings.ReplaceAll(cleanURL, "\\", "/")
		filename = path.Base(cleanPath)
		log.Printf("[DownloadCommand] Error parsing URL, used path base: %s\n", filename)
	}

	proto := "Auto"
	category := ""

	if isTorrent {
		proto = "Torrent"
		category = "Torrents"
		if tInfo, err := downloader.ParseTorrentInfo(cleanURL); err == nil && tInfo != nil {
			if tInfo.Name != "" {
				filename = tInfo.Name
			}
			if tInfo.TotalSize > 0 {
				fileSize = tInfo.TotalSize
			}
		}
		if filename == "" || filename == "/" || filename == "." || filename == "download" {
			if parsedUrl != nil {
				q := parsedUrl.Query()
				if q.Get("dn") == "" && strings.HasPrefix(parsedUrl.Opaque, "?") {
					q, _ = url.ParseQuery(strings.TrimPrefix(parsedUrl.Opaque, "?"))
				}
				if dn := q.Get("dn"); dn != "" {
					filename = dn
				} else if xt := q.Get("xt"); strings.HasPrefix(xt, "urn:btih:") {
					hash := strings.TrimPrefix(xt, "urn:btih:")
					if len(hash) > 8 {
						filename = "Torrent_" + hash[:8]
					} else {
						filename = "Torrent_" + hash
					}
				} else {
					filename = "Torrent_Download"
				}
			} else {
				filename = "Torrent_Download"
			}
		}
	} else if isYTDLP {
		proto = "Yt-DLP"
		category = "Videos"
		filename = downloader.ExtractYTDLPFallbackFilename(cleanURL)
	} else if filename == "/" || filename == "." || filename == "" {
		if isHLS {
			filename = "video.mp4"
		} else {
			filename = "download"
		}
	} else if isHLS && strings.HasSuffix(strings.ToLower(filename), ".m3u8") {
		// Automatically rename .m3u8 to .mp4 for user convenience
		baseName := strings.TrimSuffix(filename, path.Ext(filename))
		if baseName == "" || baseName == "playlist" || baseName == "master" || baseName == "index" {
			filename = "video.mp4"
		} else {
			filename = baseName + ".mp4"
		}
	}

	filename = downloader.SanitizeFilename(filename)

	if !isTorrent && !isYTDLP {
		if isHLS {
			proto = "HLS"
			category = "Videos"
		} else {
			cat := crawler.DetectCategoryByExt(filename)
			if cat != "Other" && cat != "" {
				category = cat
			} else {
				category = "Documents"
			}
		}
	}

	// Auto-resolve base download path and category folder from engine config
	cfg := downloader.GetEngineConfig()
	baseDownloadPath := cfg.DownloadPath
	if baseDownloadPath == "" {
		home, _ := os.UserHomeDir()
		baseDownloadPath = filepath.Join(home, "Downloads")
	}
	useCategory := cfg.UseCategoryByDefault

	savePath := baseDownloadPath
	if useCategory && category != "" && category != "All" && category != "Other" {
		savePath = filepath.Join(baseDownloadPath, category)
	}
	savePath = downloader.NormalizeSavePath(savePath, category)
	_ = os.MkdirAll(savePath, 0755)
	filename = downloader.GetEngine().ResolveUniqueFilename(savePath, filename)

	payload := map[string]interface{}{
		"url":                  rawUrl,
		"filename":             filename,
		"fileSize":             fileSize,
		"mimeType":             "",
		"protocol":             proto,
		"category":             category,
		"savePath":             savePath,
		"save_path":            savePath,
		"basePath":             baseDownloadPath,
		"useCategory":          useCategory,
		"threadCount":          0,
		"thread_count":         0,
		"defaultThreadCount":   cfg.DefaultThreadCount,
		"default_thread_count": cfg.DefaultThreadCount,
	}
	log.Printf("[DownloadCommand] Final Payload prepared: %+v\n", payload)

	// Open the download confirmation window with the prepared payload
	if c.app != nil {
		log.Println("[DownloadCommand] c.app is not nil, creating window using centralized configuration...")
		OpenDownloadConfirmationWindow(c.app, payload)
	} else {
		log.Println("[DownloadCommand] ERROR: c.app is nil! Cannot open window.")
	}

	return nil
}

func (c *DownloadCommand) Start(id, urlStr, savePath, filename string, threadCount int, speedLimit *int64, protocol *string) error {
	savePath = downloader.NormalizeSavePath(savePath)
	log.Printf("[DownloadCommand] Start called for ID: %s, URL: %s, SavePath: %s, SpeedLimit: %v", id, urlStr, savePath, speedLimit)
	protoStr := ""
	if protocol != nil {
		protoStr = *protocol
	}
	return downloader.GetEngine().AddDownloadWithLimit(id, urlStr, savePath, filename, threadCount, speedLimit, protoStr)
}

func (c *DownloadCommand) Pause(id string) error {
	log.Printf("[DownloadCommand] Pause called for ID: %s", id)
	err := downloader.GetEngine().Pause(id)
	DebouncedRebuildTrayMenuGlobal()
	return err
}

func (c *DownloadCommand) Resume(id, urlStr, savePath, filename string, threadCount int, speedLimit *int64, protocol *string) error {
	protoStr := ""
	if protocol != nil {
		protoStr = *protocol
	}
	// Fallback to existing task state if URL, filename, savePath, or protocol is empty
	if urlStr == "" || filename == "" || savePath == "" || protoStr == "" {
		st := downloader.GetEngine().GetTaskState(id)
		if st != nil {
			if urlStr == "" {
				if u, ok := st["url"].(string); ok && u != "" {
					urlStr = u
				}
			}
			if filename == "" {
				if f, ok := st["filename"].(string); ok && f != "" {
					filename = f
				}
			}
			if savePath == "" {
				if sp, ok := st["save_path"].(string); ok && sp != "" {
					savePath = sp
				}
			}
			if protoStr == "" {
				if p, ok := st["protocol"].(string); ok && p != "" {
					protoStr = p
				}
			}
		}
	}
	savePath = downloader.NormalizeSavePath(savePath)
	log.Printf("[DownloadCommand] Resume called for ID: %s, URL: %s, File: %s, SavePath: %s, SpeedLimit: %v", id, urlStr, filename, savePath, speedLimit)
	return downloader.GetEngine().AddDownloadWithLimit(id, urlStr, savePath, filename, threadCount, speedLimit, protoStr)
}

func (c *DownloadCommand) Cancel(id string) error {
	log.Printf("[DownloadCommand] Cancel called for ID: %s", id)
	if c.app != nil {
		if id != "" {
			if w, ok := c.app.Window.Get("realtime-progress-" + id); ok && w != nil {
				w.Close()
			}
			c.app.Event.Emit("close-realtime-progress-"+id, id)
			c.app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     id,
				"inTray": false,
			})
		}
		if w, ok := c.app.Window.Get("realtime-progress"); ok && w != nil {
			w.Close()
		}
		c.app.Event.Emit("close-realtime-progress", id)
	}

	winmgr.RemoveHiddenDownloadIDs(id)
	RebuildTrayMenuGlobal()

	st := downloader.GetEngine().GetTaskState(id)
	if st != nil {
		if statusStr, ok := st["status"].(string); ok && (statusStr == string(downloader.StatusFinished) || statusStr == "Completed") {
			return nil
		}
	}

	return downloader.GetEngine().Cancel(id)
}

type BatchDeleteArgs struct {
	IDs                 []string          `json:"ids"`
	DeleteFilesFromDisk bool              `json:"delete_files_from_disk"`
	FilePaths           map[string]string `json:"file_paths,omitempty"`
}

func (c *DownloadCommand) BatchDeleteDownloads(args BatchDeleteArgs) error {
	log.Printf("[DownloadCommand] BatchDeleteDownloads called for %d items (deleteFiles: %v)", len(args.IDs), args.DeleteFilesFromDisk)
	if len(args.IDs) == 0 {
		return nil
	}

	winmgr.RemoveHiddenDownloadIDs(args.IDs...)

	for _, id := range args.IDs {
		if id == "" {
			continue
		}
		// 1. Close realtime progress windows and emit cancellation events
		if c.app != nil {
			if w, ok := c.app.Window.Get("realtime-progress-" + id); ok && w != nil {
				w.Close()
			}
			c.app.Event.Emit("close-realtime-progress-"+id, id)
			c.app.Event.Emit("close-realtime-progress", id)
			c.app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     id,
				"inTray": false,
			})
		}

		// 2. Stop running engine task and cleanly close open file handles
		_ = downloader.GetEngine().Cancel(id)

		// 3. Delete files from disk if requested
		if args.DeleteFilesFromDisk {
			filePath := ""
			if args.FilePaths != nil {
				filePath = args.FilePaths[id]
			}
			if filePath == "" {
				st := downloader.GetEngine().GetTaskState(id)
				if st != nil {
					sp, _ := st["save_path"].(string)
					fn, _ := st["filename"].(string)
					if sp != "" && fn != "" {
						filePath = filepath.Join(sp, fn)
					}
				}
			}
			if filePath != "" {
				resolved := utils.ResolveExistingFilePath(filePath)
				targetPath := filePath
				if resolved != "" {
					targetPath = resolved
				}
				_ = os.Remove(targetPath)
				_ = os.RemoveAll(targetPath)
				_ = os.Remove(targetPath + ".thunderdm")
				_ = os.Remove(targetPath + ".merging")
				dir := filepath.Dir(targetPath)
				base := filepath.Base(targetPath)
				_ = os.Remove(filepath.Join(dir, ".torrent.bolt.db"))
				downloader.CleanYTDLPTempFiles(dir, base)
			}
		}
	}

	RebuildTrayMenuGlobal()

	// 4. Atomically delete records from SQLite
	return storage.DeleteDownloads(args.IDs)
}

func (c *DownloadCommand) UpdateThreadCount(id string, threads int) error {
	log.Printf("[DownloadCommand] UpdateThreadCount called for ID: %s, Threads: %d", id, threads)
	_ = storage.UpdateDownloadThreadCount(id, threads)
	return downloader.GetEngine().SetThreadCount(id, threads)
}

func (c *DownloadCommand) UpdateSpeedLimit(id string, speedLimit *int64) error {
	log.Printf("[DownloadCommand] UpdateSpeedLimit called for ID: %s, Limit: %v", id, speedLimit)
	_ = storage.UpdateDownloadSpeedLimit(id, speedLimit)
	return downloader.GetEngine().SetSpeedLimit(id, speedLimit)
}

func (c *DownloadCommand) PauseAll() error {
	log.Println("[DownloadCommand] PauseAll called")
	downloader.GetEngine().PauseAll()
	DebouncedRebuildTrayMenuGlobal()
	return nil
}

func (c *DownloadCommand) GetTaskStatus(id string) map[string]interface{} {
	return downloader.GetEngine().GetTaskState(id)
}

func (c *DownloadCommand) GetDefaultThreadCount() int {
	return downloader.GetEngineConfig().DefaultThreadCount
}

func (c *DownloadCommand) GetDefaultEngineConfig() downloader.EngineConfig {
	return downloader.GetEngineConfig()
}
