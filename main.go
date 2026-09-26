package main

import (
	"embed"
	_ "embed"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"ThunderDM/src-wails3/commands"
	"ThunderDM/src-wails3/downloader"
	"ThunderDM/src-wails3/queue"
	"ThunderDM/src-wails3/server"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed src-wails3/icons/icon_64x64.png
var trayIcon []byte

// shouldPurgeUserData checks if the process was invoked with an uninstall/purge flag.
func shouldPurgeUserData(args []string) bool {
	for _, arg := range args {
		switch strings.ToLower(strings.TrimSpace(arg)) {
		case "--uninstall", "--purge", "--clean-data":
			return true
		}
	}
	return false
}

// isBackgroundStartupLaunch checks if the application was started minimized/hidden on OS boot.
func isBackgroundStartupLaunch(args []string) bool {
	for _, arg := range args {
		switch strings.ToLower(strings.TrimSpace(arg)) {
		case "--startup", "-startup", "--minimized", "-minimized", "--background", "-background", "/startup":
			return true
		}
	}
	return false
}

// handleSecondInstanceArgs inspects CLI arguments passed to a second instance and opens confirmation dialogs for URLs/torrents.
func handleSecondInstanceArgs(app *application.App, args []string) {
	if len(args) <= 1 {
		return
	}
	for _, arg := range args[1:] {
		trimmed := strings.TrimSpace(arg)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(lower, "magnet:") || strings.HasSuffix(lower, ".torrent") {
			proto := "Auto"
			if strings.HasPrefix(lower, "magnet:") || strings.HasSuffix(lower, ".torrent") {
				proto = "Torrent"
			}
			commands.OpenDownloadConfirmationWindow(app, map[string]interface{}{
				"url":      trimmed,
				"protocol": proto,
			})
			break
		}
	}
}

func main() {
	// Configure download progress emission FPS (2.0 FPS = 500ms/frame)
	downloader.SetProgressFPS(2.0)

	// Initialize logger (discards in production, logs to stdout and file if --debug in dev)
	initLogger()

	// Cleanly pause all downloads on abrupt OS termination signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("[Main] Received OS termination signal, pausing all active downloads...")
		downloader.GetEngine().PauseAll()
		os.Exit(0)
	}()

	// Handle command-line uninstallation and user data purge
	if shouldPurgeUserData(os.Args[1:]) {
		_ = commands.PurgeAllUserData()
		log.Println("[Main] User configurations and ~/.thunderdm removed successfully.")
		return
	}

	// Initialize Wails Service Commands
	downloadCmd := commands.NewDownloadCommand()
	fileCmd := commands.NewFileCommand()
	queueCmd := commands.NewQueueCommand()
	systemCmd := commands.NewSystemCommand()
	windowCmd := commands.NewWindowCommand()

	// Start background services
	server.SetAppVersion(commands.AppVersion)
	go queue.StartScheduler()
	go server.StartHTTPServer()

	var systray *application.SystemTray

	app := application.New(application.Options{
		Name:        "ThunderDM",
		Description: "Thunder Download Manager",
		Logger:      getWailsLogger(),
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.thunderdm.thunderdm",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				log.Println("[SingleInstance] Second instance launch detected. Restoring main window...")
				if a := application.Get(); a != nil {
					if mainWindow, ok := a.Window.Get("main"); ok && mainWindow != nil {
						mainWindow.Show()
						mainWindow.UnMinimise()
						mainWindow.Restore()
						mainWindow.Focus()
					}
					handleSecondInstanceArgs(a, data.Args)
				}
			},
		},
		OnShutdown: func() {
			log.Println("[Main] Application shutting down, pausing all active downloads...")
			downloader.GetEngine().PauseAll()
			downloader.CloseGlobalTorrentPieceCompletion()
			if systray != nil {
				systray.Destroy()
			}
		},
		Services: []application.Service{
			application.NewService(downloadCmd),
			application.NewService(fileCmd),
			application.NewService(queueCmd),
			application.NewService(systemCmd),
			application.NewService(windowCmd),
		},
	})

	windowCmd.SetApp(app)
	downloadCmd.SetApp(app)
	systemCmd.SetApp(app)

	// Configure GitHub Release Updater
	initAppUpdater(app)

	// Wire up downloader and extension callbacks
	downloader.OnProgressUpdate = func(taskId string, filename string, dl int64, total int64) {
		commands.UpdateHiddenDownloadLive(taskId, filename, dl, total)
	}

	downloader.OnDownloadCompleted = func(payload map[string]interface{}) {
		if id, ok := payload["id"].(string); ok && id != "" {
			windowCmd.RemoveHiddenDownloadCommand(map[string]interface{}{"id": id})
		}
		windowCmd.DebouncedRebuildTrayMenu()
		windowCmd.ShowDownloadCompletedWindow(payload)
	}

	server.OnAddDownloadRequest = func(payload map[string]interface{}) {
		commands.OpenDownloadConfirmationWindow(app, payload)
	}

	isStartupLaunch := isBackgroundStartupLaunch(os.Args[1:])

	// Create main window (starts hidden in system tray if launched on startup)
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "ThunderDM",
		Width:     1174,
		Height:    600,
		Frameless: true,
		URL:       "/",
		Hidden:    isStartupLaunch,
	})

	// Hook window closing event to hide to background/tray instead of destroying
	mainWindow.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		mainWindow.Hide()
	})

	// Setup System Tray
	systray = app.SystemTray.New()
	systray.SetIcon(trayIcon)
	systray.SetLabel("Thunder Download Manager")
	systray.SetTooltip("Thunder Download Manager")
	windowCmd.SetSystray(systray)
	windowCmd.RebuildTrayMenu()

	// Left click and right click both open the tray context menu
	systray.OnClick(func() {
		systray.OpenMenu()
	})

	// Right click opens the tray context menu
	systray.OnRightClick(func() {
		systray.OpenMenu()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
