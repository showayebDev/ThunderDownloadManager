package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/storage"
	"ThunderDM/src-wails3/utils"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type FileCommand struct {
	ctx context.Context
}

func NewFileCommand() *FileCommand {
	return &FileCommand{}
}

func (c *FileCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

func (c *FileCommand) OpenFile(path string) error {
	if path == "" {
		return fmt.Errorf("empty file path")
	}
	resolved := utils.ResolveExistingFilePath(path)
	if resolved == "" {
		resolved = path
	}

	return utils.OpenFileWithDefaultApp(resolved)
}

func (c *FileCommand) OpenFolder(path string) error {
	return utils.OpenExplorerAndSelect(path)
}

func (c *FileCommand) DeleteFile(path string) error {
	if path == "" {
		return nil
	}
	err := os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		_ = os.RemoveAll(path)
	}
	// Also clean up any associated partial files (.thunderdm, .merging, .part, .ytdl)
	_ = os.Remove(path + ".thunderdm")
	_ = os.Remove(path + ".merging")
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	downloader.CleanYTDLPTempFiles(dir, base)
	return nil
}

func (c *FileCommand) CalculateChecksum(path string, algo string) (string, error) {
	resolved := utils.ResolveExistingFilePath(path)
	if resolved != "" {
		path = resolved
	}
	if algo == "md5" {
		return utils.CalculateMD5(path)
	}
	return utils.CalculateSHA256(path)
}

func (c *FileCommand) ResolveUniqueFilename(savePath string, filename string) (string, error) {
	savePath = downloader.NormalizeSavePath(savePath)
	uniqueName := downloader.GetEngine().ResolveUniqueFilename(savePath, filename)
	return uniqueName, nil
}

func (c *FileCommand) PickFolder() (string, error) {
	if application.Get() != nil {
		dialog := application.Get().Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false)
		return dialog.PromptForSingleSelection()
	}
	return "", fmt.Errorf("app not initialized")
}

func (c *FileCommand) GetDefaultDownloadDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	// Try reading configured downloadPath from SQLite kv_store
	if val, err := storage.GetKV("download_engine"); err == nil && val != "" {
		var engineMap map[string]interface{}
		if err := json.Unmarshal([]byte(val), &engineMap); err == nil {
			if dp, ok := engineMap["downloadPath"].(string); ok && strings.TrimSpace(dp) != "" {
				dp = strings.TrimSpace(dp)
				_ = os.MkdirAll(dp, 0755)
				return dp, nil
			}
		}
	}

	downloadDir := filepath.Join(home, "Downloads")
	_ = os.MkdirAll(downloadDir, 0755)
	return downloadDir, nil
}

type ReadThunderdbArgs struct {
	Filename string `json:"filename"`
}

type SaveThunderdbArgs struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

func (c *FileCommand) ReadThunderdbFileCommand(args ReadThunderdbArgs) (string, error) {
	if args.Filename == "downloads" || args.Filename == "downloads.json" {
		return storage.GetDownloadsJSON()
	}
	if args.Filename == "queues" || args.Filename == "queues.json" {
		return storage.GetQueuesJSON()
	}
	return storage.GetKV(args.Filename)
}

func (c *FileCommand) SaveThunderdbFileCommand(args SaveThunderdbArgs) error {
	if args.Filename == "downloads" || args.Filename == "downloads.json" {
		return storage.SaveDownloads(args.Content)
	}
	if args.Filename == "queues" || args.Filename == "queues.json" {
		return storage.SaveQueues(args.Content)
	}

	err := storage.SetKV(args.Filename, args.Content)
	if err == nil {
		if args.Filename == "download_engine" || args.Filename == "download_engine.json" || args.Filename == "settings" || args.Filename == "settings.json" {
			downloader.LoadEngineConfig()
		}
		if args.Filename == "appearance" || args.Filename == "appearance.json" {
			RefreshAppearanceCache()
		}
	}
	return err
}

type SetStorageModeArgs struct {
	Mode string `json:"mode"`
}

func (c *FileCommand) SetStorageModeCommand(args SetStorageModeArgs) error {
	return nil
}

func (c *FileCommand) GetStorageModeCommand() (string, error) {
	return "sqlite", nil
}

type CheckFilesExistArgs struct {
	Paths []string `json:"paths"`
}

type FileStatInfo struct {
	Exists bool  `json:"exists"`
	Size   int64 `json:"size"`
}

func resolvePathForFileCheck(p string) string {
	clean := filepath.Clean(strings.TrimSpace(p))
	if clean == "" || clean == "." {
		return ""
	}
	if filepath.IsAbs(clean) {
		return clean
	}
	cfg := downloader.GetEngineConfig()
	baseDir := strings.TrimSpace(cfg.DownloadPath)
	if baseDir == "" {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			baseDir = filepath.Join(home, "Downloads")
		}
	}
	if baseDir != "" {
		return filepath.Clean(filepath.Join(baseDir, clean))
	}
	return clean
}

func (c *FileCommand) CheckFilesExistCommand(args CheckFilesExistArgs) (map[string]bool, error) {
	result := make(map[string]bool)
	for _, p := range args.Paths {
		if p == "" {
			continue
		}
		cleanPath := filepath.Clean(p)
		resolvedPath := resolvePathForFileCheck(p)
		exists := false
		if _, err := os.Stat(cleanPath); err == nil {
			exists = true
		} else if resolvedPath != "" && resolvedPath != cleanPath {
			if _, err := os.Stat(resolvedPath); err == nil {
				exists = true
			}
		}
		result[p] = exists
	}
	return result, nil
}

func (c *FileCommand) CheckFilesInfoCommand(args CheckFilesExistArgs) (map[string]FileStatInfo, error) {
	result := make(map[string]FileStatInfo)
	for _, p := range args.Paths {
		if p == "" {
			continue
		}
		cleanPath := filepath.Clean(p)
		resolvedPath := resolvePathForFileCheck(p)

		var fi os.FileInfo
		var err error
		if fi, err = os.Stat(cleanPath); err != nil || fi.IsDir() {
			if resolvedPath != "" && resolvedPath != cleanPath {
				fi, err = os.Stat(resolvedPath)
			}
		}

		if err == nil && fi != nil && !fi.IsDir() {
			result[p] = FileStatInfo{
				Exists: true,
				Size:   fi.Size(),
			}
		} else {
			result[p] = FileStatInfo{
				Exists: false,
				Size:   0,
			}
		}
	}
	return result, nil
}
