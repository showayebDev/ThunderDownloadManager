package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type HiddenRealtimeDownload struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	Progress int    `json:"progress"`
}

var (
	hiddenDownloadsMu   sync.RWMutex
	hiddenDownloads     = make(map[string]*HiddenRealtimeDownload)
	trayMenuItems       = make(map[string]*application.MenuItem)
	systrayInstance     *application.SystemTray
	completedPayloadsMu sync.RWMutex
	completedPayloads   = make(map[string]map[string]interface{})
)

type WindowCommand struct {
	ctx context.Context
	app *application.App
}

func NewWindowCommand() *WindowCommand {
	return &WindowCommand{}
}

func (c *WindowCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

func (c *WindowCommand) SetApp(app *application.App) {
	c.app = app
}

func (c *WindowCommand) Minimize() error {
	fmt.Println("Minimizing window")
	if c.app != nil {
		if current := c.app.Window.Current(); current != nil {
			current.Minimise()
		}
	}
	return nil
}

func (c *WindowCommand) Maximize() error {
	fmt.Println("Maximizing window")
	if c.app != nil {
		if current := c.app.Window.Current(); current != nil {
			current.ToggleMaximise()
		}
	}
	return nil
}

func (c *WindowCommand) Close() error {
	if c.app != nil {
		if current := c.app.Window.Current(); current != nil {
			if current.Name() == "main" {
				current.Hide()
				return nil
			}
			current.Close()
			return nil
		}
		if mainWindow, ok := c.app.Window.Get("main"); ok && mainWindow != nil {
			mainWindow.Hide()
			return nil
		}
	}
	return nil
}

func (c *WindowCommand) ExitApp() error {
	if c.app != nil {
		go func() {
			downloader.GetEngine().PauseAll()
			c.app.Quit()
		}()
	}
	return nil
}

type DownloadConfirmationPayload struct {
	Payload map[string]interface{} `json:"payload"`
}

var (
	downloadConfirmationPayloadsMu    sync.RWMutex
	downloadConfirmationPayloads      = make(map[string]map[string]interface{})
	latestDownloadConfirmationPayload map[string]interface{}
	latestRealtimeProgressPayload     map[string]interface{}
	confirmationWindowSeq             atomic.Uint64
)

func (c *WindowCommand) GetDownloadConfirmationPayload(windowId string) map[string]interface{} {
	downloadConfirmationPayloadsMu.RLock()
	defer downloadConfirmationPayloadsMu.RUnlock()
	if windowId != "" {
		if p, ok := downloadConfirmationPayloads[windowId]; ok {
			return p
		}
	}
	return latestDownloadConfirmationPayload
}

func (c *WindowCommand) GetLatestDownloadConfirmationPayload() map[string]interface{} {
	downloadConfirmationPayloadsMu.RLock()
	defer downloadConfirmationPayloadsMu.RUnlock()
	return latestDownloadConfirmationPayload
}

func (c *WindowCommand) GetLatestRealtimeProgressPayload() map[string]interface{} {
	return latestRealtimeProgressPayload
}

func (c *WindowCommand) ClearDownloadConfirmationPayloadWithId(windowId string) error {
	downloadConfirmationPayloadsMu.Lock()
	defer downloadConfirmationPayloadsMu.Unlock()
	if windowId != "" {
		delete(downloadConfirmationPayloads, windowId)
	}
	if windowId == "" || (latestDownloadConfirmationPayload != nil && latestDownloadConfirmationPayload["windowId"] == windowId) {
		latestDownloadConfirmationPayload = nil
	}
	return nil
}

func (c *WindowCommand) ClearDownloadConfirmationPayload() error {
	downloadConfirmationPayloadsMu.Lock()
	defer downloadConfirmationPayloadsMu.Unlock()
	latestDownloadConfirmationPayload = nil
	return nil
}

func (c *WindowCommand) ClearRealtimeProgressPayload() error {
	latestRealtimeProgressPayload = nil
	return nil
}

func (c *WindowCommand) CloseDownloadConfirmationWindowCommand(windowId string) error {
	if c.app != nil {
		if windowId != "" {
			if w, ok := c.app.Window.Get("download-confirmation-" + windowId); ok && w != nil {
				w.Close()
				return nil
			}
		}
		if w, ok := c.app.Window.Get("download-confirmation"); ok && w != nil {
			w.Close()
			return nil
		}
		if current := c.app.Window.Current(); current != nil && current.Name() != "main" {
			current.Close()
			return nil
		}
	}
	return nil
}

func OpenDownloadConfirmationWindow(app *application.App, payload map[string]interface{}) {
	if payload == nil {
		payload = make(map[string]interface{})
	}

	seq := confirmationWindowSeq.Add(1)
	wId := fmt.Sprintf("%d_%d", time.Now().UnixMilli(), seq)
	if existingId, ok := payload["windowId"].(string); ok && existingId != "" {
		wId = existingId
	} else if existingId, ok := payload["id"].(string); ok && existingId != "" {
		wId = existingId
	}
	payload["windowId"] = wId

	cfg := downloader.GetEngineConfig()
	if _, ok := payload["defaultThreadCount"]; !ok {
		payload["defaultThreadCount"] = cfg.DefaultThreadCount
	}
	if _, ok := payload["default_thread_count"]; !ok {
		payload["default_thread_count"] = cfg.DefaultThreadCount
	}
	if _, ok := payload["threadCount"]; !ok {
		payload["threadCount"] = 0
	}
	if _, ok := payload["thread_count"]; !ok {
		payload["thread_count"] = 0
	}
	if bp, ok := payload["basePath"].(string); !ok || bp == "" {
		payload["basePath"] = cfg.DownloadPath
	}
	if _, ok := payload["useCategory"]; !ok {
		payload["useCategory"] = cfg.UseCategoryByDefault
	}

	downloadConfirmationPayloadsMu.Lock()
	downloadConfirmationPayloads[wId] = payload
	latestDownloadConfirmationPayload = payload
	downloadConfirmationPayloadsMu.Unlock()

	if app != nil {
		windowName := "download-confirmation-" + wId
		urlPath := fmt.Sprintf("/#/download-confirmation?id=%s", wId)

		window := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             windowName,
			Title:            "Add Download",
			Width:            500,
			Height:           400,
			DisableResize:    true,
			Frameless:        true,
			URL:              urlPath,
			BackgroundColour: application.NewRGBA(19, 19, 23, 255),
			AlwaysOnTop:      true, // Rise to the top of all windows initially
		})
		window.Show()
		window.Focus()

		// Unpin after rising so it does not stay permanently pinned on top
		time.AfterFunc(500*time.Millisecond, func() {
			window.SetAlwaysOnTop(false)
		})

		// Let the frontend know the payload
		go func() {
			time.Sleep(150 * time.Millisecond)
			app.Event.Emit("open-download-confirmation-payload", payload)
			app.Event.Emit("open-download-confirmation-payload-"+wId, payload)
		}()
	}
}

