// Package storage provides pure-Go SQLite persistence for downloads, queues, and application settings.
//
// This file (sqlite.go) manages the SQLite database connection lifecycle, WAL/performance
// PRAGMA configuration, relational schema initialization, and storage path resolution.
package storage

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

var (
	dbInstance   *sql.DB
	dbInitOnce   sync.Once
	dbInitErr    error
	customDBPath string
	dbWriteMu    sync.Mutex
)

// SetCustomDBPath sets a custom database file path (e.g. for isolated testing).
func SetCustomDBPath(p string) {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()
	if dbInstance != nil {
		_ = dbInstance.Close()
	}
	customDBPath = p
	dbInstance = nil
	dbInitOnce = sync.Once{}
}

// GetStorageDir returns the primary ~/.thunderdm directory path.
func GetStorageDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".thunderdm")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// GetDBPath returns the absolute path to thunderdm.db.
func GetDBPath() (string, error) {
	if customDBPath != "" {
		return customDBPath, nil
	}
	if env := os.Getenv("THUNDERDM_DB_PATH"); env != "" {
		return env, nil
	}
	dir, err := GetStorageDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "thunderdm.db"), nil
}

// InitStorage initializes the SQLite database with separate relational tables and indexes.
func InitStorage() (*sql.DB, error) {
	dbInitOnce.Do(func() {
		dbPath, err := GetDBPath()
		if err != nil {
			dbInitErr = err
			return
		}

		dsn := fmt.Sprintf("%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=temp_store(MEMORY)&_pragma=cache_size(-64000)", dbPath)
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			dbInitErr = fmt.Errorf("failed to open sqlite database: %w", err)
			return
		}

		// Single-writer connection pool to guarantee zero lock contention in pure Go SQLite
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)

		// Set SQLite PRAGMAs explicitly
		_, _ = db.Exec(`PRAGMA journal_mode = WAL;`)
		_, _ = db.Exec(`PRAGMA busy_timeout = 10000;`)
		_, _ = db.Exec(`PRAGMA synchronous = NORMAL;`)
		_, _ = db.Exec(`PRAGMA temp_store = MEMORY;`)

		// Create Relational Schema with Dedicated Tables and B-Tree Indexes
		schemaSQL := `
		-- 1. Key-Value table for general configurations (appearance, settings)
		CREATE TABLE IF NOT EXISTS kv_store (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_kv_store_key ON kv_store(key);

		-- 2. Structured downloads table with dedicated columns
		CREATE TABLE IF NOT EXISTS downloads (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT 'All',
			url TEXT NOT NULL DEFAULT '',
			size INTEGER NOT NULL DEFAULT 0,
			downloaded INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'Pending',
			speed INTEGER NOT NULL DEFAULT 0,
			time_left TEXT NOT NULL DEFAULT '',
			date_added TEXT NOT NULL DEFAULT '',
			date_completed TEXT NOT NULL DEFAULT '',
			end_time TEXT NOT NULL DEFAULT '',
			queue_name TEXT NOT NULL DEFAULT '',
			save_path TEXT NOT NULL DEFAULT '',
			resume_support TEXT NOT NULL DEFAULT 'Unknown',
			error_message TEXT NOT NULL DEFAULT '',
			thread_count INTEGER NOT NULL DEFAULT 8,
			speed_limit INTEGER DEFAULT NULL,
			in_tray INTEGER NOT NULL DEFAULT 0,
			given_checksum TEXT NOT NULL DEFAULT '',
			expected_checksum TEXT NOT NULL DEFAULT '',
			proxy_used TEXT NOT NULL DEFAULT '',
			order_index INTEGER NOT NULL DEFAULT 0,
			file_missing INTEGER NOT NULL DEFAULT 0,
			protocol TEXT NOT NULL DEFAULT 'HTTP',
			chunks_json TEXT NOT NULL DEFAULT '[]',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		-- Performance and Search Indexes for Downloads
		CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
		CREATE INDEX IF NOT EXISTS idx_downloads_category ON downloads(category);
		CREATE INDEX IF NOT EXISTS idx_downloads_queue ON downloads(queue_name);
		CREATE INDEX IF NOT EXISTS idx_downloads_name ON downloads(name);
		CREATE INDEX IF NOT EXISTS idx_downloads_url ON downloads(url);
		CREATE INDEX IF NOT EXISTS idx_downloads_date_added ON downloads(date_added);
		CREATE INDEX IF NOT EXISTS idx_downloads_order ON downloads(order_index, id);

		-- 3. Structured queues table with dedicated columns
		CREATE TABLE IF NOT EXISTS queues (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			max_concurrent INTEGER NOT NULL DEFAULT 2,
			schedule_enabled INTEGER NOT NULL DEFAULT 0,
			active_days_json TEXT NOT NULL DEFAULT '[]',
			enable_auto_start_time INTEGER NOT NULL DEFAULT 0,
			auto_start_time TEXT NOT NULL DEFAULT '02:30',
			enable_auto_stop_time INTEGER NOT NULL DEFAULT 0,
			auto_stop_time TEXT NOT NULL DEFAULT '07:30',
			is_running INTEGER NOT NULL DEFAULT 0,
			show_real_time_progress INTEGER NOT NULL DEFAULT 0,
			show_completion_window INTEGER NOT NULL DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_queues_name ON queues(name);
		`

		if _, err := db.Exec(schemaSQL); err != nil {
			dbInitErr = fmt.Errorf("failed to create relational database schema: %w", err)
			_ = db.Close()
			return
		}

		// Non-destructive column additions for existing databases
		_, _ = db.Exec(`ALTER TABLE queues ADD COLUMN show_real_time_progress INTEGER NOT NULL DEFAULT 0;`)
		_, _ = db.Exec(`ALTER TABLE queues ADD COLUMN show_completion_window INTEGER NOT NULL DEFAULT 0;`)

		dbInstance = db
		log.Printf("[Storage] Pure SQLite database initialized successfully at %s (Tables: downloads, queues, kv_store)", dbPath)
	})

	return dbInstance, dbInitErr
}

// GetDB returns the active SQLite database instance.
func GetDB() (*sql.DB, error) {
	if dbInstance == nil {
		return InitStorage()
	}
	return dbInstance, nil
}
