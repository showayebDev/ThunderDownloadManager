//go:build production

package main

import (
	"io"
	"log"
	"log/slog"
)

func initLogger() {
	// In production builds, no debug log file is created on disk.
	log.SetOutput(io.Discard)
}

func getWailsLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