func (c *WindowCommand) OpenDownloadConfirmationWindowCommand(data DownloadConfirmationPayload) error {
	fmt.Printf("Opening Download Confirmation Window via Wails v3 with payload: %+v\n", data)
	OpenDownloadConfirmationWindow(c.app, data.Payload)
	return nil
}

var (
	appearanceCacheMu          sync.RWMutex
	cachedShowProgressDialog   bool = true
	cachedShowCompletionDialog bool = true
)

// RefreshAppearanceCache syncs in-memory window popup flags from SQLite kv_store
func RefreshAppearanceCache() {
	appJSON, err := storage.GetKV("appearance")
	if err != nil || appJSON == "" {
		appJSON, _ = storage.GetKV("appearance_settings")
	}
	if appJSON != "" {
		var appMap map[string]interface{}
		if err := json.Unmarshal([]byte(appJSON), &appMap); err == nil {
			appearanceCacheMu.Lock()
			if spd, ok := appMap["showProgressDialog"].(bool); ok {
				cachedShowProgressDialog = spd
			} else if spd2, ok := appMap["show_progress_dialog"].(bool); ok {
				cachedShowProgressDialog = spd2
			}
			if scd, ok := appMap["showCompletionDialog"].(bool); ok {
				cachedShowCompletionDialog = scd
			} else if scd2, ok := appMap["showCompletionWindow"].(bool); ok {
				cachedShowCompletionDialog = scd2
			} else if scd3, ok := appMap["show_completion_dialog"].(bool); ok {
				cachedShowCompletionDialog = scd3
			}
			appearanceCacheMu.Unlock()
		}
	}
}

