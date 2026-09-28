// Package winmgr manages the OS system tray icon, live download progress labels,
// debounced menu rebuilding, and tray click actions.
package winmgr

import (
	"fmt"
	"sync"
	"time"

	"ThunderDM/src-wails3/downloader"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	trayMenuItems        = make(map[string]*application.MenuItem)
	systrayInstance      *application.SystemTray
	trayMenuRebuildMu    sync.Mutex
	trayMenuRebuildTimer *time.Timer
	trayTickerOnce       sync.Once
)

func RebuildTrayMenuGlobal() {
	if app := GetApp(); app != nil {
		RebuildTrayMenu(app)
	}
}

func DebouncedRebuildTrayMenuGlobal() {
	if app := GetApp(); app != nil {
		DebouncedRebuildTrayMenu(app)
	}
}

// DebouncedRebuildTrayMenu coalesces rapid tray menu rebuild calls to protect the Win32 UI message queue.
func DebouncedRebuildTrayMenu(app *application.App) {
	app = resolveApp(app)
	trayMenuRebuildMu.Lock()
	defer trayMenuRebuildMu.Unlock()
	if trayMenuRebuildTimer != nil {
		trayMenuRebuildTimer.Stop()
	}
	trayMenuRebuildTimer = time.AfterFunc(300*time.Millisecond, func() {
		RebuildTrayMenu(app)
	})
}

func SetSystray(app *application.App, tray *application.SystemTray) {
	app = resolveApp(app)
	systrayInstance = tray
	if systrayInstance != nil {
		systrayInstance.SetTooltip("Thunder Download Manager")
		RebuildTrayMenu(app)
	}
	trayTickerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(1000 * time.Millisecond)
			for range ticker.C {
				UpdateLiveTrayLabels(GetApp())
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

func UpdateLiveTrayLabels(app *application.App) {
	app = resolveApp(app)
	items := GetActiveTrayDownloads(app)

	hiddenDownloadsMu.RLock()
	currentCount := len(trayMenuItems)
	displayCount := len(items)
	if displayCount > 8 {
		displayCount = 8
	}
	needsRebuild := displayCount != currentCount
	if !needsRebuild {
		for i := 0; i < displayCount; i++ {
			if _, ok := trayMenuItems[items[i].ID]; !ok {
				needsRebuild = true
				break
			}
		}
	}
	hiddenDownloadsMu.RUnlock()

	if needsRebuild {
		DebouncedRebuildTrayMenu(app)
		return
	}

	hiddenDownloadsMu.RLock()
	defer hiddenDownloadsMu.RUnlock()

	for i := 0; i < displayCount; i++ {
		item := items[i]
		if menuItem, ok := trayMenuItems[item.ID]; ok && menuItem != nil {
			displayName := truncateFilenameWords(item.Filename, 26)
			newLabel := fmt.Sprintf("[%d%%] %s", item.Progress, displayName)
			if menuItem.Label() != newLabel {
				menuItem.SetLabel(newLabel)
			}
		}
	}
}

func RebuildTrayMenu(app *application.App) {
	app = resolveApp(app)
	if app == nil || systrayInstance == nil {
		return
	}

	systrayInstance.SetTooltip("Thunder Download Manager")

	trayMenu := app.NewMenu()
	items := GetActiveTrayDownloads(app)

	hiddenDownloadsMu.Lock()
	trayMenuItems = make(map[string]*application.MenuItem)
	hiddenDownloadsMu.Unlock()

	// 1. Hidden Realtime Downloads (Max 8 items, '...' for more)
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

				if w, ok := app.Window.Get(windowName); ok && w != nil {
					w.Show()
					w.UnMinimise()
					w.Restore()
					w.Focus()
				} else if w, ok := app.Window.Get("realtime-progress"); ok && w != nil {
					w.Show()
					w.UnMinimise()
					w.Restore()
					w.Focus()
				} else {
					OpenRealtimeProgressWindow(app, map[string]interface{}{
						"id":       taskItem.ID,
						"taskId":   taskItem.ID,
						"filename": taskItem.Filename,
						"force":    true,
					})
				}

				if app != nil {
					app.Event.Emit("download-item-tray-changed", map[string]interface{}{
						"id":     taskItem.ID,
						"inTray": false,
					})
				}
				DebouncedRebuildTrayMenu(app)
			})
		}
		if len(items) > 8 {
			moreItem := trayMenu.Add("...")
			moreItem.SetEnabled(false)
		}
		trayMenu.AddSeparator()
	}

	// 2. Open ThunderDM (Main Window)
	trayMenu.Add("Open ThunderDM").OnClick(func(ctx *application.Context) {
		if mainWindow, ok := app.Window.Get("main"); ok && mainWindow != nil {
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
			if app != nil {
				app.Quit()
			}
		}()
	})

	systrayInstance.SetMenu(trayMenu)
}
