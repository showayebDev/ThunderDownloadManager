//go:build !production

package main

import (
	"io"
	"log"
	"log/slog"
	"os"
)

var wailsLogger *slog.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))

func initLogger() {
	// In development builds, write to a debug file only if the --debug flag is explicitly passed.
	for _, arg := range os.Args[1:] {
		if arg == "--debug" || arg == "-d" {
			logFile, err := os.OpenFile("ThunderDM_debug.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
			if err == nil {
				log.SetOutput(logFile)
				log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
				log.Println("--- DEV APP START ---")
				wailsLogger = slog.New(slog.NewTextHandler(logFile, &slog.HandlerOptions{Level: slog.LevelDebug}))
			}
			return
		}
	}
	// Default: discard log output to keep console clean
	log.SetOutput(io.Discard)
	wailsLogger = slog.New(slog.NewTextHandler(io.Discard, nil))
}

func getWailsLogger() *slog.Logger {
	return wailsLogger
}