func isProgressDialogEnabled() bool {
	RefreshAppearanceCache()
	appearanceCacheMu.RLock()
	defer appearanceCacheMu.RUnlock()
	return cachedShowProgressDialog
}

func isCompletionDialogEnabled() bool {
	RefreshAppearanceCache()
	appearanceCacheMu.RLock()
	defer appearanceCacheMu.RUnlock()
	return cachedShowCompletionDialog
}

var (
	trayMenuRebuildMu    sync.Mutex
	trayMenuRebuildTimer *time.Timer
)

// DebouncedRebuildTrayMenu coalesces rapid tray menu rebuild calls to protect the Win32 UI message queue.
func (c *WindowCommand) DebouncedRebuildTrayMenu() {
	trayMenuRebuildMu.Lock()
	defer trayMenuRebuildMu.Unlock()
	if trayMenuRebuildTimer != nil {
		trayMenuRebuildTimer.Stop()
	}
	trayMenuRebuildTimer = time.AfterFunc(300*time.Millisecond, func() {
		c.RebuildTrayMenu()
	})
}

func (c *WindowCommand) OpenRealtimeProgressWindowCommand(payload map[string]interface{}) error {
	if payload == nil {
		payload = make(map[string]interface{})
	}
	cfg := downloader.GetEngineConfig()
	if _, ok := payload["defaultThreadCount"]; !ok {
		payload["defaultThreadCount"] = cfg.DefaultThreadCount
	}
	if _, ok := payload["default_thread_count"]; !ok {
		payload["default_thread_count"] = cfg.DefaultThreadCount
	}

	fmt.Printf("Opening Realtime Progress Window via Wails v3 with payload: %+v\n", payload)
	latestRealtimeProgressPayload = payload

	if c.app != nil {
		taskId := ""
		if id, ok := payload["id"].(string); ok && id != "" {
			taskId = id
		} else if tid, ok := payload["taskId"].(string); ok && tid != "" {
			taskId = tid
		} else if tid, ok := payload["task_id"].(string); ok && tid != "" {
			taskId = tid
		}

		force, _ := payload["force"].(bool)
		if !force {
			if sp, ok := payload["showRealTimeProgress"].(bool); ok && !sp {
				return nil
			}
			if sp2, ok := payload["show_real_time_progress"].(bool); ok && !sp2 {
				return nil
			}
			if !isProgressDialogEnabled() {
				return nil
			}
		}

		if taskId != "" {
			hiddenDownloadsMu.RLock()
			_, isHidden := hiddenDownloads[taskId]
			hiddenDownloadsMu.RUnlock()

			if isHidden && !force {
				// The task is currently minimized to tray; do not pop up window when resumed/paused from main window
				return nil
			}

			hiddenDownloadsMu.Lock()
			delete(hiddenDownloads, taskId)
			hiddenDownloadsMu.Unlock()
		}

		windowName := "realtime-progress"
		urlPath := "/#/realtime-progress"
		if taskId != "" {
			windowName = "realtime-progress-" + taskId
			urlPath = "/#/realtime-progress?id=" + taskId
		}

		// Prevent duplicate windows: if already opened for this download, focus and show it
		if existingWindow, ok := c.app.Window.Get(windowName); ok && existingWindow != nil {
			existingWindow.SetAlwaysOnTop(true)
			existingWindow.Show()
			existingWindow.UnMinimise()
			existingWindow.Restore()
			existingWindow.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existingWindow.SetAlwaysOnTop(false)
			})
			c.app.Event.Emit("open-realtime-progress-payload", payload)
			if taskId != "" {
				c.app.Event.Emit("open-realtime-progress-payload-"+taskId, payload)
			}
			return nil
		}

		window := c.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             windowName,
			Title:            "Download Progress",
			Width:            450,
			Height:           600,
			DisableResize:    true,
			Frameless:        true,
			URL:              urlPath,
			BackgroundColour: application.NewRGBA(19, 19, 23, 255),
			AlwaysOnTop:      true, // Open on top of all windows
		})
		window.Show()
		window.Focus()

		// Unpin after 500ms so it does NOT stay permanently pinned
		time.AfterFunc(500*time.Millisecond, func() {
			window.SetAlwaysOnTop(false)
		})

		go func() {
			time.Sleep(150 * time.Millisecond)
			c.app.Event.Emit("open-realtime-progress-payload", payload)
			if taskId != "" {
				c.app.Event.Emit("open-realtime-progress-payload-"+taskId, payload)
			}
		}()
	}
	return nil
}

