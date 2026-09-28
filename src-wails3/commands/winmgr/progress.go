// Package winmgr manages real-time download progress popup windows
// and tracks background/tray-minimized downloads (HiddenRealtimeDownload).
package winmgr

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type HiddenRealtimeDownload struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	Progress int    `json:"progress"`
}

var (
	hiddenDownloadsMu             sync.RWMutex
	hiddenDownloads               = make(map[string]*HiddenRealtimeDownload)
	latestRealtimeProgressPayload map[string]interface{}
)

// RemoveHiddenDownloadIDs removes the specified download IDs from hidden tray downloads and menu items.
func RemoveHiddenDownloadIDs(ids ...string) {
	hiddenDownloadsMu.Lock()
	defer hiddenDownloadsMu.Unlock()
	for _, id := range ids {
		if id == "" {
			continue
		}
		delete(hiddenDownloads, id)
		delete(trayMenuItems, id)
	}
}

func GetLatestRealtimeProgressPayload() map[string]interface{} {
	return latestRealtimeProgressPayload
}

func ClearRealtimeProgressPayload() error {
	latestRealtimeProgressPayload = nil
	return nil
}

func OpenRealtimeProgressWindow(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
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

	if app != nil {
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
			delete(trayMenuItems, taskId)
			hiddenDownloadsMu.Unlock()
			DebouncedRebuildTrayMenu(app)
		}

		windowName := "realtime-progress"
		urlPath := "/#/realtime-progress"
		if taskId != "" {
			windowName = "realtime-progress-" + taskId
			urlPath = "/#/realtime-progress?id=" + taskId
		}

		// Prevent duplicate windows: if already opened for this download, focus and show it
		if existingWindow, ok := app.Window.Get(windowName); ok && existingWindow != nil {
			existingWindow.SetAlwaysOnTop(true)
			existingWindow.Show()
			existingWindow.UnMinimise()
			existingWindow.Restore()
			existingWindow.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existingWindow.SetAlwaysOnTop(false)
			})
			app.Event.Emit("open-realtime-progress-payload", payload)
			if taskId != "" {
				app.Event.Emit("open-realtime-progress-payload-"+taskId, payload)
			}
			return nil
		}

		window := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
			app.Event.Emit("open-realtime-progress-payload", payload)
			if taskId != "" {
				app.Event.Emit("open-realtime-progress-payload-"+taskId, payload)
			}
		}()
	}
	return nil
}

func CloseRealtimeProgressWindow(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
	taskId := ""
	if id, ok := payload["id"].(string); ok && id != "" {
		taskId = id
	} else if tid, ok := payload["taskId"].(string); ok && tid != "" {
		taskId = tid
	} else if tid, ok := payload["task_id"].(string); ok && tid != "" {
		taskId = tid
	}

	if app != nil {
		if taskId != "" {
			if w, ok := app.Window.Get("realtime-progress-" + taskId); ok && w != nil {
				w.Close()
			}
			app.Event.Emit("close-realtime-progress-"+taskId, taskId)
		}
		if w, ok := app.Window.Get("realtime-progress"); ok && w != nil {
			w.Close()
		}
		app.Event.Emit("close-realtime-progress", taskId)
	}
	return nil
}

func isRealtimeWindowVisible(app *application.App, taskId string) bool {
	if app == nil {
		return false
	}
	if taskId != "" {
		if w, ok := app.Window.Get("realtime-progress-" + taskId); ok && w != nil {
			return w.IsVisible()
		}
	}
	if w, ok := app.Window.Get("realtime-progress"); ok && w != nil {
		return w.IsVisible()
	}
	return false
}

func GetActiveTrayDownloads(app *application.App) []*HiddenRealtimeDownload {
	app = resolveApp(app)
	hiddenDownloadsMu.Lock()
	defer hiddenDownloadsMu.Unlock()

	// 1. Clean up any completed, canceled, errored, paused, or currently visible downloads from hiddenDownloads map
	for id := range hiddenDownloads {
		state := downloader.GetEngine().GetTaskState(id)
		if state == nil {
			delete(hiddenDownloads, id)
			delete(trayMenuItems, id)
			continue
		}
		status, _ := state["status"].(downloader.DownloadStatus)
		if status == "" {
			if s, ok := state["status"].(string); ok {
				status = downloader.DownloadStatus(s)
			}
		}
		if status == downloader.StatusFinished || status == downloader.StatusCanceled || status == downloader.StatusError || status == downloader.StatusPaused {
			delete(hiddenDownloads, id)
			delete(trayMenuItems, id)
			continue
		}
		if isRealtimeWindowVisible(app, id) {
			delete(hiddenDownloads, id)
			delete(trayMenuItems, id)
			continue
		}
	}

	// 2. Discover all active engine tasks where real-time progress window is not visible
	activeTasks := downloader.GetEngine().GetActiveTasksInfo()
	for _, at := range activeTasks {
		if at.ID == "" {
			continue
		}
		if isRealtimeWindowVisible(app, at.ID) {
			delete(hiddenDownloads, at.ID)
			delete(trayMenuItems, at.ID)
			continue
		}
		if existing, ok := hiddenDownloads[at.ID]; ok {
			existing.Filename = at.Filename
			existing.Progress = at.Progress
		} else {
			hiddenDownloads[at.ID] = &HiddenRealtimeDownload{
				ID:       at.ID,
				Filename: at.Filename,
				Progress: at.Progress,
			}
		}
	}

	// 3. Assemble and return items
	items := make([]*HiddenRealtimeDownload, 0, len(hiddenDownloads))
	for id, item := range hiddenDownloads {
		if isRealtimeWindowVisible(app, id) {
			continue
		}
		state := downloader.GetEngine().GetTaskState(id)
		if state != nil {
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
		items = append(items, item)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].ID < items[j].ID
	})

	return items
}

func RefreshHiddenDownloadsFromEngine() {
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
		if status == string(downloader.StatusFinished) || status == string(downloader.StatusCanceled) || status == string(downloader.StatusError) || status == string(downloader.StatusPaused) {
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

func HideRealtimeDownloadToTray(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
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

		if app != nil {
			if w, ok := app.Window.Get("realtime-progress-" + taskId); ok && w != nil {
				w.Hide()
			} else if w, ok := app.Window.Get("realtime-progress"); ok && w != nil {
				w.Hide()
			}
			app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     taskId,
				"inTray": true,
			})
		}
		RebuildTrayMenu(app)
	}
	return nil
}

func RemoveHiddenDownload(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
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
		if app != nil {
			app.Event.Emit("download-item-tray-changed", map[string]interface{}{
				"id":     taskId,
				"inTray": false,
			})
		}
		RebuildTrayMenu(app)
	}
	return nil
}
