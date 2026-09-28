// Package winmgr manages the Download Confirmation and Download Completed
// popup windows, their dynamic sizing, and their per-window payload state.
package winmgr

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"ThunderDM/src-wails3/downloader"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DownloadConfirmationPayload struct {
	Payload map[string]interface{} `json:"payload"`
}

type ConfirmationWindowSizePayload struct {
	WindowID string `json:"windowId"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

var (
	downloadConfirmationPayloadsMu    sync.RWMutex
	downloadConfirmationPayloads      = make(map[string]map[string]interface{})
	latestDownloadConfirmationPayload map[string]interface{}
	confirmationWindowSeq             atomic.Uint64

	completedPayloadsMu       sync.RWMutex
	completedPayloads         = make(map[string]map[string]interface{})
	completedWindowCreationMu sync.Mutex
)

func GetDownloadConfirmationPayload(windowId string) map[string]interface{} {
	downloadConfirmationPayloadsMu.RLock()
	defer downloadConfirmationPayloadsMu.RUnlock()
	if windowId != "" {
		if p, ok := downloadConfirmationPayloads[windowId]; ok {
			return p
		}
	}
	return latestDownloadConfirmationPayload
}

func GetLatestDownloadConfirmationPayload() map[string]interface{} {
	downloadConfirmationPayloadsMu.RLock()
	defer downloadConfirmationPayloadsMu.RUnlock()
	return latestDownloadConfirmationPayload
}

func ClearDownloadConfirmationPayloadWithId(windowId string) error {
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

func ClearDownloadConfirmationPayload() error {
	downloadConfirmationPayloadsMu.Lock()
	defer downloadConfirmationPayloadsMu.Unlock()
	latestDownloadConfirmationPayload = nil
	return nil
}

func CloseDownloadConfirmationWindow(app *application.App, windowId string) error {
	app = resolveApp(app)
	if app != nil {
		if windowId != "" {
			if w, ok := app.Window.Get("download-confirmation-" + windowId); ok && w != nil {
				w.Close()
				return nil
			}
		}
		if w, ok := app.Window.Get("download-confirmation"); ok && w != nil {
			w.Close()
			return nil
		}
		if current := app.Window.Current(); current != nil && current.Name() != "main" {
			current.Close()
			return nil
		}
	}
	return nil
}

func OpenDownloadConfirmationWindow(app *application.App, payload map[string]interface{}) {
	app = resolveApp(app)
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

	cfg := downloader.LoadEngineConfig()
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
	if _, ok := payload["cookieBypassRules"]; !ok {
		payload["cookieBypassRules"] = cfg.CookieBypassRules
	}
	if _, ok := payload["cookieBypassDomains"]; !ok {
		payload["cookieBypassDomains"] = cfg.CookieBypassDomains
	}
	targetURL, _ := payload["url"].(string)
	targetProto, _ := payload["protocol"].(string)
	if targetURL != "" {
		if _, ok := payload["useCookie"]; !ok {
			isBypassed := downloader.ShouldBypassCookies(targetURL, targetProto)
			payload["useCookie"] = !isBypassed
			payload["isCookieBypassed"] = isBypassed
		}
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

func SetDownloadConfirmationWindowSize(app *application.App, data ConfirmationWindowSizePayload) error {
	app = resolveApp(app)
	if app != nil {
		w := data.Width
		h := data.Height
		if w <= 0 {
			w = 500
		}
		if h <= 0 {
			h = 400
		}
		if data.WindowID != "" {
			if win, ok := app.Window.Get("download-confirmation-" + data.WindowID); ok && win != nil {
				win.SetSize(w, h)
				return nil
			}
		}
		if win, ok := app.Window.Get("download-confirmation"); ok && win != nil {
			win.SetSize(w, h)
			return nil
		}
		if current := app.Window.Current(); current != nil {
			current.SetSize(w, h)
			return nil
		}
	}
	return nil
}

func OpenDownloadCompletedWindow(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
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

	hiddenDownloadsMu.Lock()
	delete(hiddenDownloads, taskId)
	delete(trayMenuItems, taskId)
	hiddenDownloadsMu.Unlock()
	DebouncedRebuildTrayMenu(app)

	if app != nil {
		windowName := "download-completed-" + taskId
		urlPath := "/#/download-completed?id=" + taskId

		if existing, ok := app.Window.Get(windowName); ok && existing != nil {
			existing.SetAlwaysOnTop(true)
			existing.Show()
			existing.UnMinimise()
			existing.Restore()
			existing.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existing.SetAlwaysOnTop(false)
			})
			app.Event.Emit("open-download-completed-payload", payload)
			app.Event.Emit("open-download-completed-payload-"+taskId, payload)
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

		window := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
			app.Event.Emit("open-download-completed-payload", payload)
			app.Event.Emit("open-download-completed-payload-"+taskId, payload)
		}()
	}
	return nil
}

func ShowDownloadCompletedWindow(app *application.App, payload map[string]interface{}) {
	app = resolveApp(app)
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

	hiddenDownloadsMu.Lock()
	delete(hiddenDownloads, taskId)
	delete(trayMenuItems, taskId)
	hiddenDownloadsMu.Unlock()
	DebouncedRebuildTrayMenu(app)

	if app != nil {
		completedWindowCreationMu.Lock()
		defer completedWindowCreationMu.Unlock()

		windowName := "download-completed-" + taskId
		urlPath := "/#/download-completed?id=" + taskId

		if existing, ok := app.Window.Get(windowName); ok && existing != nil {
			existing.SetAlwaysOnTop(true)
			existing.Show()
			existing.UnMinimise()
			existing.Restore()
			existing.Focus()
			time.AfterFunc(500*time.Millisecond, func() {
				existing.SetAlwaysOnTop(false)
			})
			app.Event.Emit("open-download-completed-payload", payload)
			app.Event.Emit("open-download-completed-payload-"+taskId, payload)
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

		window := app.Window.NewWithOptions(application.WebviewWindowOptions{
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
			app.Event.Emit("open-download-completed-payload", payload)
			app.Event.Emit("open-download-completed-payload-"+taskId, payload)
		}()
	}
}

func GetLatestDownloadCompletedPayload() map[string]interface{} {
	completedPayloadsMu.RLock()
	defer completedPayloadsMu.RUnlock()
	return downloader.LatestDownloadCompletedPayload
}

func GetDownloadCompletedPayload(taskId string) map[string]interface{} {
	completedPayloadsMu.RLock()
	defer completedPayloadsMu.RUnlock()
	if p, ok := completedPayloads[taskId]; ok && p != nil {
		return p
	}
	return downloader.LatestDownloadCompletedPayload
}

func ClearDownloadCompletedPayload() error {
	completedPayloadsMu.Lock()
	downloader.LatestDownloadCompletedPayload = nil
	completedPayloadsMu.Unlock()
	return nil
}

func ClearDownloadCompletedPayloadWithId(taskId string) error {
	completedPayloadsMu.Lock()
	delete(completedPayloads, taskId)
	completedPayloadsMu.Unlock()
	return nil
}

func CloseDownloadCompletedWindow(app *application.App, payload map[string]interface{}) error {
	app = resolveApp(app)
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

	if app != nil {
		if taskId != "" {
			if w, ok := app.Window.Get("download-completed-" + taskId); ok && w != nil {
				w.Close()
			}
			app.Event.Emit("close-download-completed-"+taskId, taskId)
		}
		if w, ok := app.Window.Get("download-completed"); ok && w != nil {
			w.Close()
		}
		app.Event.Emit("close-download-completed", taskId)
	}
	return nil
}