func (c *WindowCommand) CloseRealtimeProgressWindowCommand(payload map[string]interface{}) error {
	taskId := ""
	if id, ok := payload["id"].(string); ok && id != "" {
		taskId = id
	} else if tid, ok := payload["taskId"].(string); ok && tid != "" {
		taskId = tid
	} else if tid, ok := payload["task_id"].(string); ok && tid != "" {
		taskId = tid
	}

	if c.app != nil {
		if taskId != "" {
			if w, ok := c.app.Window.Get("realtime-progress-" + taskId); ok && w != nil {
				w.Close()
			}
			c.app.Event.Emit("close-realtime-progress-"+taskId, taskId)
		}
		if w, ok := c.app.Window.Get("realtime-progress"); ok && w != nil {
			w.Close()
		}
		c.app.Event.Emit("close-realtime-progress", taskId)
	}
	return nil
}

func (c *WindowCommand) OpenDownloadCompletedWindowCommand(payload map[string]interface{}) error {
	if sc, ok := payload["showCompletion"].(bool); ok && !sc {
		return nil
	}
	if sc2, ok := payload["show_completion"].(bool); ok && !sc2 {
		return nil
	}
	if sc3, ok := payload["showCompletionWindow"].(bool); ok && !sc3 {
		return nil
	}
	if !isCompletionDialogEnabled() {
		return nil
	}
	fmt.Printf("Opening Download Completed Window via Wails v3 with payload: %+v\n", payload)

	taskId := ""
	if idVal, ok := payload["id"].(string); ok && idVal != "" {
		taskId = idVal
	} else if idVal2, ok := payload["task_id"].(string); ok && idVal2 != "" {
		taskId = idVal2
	} else if idVal3, ok := payload["taskId"].(string); ok && idVal3 != "" {
		taskId = idVal3
	}
	if taskId == "" {
		taskId = fmt.Sprintf("%d", time.Now().UnixNano())
	}

	completedPayloadsMu.Lock()
	completedPayloads[taskId] = payload
	downloader.LatestDownloadCompletedPayload = payload
	completedPayloadsMu.Unlock()

	if c.app != nil {
		windowName := "download-completed-" + taskId
		urlPath := "/#/download-completed?id=" + taskId

		if existing, ok := c.app.Window.Get(windowName); ok && existing != nil {
			existing.SetAlwaysOnTop(true)
			existing.Show()
			existing.UnMinimise()
			existing.Restore()
			existing.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existing.SetAlwaysOnTop(false)
			})
			c.app.Event.Emit("open-download-completed-payload", payload)
			c.app.Event.Emit("open-download-completed-payload-"+taskId, payload)
			return nil
		}

		filename, _ := payload["filename"].(string)
		if filename == "" {
			filename, _ = payload["name"].(string)
		}
		title := "Download Completed"
		if filename != "" {
			title = "Download Completed - " + filename
		}

		window := c.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             windowName,
			Title:            title,
			Width:            500,
			Height:           200,
			DisableResize:    true,
			Frameless:        true,
			URL:              urlPath,
			BackgroundColour: application.NewRGBA(19, 19, 23, 255),
			AlwaysOnTop:      true, // Pop up on top of all windows
		})
		window.Show()
		window.Focus()
		time.AfterFunc(500*time.Millisecond, func() {
			window.SetAlwaysOnTop(false) // Unpin so it's not locked on top
		})

		go func() {
			time.Sleep(200 * time.Millisecond)
			c.app.Event.Emit("open-download-completed-payload", payload)
			c.app.Event.Emit("open-download-completed-payload-"+taskId, payload)
		}()
	}
	return nil
}

