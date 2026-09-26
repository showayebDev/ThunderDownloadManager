// Package winmgr manages application windows, download confirmation/completion popups,
// real-time progress dialogs, appearance settings caching, and OS system tray state.
package winmgr

import (
	"encoding/json"
	"fmt"
	"sync"

	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/storage"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	globalAppMu sync.RWMutex
	globalApp   *application.App

	appearanceCacheMu          sync.RWMutex
	cachedShowProgressDialog   bool = true
	cachedShowCompletionDialog bool = true
)

// SetApp sets the global Wails application instance for window and tray management.
func SetApp(app *application.App) {
	globalAppMu.Lock()
	globalApp = app
	globalAppMu.Unlock()
}

// GetApp returns the global Wails application instance if set.
func GetApp() *application.App {
	globalAppMu.RLock()
	defer globalAppMu.RUnlock()
	return globalApp
}

func resolveApp(app *application.App) *application.App {
	if app != nil {
		return app
	}
	return GetApp()
}

// Minimize minimizes the currently active window.
func Minimize(app *application.App) error {
	fmt.Println("Minimizing window")
	app = resolveApp(app)
	if app != nil {
		if current := app.Window.Current(); current != nil {
			current.Minimise()
		}
	}
	return nil
}

// Maximize toggles maximize on the currently active window.
func Maximize(app *application.App) error {
	fmt.Println("Maximizing window")
	app = resolveApp(app)
	if app != nil {
		if current := app.Window.Current(); current != nil {
			current.ToggleMaximise()
		}
	}
	return nil
}

// Close hides the main window to the system tray or closes secondary popup windows.
func Close(app *application.App) error {
	app = resolveApp(app)
	if app != nil {
		if current := app.Window.Current(); current != nil {
			if current.Name() == "main" {
				current.Hide()
				return nil
			}
			current.Close()
			return nil
		}
		if mainWindow, ok := app.Window.Get("main"); ok && mainWindow != nil {
			mainWindow.Hide()
			return nil
		}
	}
	return nil
}

// ExitApp pauses active downloads and quits the application.
func ExitApp(app *application.App) error {
	app = resolveApp(app)
	if app != nil {
		go func() {
			downloader.GetEngine().PauseAll()
			app.Quit()
		}()
	}
	return nil
}

// RefreshAppearanceCache syncs in-memory window popup flags from SQLite kv_store.
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
