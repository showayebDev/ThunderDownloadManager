//go:build !production

package main

import (
	"io"
	"log"
	"log/slog"
	"os"
)

var wailsLogger *slog.Logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

func initLogger() {
	log.SetOutput(os.Stdout)
	log.SetFlags(log.Ldate | log.Ltime)

	// In development builds, also write to a debug file if the --debug flag is explicitly passed.
	for _, arg := range os.Args[1:] {
		if arg == "--debug" || arg == "-d" {
			logFile, err := os.OpenFile("ThunderDM_debug.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
			if err == nil {
				mw := io.MultiWriter(os.Stdout, logFile)
				log.SetOutput(mw)
				log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
				log.Println("--- DEV APP START ---")
				wailsLogger = slog.New(slog.NewTextHandler(mw, &slog.HandlerOptions{Level: slog.LevelDebug}))
			}
			return
		}
	}
}

func getWailsLogger() *slog.Logger {
	return wailsLogger
}