func (c *WindowCommand) ShowDownloadCompletedWindow(payload map[string]interface{}) {
	if sc, ok := payload["showCompletion"].(bool); ok && !sc {
		return
	}
	if sc2, ok := payload["show_completion"].(bool); ok && !sc2 {
		return
	}
	if sc3, ok := payload["showCompletionWindow"].(bool); ok && !sc3 {
		return
	}
	if !isCompletionDialogEnabled() {
		return
	}

	fmt.Printf("Opening Download Completed Window natively from Go with payload: %+v\n", payload)

	taskId := ""
	if idVal, ok := payload["id"].(string); ok && idVal != "" {
		taskId = idVal
	} else if idVal2, ok := payload["task_id"].(string); ok && idVal2 != "" {
		taskId = idVal2
	} else if idVal3, ok := payload["taskId"].(string); ok && idVal3 != "" {
		taskId = idVal3
	}
	if taskId == "" {
		taskId = fmt.Sprintf("%d", time.Now().UnixNano())
	}

	completedPayloadsMu.Lock()
	completedPayloads[taskId] = payload
	downloader.LatestDownloadCompletedPayload = payload
	completedPayloadsMu.Unlock()

	if c.app != nil {
		windowName := "download-completed-" + taskId
		urlPath := "/#/download-completed?id=" + taskId

		if existing, ok := c.app.Window.Get(windowName); ok && existing != nil {
			existing.SetAlwaysOnTop(true)
			existing.Show()
			existing.UnMinimise()
			existing.Restore()
			existing.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existing.SetAlwaysOnTop(false)
			})
			c.app.Event.Emit("open-download-completed-payload", payload)
			c.app.Event.Emit("open-download-completed-payload-"+taskId, payload)
			return
		}

		filename, _ := payload["filename"].(string)
		if filename == "" {
			filename, _ = payload["name"].(string)
		}
		title := "Download Completed"
		if filename != "" {
			title = "Download Completed - " + filename
		}

		window := c.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:             windowName,
			Title:            title,
			Width:            500,
			Height:           200,
			DisableResize:    true,
			Frameless:        true,
			URL:              urlPath,
			BackgroundColour: application.NewRGBA(19, 19, 23, 255),
			AlwaysOnTop:      true, // Pop up on top of all windows
		})
		window.Show()
		window.Focus()

		time.AfterFunc(500*time.Millisecond, func() {
			window.SetAlwaysOnTop(false) // Unpin automatically
		})

		go func() {
			time.Sleep(200 * time.Millisecond)
			c.app.Event.Emit("open-download-completed-payload", payload)
			c.app.Event.Emit("open-download-completed-payload-"+taskId, payload)
		}()
	}
}

var trayTickerOnce sync.Once

