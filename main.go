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
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed src-wails3/icons/icon_64x64.png
var trayIcon []byte

func main() {
	// Configure download progress emission FPS (e.g. fps := 1.0 for 1s/frame, fps := 0.5 for 2s/frame)
	fps := 1.0
	downloader.SetProgressFPS(fps)

	// Initialize logger (discards in production, only logs file if --debug in dev)
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
	for _, arg := range os.Args[1:] {
		trimmed := strings.ToLower(strings.TrimSpace(arg))
		if trimmed == "--uninstall" || trimmed == "--purge" || trimmed == "--clean-data" {
			_ = commands.PurgeAllUserData()
			log.Println("[Main] User configurations and ~/.thunderdm removed successfully.")
			return
		}
	}

	// Initialize Commands
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
					// If a URL was passed to the 2nd instance via command line
					if len(data.Args) > 1 {
						for _, arg := range data.Args[1:] {
							trimmed := strings.TrimSpace(arg)
							if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
								commands.OpenDownloadConfirmationWindow(a, map[string]interface{}{
									"url": trimmed,
								})
								break
							}
						}
					}
				}
			},
		},
		OnShutdown: func() {
			log.Println("[Main] Application shutting down, pausing all active downloads...")
			downloader.GetEngine().PauseAll()
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

	windowCmd.SetApp(app) // Provide app reference to spawn windows
	downloadCmd.SetApp(app)
	systemCmd.SetApp(app)

	// Configure GitHub Updater
	ghProvider, err := github.New(github.Config{
		Repository: "showayebDev/ThunderDownloadManager",
		Prerelease: false,
		AssetMatcher: func(req updater.CheckRequest, assets []github.ReleaseAsset) int {
			plat := strings.ToLower(req.Platform) // e.g. "windows", "darwin", "linux"

			// Helper to check if an asset is a sidecar or non-app package
			isIgnored := func(name string) bool {
				return strings.HasSuffix(name, ".sig") || strings.HasSuffix(name, ".asc") ||
					strings.HasSuffix(name, ".sha256") || strings.HasSuffix(name, ".sums") ||
					strings.HasSuffix(name, ".txt") || strings.HasSuffix(name, ".md") ||
					strings.Contains(name, "extension") || strings.HasSuffix(name, ".xpi") ||
					strings.HasSuffix(name, ".crx")
			}

			// 1. Preferred platform matches
			for i, a := range assets {
				name := strings.ToLower(a.Name)
				if isIgnored(name) {
					continue
				}

				if plat == "windows" {
					if strings.Contains(name, "mac") || strings.Contains(name, "darwin") || strings.Contains(name, "linux") ||
						strings.HasSuffix(name, ".deb") || strings.HasSuffix(name, ".rpm") || strings.HasSuffix(name, ".dmg") {
						continue
					}
					if strings.HasSuffix(name, ".exe") && (strings.Contains(name, "universal") || strings.Contains(name, "windows") || strings.Contains(name, "win") || strings.Contains(name, "setup")) {
						return i
					}
				} else if plat == "darwin" {
					if strings.Contains(name, "windows") || strings.Contains(name, "linux") || strings.HasSuffix(name, ".exe") ||
						strings.HasSuffix(name, ".deb") || strings.HasSuffix(name, ".rpm") {
						continue
					}
					if strings.HasSuffix(name, ".zip") && (strings.Contains(name, "mac") || strings.Contains(name, "darwin") || strings.Contains(name, "apple") || strings.Contains(name, "universal")) {
						return i
					}
					if strings.HasSuffix(name, ".dmg") {
						return i
					}
				} else if plat == "linux" {
					if strings.Contains(name, "windows") || strings.Contains(name, "mac") || strings.Contains(name, "darwin") ||
						strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".dmg") {
						continue
					}
					if strings.HasSuffix(name, ".appimage") {
						return i
					}
					if strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") {
						return i
					}
				}
			}

			// 2. Secondary fallback matching
			for i, a := range assets {
				name := strings.ToLower(a.Name)
				if isIgnored(name) {
					continue
				}

				if plat == "windows" && (strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".zip")) {
					return i
				} else if plat == "darwin" && (strings.HasSuffix(name, ".zip") || strings.HasSuffix(name, ".dmg") || strings.Contains(name, "mac") || strings.Contains(name, "darwin")) {
					return i
				} else if plat == "linux" && (strings.HasSuffix(name, ".appimage") || strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz") || strings.Contains(name, "linux")) {
					return i
				}
			}

			// 3. Last fallback: pick first non-ignored asset
			for i, a := range assets {
				name := strings.ToLower(a.Name)
				if !isIgnored(name) {
					return i
				}
			}
			return -1
		},
	})
	if err != nil {
		log.Printf("[Main] Failed to create GitHub updater provider: %v", err)
	} else {
		err = app.Updater.Init(updater.Config{
			CurrentVersion: commands.AppVersion,
			Providers: []updater.Provider{
				ghProvider,
			},
		})
		if err != nil {
			log.Printf("[Main] Failed to initialize App Updater: %v", err)
		} else {
			log.Printf("[Main] App Updater initialized successfully (Repo: showayebDev/ThunderDownloadManager, Version: %s)", commands.AppVersion)
		}
	}

	// Wire up package callbacks
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

	// Wire up browser extension add download requests
	server.OnAddDownloadRequest = func(payload map[string]interface{}) {
		commands.OpenDownloadConfirmationWindow(app, payload)
	}

	// Check if started via Windows Startup in background mode
	isStartupLaunch := false
	for _, arg := range os.Args[1:] {
		lower := strings.ToLower(strings.TrimSpace(arg))
		if lower == "--startup" || lower == "-startup" || lower == "--minimized" || lower == "-minimized" || lower == "--background" || lower == "-background" || lower == "/startup" {
			isStartupLaunch = true
			break
		}
	}

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

	err = app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
