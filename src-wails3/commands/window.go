// Package commands exposes Wails v3 service bindings for download management, window orchestration,
// file operations, queues, and system integration.
//
// This file (window.go) defines the WindowCommand service and delegates window/popup/tray
// orchestration to commands/winmgr.
package commands

import (
	"context"

	"ThunderDM/src-wails3/commands/winmgr"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DownloadConfirmationPayload = winmgr.DownloadConfirmationPayload
type ConfirmationWindowSizePayload = winmgr.ConfirmationWindowSizePayload
type HiddenRealtimeDownload = winmgr.HiddenRealtimeDownload

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
	winmgr.SetApp(app)
}

func (c *WindowCommand) Minimize() error {
	return winmgr.Minimize(c.app)
}

func (c *WindowCommand) Maximize() error {
	return winmgr.Maximize(c.app)
}

func (c *WindowCommand) Close() error {
	return winmgr.Close(c.app)
}

func (c *WindowCommand) ExitApp() error {
	return winmgr.ExitApp(c.app)
}

// RefreshAppearanceCache syncs in-memory window popup flags from SQLite kv_store.
func RefreshAppearanceCache() {
	winmgr.RefreshAppearanceCache()
}

// OpenDownloadConfirmationWindow opens the download confirmation dialog.
func OpenDownloadConfirmationWindow(app *application.App, payload map[string]interface{}) {
	winmgr.OpenDownloadConfirmationWindow(app, payload)
}

// UpdateHiddenDownloadLive updates the live progress of a tray-minimized download.
func UpdateHiddenDownloadLive(taskId string, filename string, dl int64, total int64) {
	winmgr.UpdateHiddenDownloadLive(taskId, filename, dl, total)
}

// RebuildTrayMenuGlobal rebuilds the OS system tray menu immediately.
func RebuildTrayMenuGlobal() {
	winmgr.RebuildTrayMenuGlobal()
}

// DebouncedRebuildTrayMenuGlobal coalesces rapid tray menu rebuild calls.
func DebouncedRebuildTrayMenuGlobal() {
	winmgr.DebouncedRebuildTrayMenuGlobal()
}

func (c *WindowCommand) GetDownloadConfirmationPayload(windowId string) map[string]interface{} {
	return winmgr.GetDownloadConfirmationPayload(windowId)
}

func (c *WindowCommand) GetLatestDownloadConfirmationPayload() map[string]interface{} {
	return winmgr.GetLatestDownloadConfirmationPayload()
}

func (c *WindowCommand) ClearDownloadConfirmationPayloadWithId(windowId string) error {
	return winmgr.ClearDownloadConfirmationPayloadWithId(windowId)
}

func (c *WindowCommand) ClearDownloadConfirmationPayload() error {
	return winmgr.ClearDownloadConfirmationPayload()
}

func (c *WindowCommand) CloseDownloadConfirmationWindowCommand(windowId string) error {
	return winmgr.CloseDownloadConfirmationWindow(c.app, windowId)
}

func (c *WindowCommand) OpenDownloadConfirmationWindowCommand(data DownloadConfirmationPayload) error {
	winmgr.OpenDownloadConfirmationWindow(c.app, data.Payload)
	return nil
}

func (c *WindowCommand) SetDownloadConfirmationWindowSizeCommand(data ConfirmationWindowSizePayload) error {
	return winmgr.SetDownloadConfirmationWindowSize(c.app, data)
}

func (c *WindowCommand) OpenDownloadCompletedWindowCommand(payload map[string]interface{}) error {
	return winmgr.OpenDownloadCompletedWindow(c.app, payload)
}

func (c *WindowCommand) ShowDownloadCompletedWindow(payload map[string]interface{}) {
	winmgr.ShowDownloadCompletedWindow(c.app, payload)
}

func (c *WindowCommand) GetLatestDownloadCompletedPayload() map[string]interface{} {
	return winmgr.GetLatestDownloadCompletedPayload()
}

func (c *WindowCommand) GetDownloadCompletedPayload(taskId string) map[string]interface{} {
	return winmgr.GetDownloadCompletedPayload(taskId)
}

func (c *WindowCommand) ClearDownloadCompletedPayload() error {
	return winmgr.ClearDownloadCompletedPayload()
}

func (c *WindowCommand) ClearDownloadCompletedPayloadWithId(taskId string) error {
	return winmgr.ClearDownloadCompletedPayloadWithId(taskId)
}

func (c *WindowCommand) CloseDownloadCompletedWindowCommand(payload map[string]interface{}) error {
	return winmgr.CloseDownloadCompletedWindow(c.app, payload)
}

func (c *WindowCommand) GetLatestRealtimeProgressPayload() map[string]interface{} {
	return winmgr.GetLatestRealtimeProgressPayload()
}

func (c *WindowCommand) ClearRealtimeProgressPayload() error {
	return winmgr.ClearRealtimeProgressPayload()
}

func (c *WindowCommand) OpenRealtimeProgressWindowCommand(payload map[string]interface{}) error {
	return winmgr.OpenRealtimeProgressWindow(c.app, payload)
}

func (c *WindowCommand) CloseRealtimeProgressWindowCommand(payload map[string]interface{}) error {
	return winmgr.CloseRealtimeProgressWindow(c.app, payload)
}

func (c *WindowCommand) GetActiveTrayDownloads() []*HiddenRealtimeDownload {
	return winmgr.GetActiveTrayDownloads(c.app)
}

func (c *WindowCommand) RefreshHiddenDownloadsFromEngine() {
	winmgr.RefreshHiddenDownloadsFromEngine()
}

func (c *WindowCommand) HideRealtimeDownloadToTrayCommand(payload map[string]interface{}) error {
	return winmgr.HideRealtimeDownloadToTray(c.app, payload)
}

func (c *WindowCommand) RemoveHiddenDownloadCommand(payload map[string]interface{}) error {
	return winmgr.RemoveHiddenDownload(c.app, payload)
}

func (c *WindowCommand) DebouncedRebuildTrayMenu() {
	winmgr.DebouncedRebuildTrayMenu(c.app)
}

func (c *WindowCommand) SetSystray(tray *application.SystemTray) {
	winmgr.SetSystray(c.app, tray)
}

func (c *WindowCommand) UpdateLiveTrayLabels() {
	winmgr.UpdateLiveTrayLabels(c.app)
}

func (c *WindowCommand) RebuildTrayMenu() {
	winmgr.RebuildTrayMenu(c.app)
}