func (c *WindowCommand) SetSystray(tray *application.SystemTray) {
	systrayInstance = tray
	if systrayInstance != nil {
		systrayInstance.SetTooltip("Thunder Download Manager")
		c.RebuildTrayMenu()
	}
	trayTickerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(1000 * time.Millisecond)
			for range ticker.C {
				c.UpdateLiveTrayLabels()
			}
		}()
	})
}

func truncateFilenameWords(name string, maxLen int) string {
	if len(name) <= maxLen {
		return name
	}
	if maxLen <= 3 {
		return name[:maxLen]
	}
	return name[:maxLen-3] + "..."
}

func (c *WindowCommand) GetActiveTrayDownloads() []*HiddenRealtimeDownload {
	engineTasks := downloader.GetEngine().GetActiveTasksInfo()

	hiddenDownloadsMu.Lock()
	defer hiddenDownloadsMu.Unlock()

	resultMap := make(map[string]*HiddenRealtimeDownload)

	for _, t := range engineTasks {
		resultMap[t.ID] = &HiddenRealtimeDownload{
			ID:       t.ID,
			Filename: t.Filename,
			Progress: t.Progress,
		}
		if h, ok := hiddenDownloads[t.ID]; ok && h != nil {
			h.Filename = t.Filename
			h.Progress = t.Progress
		}
	}

	for id, h := range hiddenDownloads {
		if _, ok := resultMap[id]; !ok {
			resultMap[id] = h
		}
	}

	items := make([]*HiddenRealtimeDownload, 0, len(resultMap))
	for _, item := range resultMap {
		items = append(items, item)
	}
	return items
}

func (c *WindowCommand) RefreshHiddenDownloadsFromEngine() {
	hiddenDownloadsMu.Lock()
	defer hiddenDownloadsMu.Unlock()

	for id, item := range hiddenDownloads {
		state := downloader.GetEngine().GetTaskState(id)
		if state == nil {
			delete(hiddenDownloads, id)
			delete(trayMenuItems, id)
			continue
		}
		status, _ := state["status"].(string)
		if status == string(downloader.StatusFinished) || status == string(downloader.StatusCanceled) || status == string(downloader.StatusError) {
			delete(hiddenDownloads, id)
			delete(trayMenuItems, id)
			continue
		}
		if fn, ok := state["filename"].(string); ok && fn != "" {
			item.Filename = fn
		}
		var dl, tot int64
		if v, ok := state["downloaded"].(int64); ok {
			dl = v
		}
		if v, ok := state["total_size"].(int64); ok {
			tot = v
		}
		if tot > 0 {
			item.Progress = int((dl * 100) / tot)
			if item.Progress > 100 {
				item.Progress = 100
			}
		}
	}
}

func UpdateHiddenDownloadLive(taskId string, filename string, dl int64, total int64) {
	hiddenDownloadsMu.RLock()
	if len(hiddenDownloads) == 0 {
		hiddenDownloadsMu.RUnlock()
		return
	}
	item, exists := hiddenDownloads[taskId]
	hiddenDownloadsMu.RUnlock()

	if !exists || item == nil {
		return
	}

	hiddenDownloadsMu.Lock()
	defer hiddenDownloadsMu.Unlock()
	item, exists = hiddenDownloads[taskId]
	if exists && item != nil {
		if filename != "" {
			item.Filename = filename
		}
		if total > 0 {
			item.Progress = int((dl * 100) / total)
			if item.Progress > 100 {
				item.Progress = 100
			}
		}
	}
}

func (c *WindowCommand) UpdateLiveTrayLabels() {
	items := c.GetActiveTrayDownloads()

	hiddenDownloadsMu.RLock()
	currentCount := len(trayMenuItems)
	needsRebuild := len(items) != currentCount
	if !needsRebuild {
		for _, item := range items {
			if _, ok := trayMenuItems[item.ID]; !ok {
				needsRebuild = true
				break
			}
		}
	}
	hiddenDownloadsMu.RUnlock()

	if needsRebuild {
		c.DebouncedRebuildTrayMenu()
		return
	}

	hiddenDownloadsMu.RLock()
	defer hiddenDownloadsMu.RUnlock()

	for _, item := range items {
		if menuItem, ok := trayMenuItems[item.ID]; ok && menuItem != nil {
			displayName := truncateFilenameWords(item.Filename, 26)
			newLabel := fmt.Sprintf("[%d%%] %s", item.Progress, displayName)
			if menuItem.Label() != newLabel {
				menuItem.SetLabel(newLabel)
			}
		}
	}
}

func (c *WindowCommand) RebuildTrayMenu() {
	if c.app == nil || systrayInstance == nil {
		return
	}

	systrayInstance.SetTooltip("Thunder Download Manager")

	trayMenu := c.app.NewMenu()
	items := c.GetActiveTrayDownloads()

	hiddenDownloadsMu.Lock()
	trayMenuItems = make(map[string]*application.MenuItem)
	hiddenDownloadsMu.Unlock()

	// 1. Hidden / Active Realtime Downloads (KEEP AT THE TOP OF MENU, capped at 8)
	if len(items) > 0 {
		displayItems := items
		if len(displayItems) > 8 {
			displayItems = items[:8]
		}
		for _, item := range displayItems {
			taskItem := item // capture in loop closure
			displayName := truncateFilenameWords(taskItem.Filename, 26)
			label := fmt.Sprintf("[%d%%] %s", taskItem.Progress, displayName)

			menuItem := trayMenu.Add(label)
			hiddenDownloadsMu.Lock()
			trayMenuItems[taskItem.ID] = menuItem
			hiddenDownloadsMu.Unlock()

			menuItem.OnClick(func(ctx *application.Context) {
				windowName := "realtime-progress-" + taskItem.ID
				hiddenDownloadsMu.Lock()
				delete(hiddenDownloads, taskItem.ID)
				delete(trayMenuItems, taskItem.ID)
				hiddenDownloadsMu.Unlock()

				if w, ok := c.app.Window.Get(windowName); ok && w != nil {
					w.Show()
					w.UnMinimise()
					w.Restore()
					w.Focus()
				} else if w, ok := c.app.Window.Get("realtime-progress"); ok && w != nil {
					w.Show()
					w.UnMinimise()
					w.Restore()
					w.Focus()
				} else {
					c.OpenRealtimeProgressWindowCommand(map[string]interface{}{
						"id":       taskItem.ID,
						"taskId":   taskItem.ID,
						"filename": taskItem.Filename,
						"force":    true,
					})
				}

				if c.app != nil {
					c.app.Event.Emit("download-item-tray-changed", map[string]interface{}{
						"id":     taskItem.ID,
						"inTray": false,
					})
				}
				c.DebouncedRebuildTrayMenu()
			})
		}
		if len(items) > 8 {
			trayMenu.Add(fmt.Sprintf("... and %d more active downloads", len(items)-8))
		}
		trayMenu.AddSeparator()
	}

	// 2. Open ThunderDM (Main Window)
	trayMenu.Add("Open ThunderDM").OnClick(func(ctx *application.Context) {
		if mainWindow, ok := c.app.Window.Get("main"); ok && mainWindow != nil {
			mainWindow.Show()
			mainWindow.UnMinimise()
			mainWindow.Restore()
			mainWindow.Focus()
		}
	})

	trayMenu.AddSeparator()

	// 3. Exit ThunderDM
	trayMenu.Add("Exit ThunderDM").OnClick(func(ctx *application.Context) {
		go func() {
			downloader.GetEngine().PauseAll()
			if c.app != nil {
				c.app.Quit()
			}
		}()
	})

	systrayInstance.SetMenu(trayMenu)
}

func (c *WindowCommand) HideRealtimeDownloadToTrayCommand(payload map[string]interface{}) error {
	taskId := ""
	if id, ok := payload["id"].(string); ok && id != "" {
		taskId = id
	} else if tid, ok := payload["taskId"].(string); ok && tid != "" {
		taskId = tid
	} else if tid, ok := payload["task_id"].(string); ok && tid != "" {
		taskId = tid
	}

	filename := "download"
	if fn, ok := payload["filename"].(string); ok && fn != "" {
		filename = fn
	}

	progress := 0
	if p, ok := payload["progress"].(float64); ok {
		progress = int(p)
	} else if p, ok := payload["progress"].(int); ok {
		progress = p
	}

	if taskId != "" {
		hiddenDownloadsMu.Lock()
		hiddenDownloads[taskId] = &HiddenRealtimeDownload{
			ID:       taskId,
			Filename: filename,
			Progress: progress,
		}
		hiddenDownloadsMu.Unlock()

		if c.app != nil {
			if w, ok := c.app.Window.Get("realtime-progress-" + taskId); ok && w != nil {
				w.Hide()
			} else if w, ok := c.app.Window.Get("realtime-progress"); ok && w != nil {
				w.Hide()
			}
			c.app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     taskId,
				"inTray": true,
			})
		}
		c.RebuildTrayMenu()
	}
	return nil
}

func (c *WindowCommand) RemoveHiddenDownloadCommand(payload map[string]interface{}) error {
	taskId := ""
	if id, ok := payload["id"].(string); ok && id != "" {
		taskId = id
	} else if tid, ok := payload["taskId"].(string); ok && tid != "" {
		taskId = tid
	} else if tid, ok := payload["task_id"].(string); ok && tid != "" {
		taskId = tid
	}

	if taskId != "" {
		hiddenDownloadsMu.Lock()
		delete(hiddenDownloads, taskId)
		delete(trayMenuItems, taskId)
		hiddenDownloadsMu.Unlock()
		if c.app != nil {
			c.app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     taskId,
				"inTray": false,
			})
		}
		c.RebuildTrayMenu()
	}
	return nil
}

func (c *WindowCommand) GetLatestDownloadCompletedPayload() map[string]interface{} {
	completedPayloadsMu.RLock()
	defer completedPayloadsMu.RUnlock()
	return downloader.LatestDownloadCompletedPayload
}

func (c *WindowCommand) GetDownloadCompletedPayload(taskId string) map[string]interface{} {
	completedPayloadsMu.RLock()
	defer completedPayloadsMu.RUnlock()
	if p, ok := completedPayloads[taskId]; ok && p != nil {
		return p
	}
	return downloader.LatestDownloadCompletedPayload
}

func (c *WindowCommand) ClearDownloadCompletedPayload() error {
	completedPayloadsMu.Lock()
	downloader.LatestDownloadCompletedPayload = nil
	completedPayloadsMu.Unlock()
	return nil
}

func (c *WindowCommand) ClearDownloadCompletedPayloadWithId(taskId string) error {
	completedPayloadsMu.Lock()
	delete(completedPayloads, taskId)
	completedPayloadsMu.Unlock()
	return nil
}

func (c *WindowCommand) CloseDownloadCompletedWindowCommand(payload map[string]interface{}) error {
	taskId := ""
	if idVal, ok := payload["id"].(string); ok {
		taskId = idVal
	} else if idVal2, ok := payload["taskId"].(string); ok {
		taskId = idVal2
	} else if idVal3, ok := payload["task_id"].(string); ok {
		taskId = idVal3
	}

	if taskId != "" {
		completedPayloadsMu.Lock()
		delete(completedPayloads, taskId)
		completedPayloadsMu.Unlock()
	}

	if c.app != nil {
		if taskId != "" {
			if w, ok := c.app.Window.Get("download-completed-" + taskId); ok && w != nil {
				w.Close()
			}
			c.app.Event.Emit("close-download-completed-"+taskId, taskId)
		}
		if w, ok := c.app.Window.Get("download-completed"); ok && w != nil {
			w.Close()
		}
		c.app.Event.Emit("close-download-completed", taskId)
	}
	return nil
}

