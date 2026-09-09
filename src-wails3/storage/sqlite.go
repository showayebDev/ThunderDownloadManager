package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
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

// DBDownloadItem maps 1:1 with frontend DownloadItem for structured relational persistence.
type DBDownloadItem struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Category         string          `json:"category"`
	URL              string          `json:"url"`
	Size             float64         `json:"size"`
	Downloaded       float64         `json:"downloaded"`
	Status           string          `json:"status"`
	Speed            float64         `json:"speed"`
	TimeLeft         string          `json:"timeLeft"`
	DateAdded        string          `json:"dateAdded"`
	DateCompleted    string          `json:"dateCompleted,omitempty"`
	EndTime          string          `json:"endTime,omitempty"`
	Queue            string          `json:"queue,omitempty"`
	SavePath         string          `json:"savePath"`
	ResumeSupport    string          `json:"resumeSupport"`
	ErrorMessage     string          `json:"errorMessage,omitempty"`
	ThreadCount      int             `json:"threadCount"`
	SpeedLimit       *float64        `json:"speedLimit,omitempty"`
	InTray           bool            `json:"inTray,omitempty"`
	GivenCheckSum    string          `json:"givenCheckSum,omitempty"`
	ExpectedChecksum string          `json:"expectedChecksum,omitempty"`
	ProxyUsed        string          `json:"proxyUsed,omitempty"`
	OrderIndex       int             `json:"orderIndex,omitempty"`
	FileMissing      bool            `json:"fileMissing,omitempty"`
	Protocol         string          `json:"protocol,omitempty"`
	Chunks           json.RawMessage `json:"chunks"`
}

// DBQueueItem maps 1:1 with frontend QueueConfig for structured relational persistence.
type DBQueueItem struct {
	ID                  string          `json:"id"`
	Name                string          `json:"name"`
	MaxConcurrent       int             `json:"maxConcurrent"`
	ScheduleEnabled     bool            `json:"scheduleEnabled"`
	ActiveDays          json.RawMessage `json:"activeDays"`
	EnableAutoStartTime bool            `json:"enableAutoStartTime"`
	AutoStartTime       string          `json:"autoStartTime"`
	EnableAutoStopTime  bool            `json:"enableAutoStopTime"`
	AutoStopTime        string          `json:"autoStopTime"`
	IsRunning           bool            `json:"isRunning"`
	ShowRealTimeProgress bool           `json:"showRealTimeProgress,omitempty"`
	ShowCompletionWindow bool           `json:"showCompletionWindow,omitempty"`
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

// =========================================================================
// Relational Downloads Table Operations
// =========================================================================

// SaveDownloads persists download items into the structured relational downloads table.
func SaveDownloads(jsonStr string) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	var items []DBDownloadItem
	if err := json.Unmarshal([]byte(jsonStr), &items); err != nil {
		return fmt.Errorf("failed to unmarshal downloads json: %w", err)
	}

	db, err := GetDB()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if len(items) == 0 {
		_, err = tx.Exec(`DELETE FROM downloads;`)
		if err != nil {
			return err
		}
		return tx.Commit()
	}

	stmt, err := tx.Prepare(`
	INSERT INTO downloads (
		id, name, category, url, size, downloaded, status, speed, time_left,
		date_added, date_completed, end_time, queue_name, save_path,
		resume_support, error_message, thread_count, speed_limit, in_tray,
		given_checksum, expected_checksum, proxy_used, order_index,
		file_missing, protocol, chunks_json, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name,
		category = excluded.category,
		url = excluded.url,
		size = excluded.size,
		downloaded = excluded.downloaded,
		status = excluded.status,
		speed = excluded.speed,
		time_left = excluded.time_left,
		date_added = excluded.date_added,
		date_completed = excluded.date_completed,
		end_time = excluded.end_time,
		queue_name = excluded.queue_name,
		save_path = excluded.save_path,
		resume_support = excluded.resume_support,
		error_message = excluded.error_message,
		thread_count = excluded.thread_count,
		speed_limit = excluded.speed_limit,
		in_tray = excluded.in_tray,
		given_checksum = excluded.given_checksum,
		expected_checksum = excluded.expected_checksum,
		proxy_used = excluded.proxy_used,
		order_index = excluded.order_index,
		file_missing = excluded.file_missing,
		protocol = excluded.protocol,
		chunks_json = excluded.chunks_json,
		updated_at = CURRENT_TIMESTAMP;
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	activeIDs := make([]string, 0, len(items))
	for idx, d := range items {
		activeIDs = append(activeIDs, d.ID)

		chunksStr := "[]"
		if len(d.Chunks) > 0 {
			chunksStr = string(d.Chunks)
		}

		inTrayInt := 0
		if d.InTray {
			inTrayInt = 1
		}
		fileMissingInt := 0
		if d.FileMissing {
			fileMissingInt = 1
		}

		orderIdx := d.OrderIndex
		if orderIdx == 0 {
			orderIdx = idx
		}

		var speedLimitVal interface{} = nil
		if d.SpeedLimit != nil {
			speedLimitVal = int64(math.Round(*d.SpeedLimit))
		}

		_, err = stmt.Exec(
			d.ID, d.Name, d.Category, d.URL, int64(math.Round(d.Size)), int64(math.Round(d.Downloaded)), d.Status, int64(math.Round(d.Speed)), d.TimeLeft,
			d.DateAdded, d.DateCompleted, d.EndTime, d.Queue, d.SavePath,
			d.ResumeSupport, d.ErrorMessage, d.ThreadCount, speedLimitVal, inTrayInt,
			d.GivenCheckSum, d.ExpectedChecksum, d.ProxyUsed, orderIdx,
			fileMissingInt, d.Protocol, chunksStr,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert download id '%s': %w", d.ID, err)
		}
	}

	if len(activeIDs) > 0 {
		placeholders := make([]string, len(activeIDs))
		args := make([]interface{}, len(activeIDs))
		for i, id := range activeIDs {
			placeholders[i] = "?"
			args[i] = id
		}
		delSQL := fmt.Sprintf(`DELETE FROM downloads WHERE id NOT IN (%s);`, strings.Join(placeholders, ","))
		_, _ = tx.Exec(delSQL, args...)
	}

	return tx.Commit()
}

// GetDownloadsJSON retrieves all download records from relational table as JSON array.
func GetDownloadsJSON() (string, error) {
	db, err := GetDB()
	if err != nil {
		return "[]", err
	}

	rows, err := db.Query(`
	SELECT 
		id, name, category, url, size, downloaded, status, speed, time_left,
		date_added, date_completed, end_time, queue_name, save_path,
		resume_support, error_message, thread_count, speed_limit, in_tray,
		given_checksum, expected_checksum, proxy_used, order_index,
		file_missing, protocol, chunks_json
	FROM downloads
	ORDER BY order_index ASC, rowid ASC;
	`)
	if err != nil {
		return "[]", err
	}
	defer rows.Close()

	items := make([]DBDownloadItem, 0)
	for rows.Next() {
		var (
			d              DBDownloadItem
			sizeInt        int64
			downloadedInt  int64
			speedInt       int64
			speedLimitNull sql.NullInt64
			inTrayInt      int
			fileMissingInt int
			chunksStr      string
		)

		err := rows.Scan(
			&d.ID, &d.Name, &d.Category, &d.URL, &sizeInt, &downloadedInt, &d.Status, &speedInt, &d.TimeLeft,
			&d.DateAdded, &d.DateCompleted, &d.EndTime, &d.Queue, &d.SavePath,
			&d.ResumeSupport, &d.ErrorMessage, &d.ThreadCount, &speedLimitNull, &inTrayInt,
			&d.GivenCheckSum, &d.ExpectedChecksum, &d.ProxyUsed, &d.OrderIndex,
			&fileMissingInt, &d.Protocol, &chunksStr,
		)
		if err != nil {
			return "[]", err
		}

		d.Size = float64(sizeInt)
		d.Downloaded = float64(downloadedInt)
		d.Speed = float64(speedInt)
		if speedLimitNull.Valid {
			v := float64(speedLimitNull.Int64)
			d.SpeedLimit = &v
		}
		d.InTray = (inTrayInt == 1)
		d.FileMissing = (fileMissingInt == 1)
		if chunksStr != "" {
			d.Chunks = json.RawMessage(chunksStr)
		} else {
			d.Chunks = json.RawMessage("[]")
		}

		items = append(items, d)
	}

	bytes, err := json.Marshal(items)
	if err != nil {
		return "[]", err
	}
	return string(bytes), nil
}

// =========================================================================
// Relational Queues Table Operations
// =========================================================================

// SaveQueues persists queue configurations into the structured relational queues table.
func SaveQueues(jsonStr string) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	var items []DBQueueItem
	if err := json.Unmarshal([]byte(jsonStr), &items); err != nil {
		return fmt.Errorf("failed to unmarshal queues json: %w", err)
	}

	db, err := GetDB()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if len(items) == 0 {
		_, err = tx.Exec(`DELETE FROM queues;`)
		if err != nil {
			return err
		}
		return tx.Commit()
	}

	stmt, err := tx.Prepare(`
	INSERT INTO queues (
		id, name, max_concurrent, schedule_enabled, active_days_json,
		enable_auto_start_time, auto_start_time, enable_auto_stop_time,
		auto_stop_time, is_running, show_real_time_progress, show_completion_window, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name,
		max_concurrent = excluded.max_concurrent,
		schedule_enabled = excluded.schedule_enabled,
		active_days_json = excluded.active_days_json,
		enable_auto_start_time = excluded.enable_auto_start_time,
		auto_start_time = excluded.auto_start_time,
		enable_auto_stop_time = excluded.enable_auto_stop_time,
		auto_stop_time = excluded.auto_stop_time,
		is_running = excluded.is_running,
		show_real_time_progress = excluded.show_real_time_progress,
		show_completion_window = excluded.show_completion_window,
		updated_at = CURRENT_TIMESTAMP;
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	activeIDs := make([]string, 0, len(items))
	for _, q := range items {
		activeIDs = append(activeIDs, q.ID)

		activeDaysStr := `["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]`
		if len(q.ActiveDays) > 0 {
			activeDaysStr = string(q.ActiveDays)
		}

		schedInt := 0
		if q.ScheduleEnabled {
			schedInt = 1
		}
		autoStartInt := 0
		if q.EnableAutoStartTime {
			autoStartInt = 1
		}
		autoStopInt := 0
		if q.EnableAutoStopTime {
			autoStopInt = 1
		}
		isRunningInt := 0
		if q.IsRunning {
			isRunningInt = 1
		}
		showProgressInt := 0
		if q.ShowRealTimeProgress {
			showProgressInt = 1
		}
		showCompInt := 0
		if q.ShowCompletionWindow {
			showCompInt = 1
		}

		_, err = stmt.Exec(
			q.ID, q.Name, q.MaxConcurrent, schedInt, activeDaysStr,
			autoStartInt, q.AutoStartTime, autoStopInt, q.AutoStopTime, isRunningInt,
			showProgressInt, showCompInt,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert queue id '%s': %w", q.ID, err)
		}
	}

	if len(activeIDs) > 0 {
		placeholders := make([]string, len(activeIDs))
		args := make([]interface{}, len(activeIDs))
		for i, id := range activeIDs {
			placeholders[i] = "?"
			args[i] = id
		}
		delSQL := fmt.Sprintf(`DELETE FROM queues WHERE id NOT IN (%s);`, strings.Join(placeholders, ","))
		_, _ = tx.Exec(delSQL, args...)
	}

	return tx.Commit()
}

// GetQueuesJSON retrieves all queue configurations from relational table as JSON array.
func GetQueuesJSON() (string, error) {
	db, err := GetDB()
	if err != nil {
		return "[]", err
	}

	rows, err := db.Query(`
	SELECT 
		id, name, max_concurrent, schedule_enabled, active_days_json,
		enable_auto_start_time, auto_start_time, enable_auto_stop_time,
		auto_stop_time, is_running, show_real_time_progress, show_completion_window
	FROM queues
	ORDER BY rowid ASC;
	`)
	if err != nil {
		return "[]", err
	}
	defer rows.Close()

	items := make([]DBQueueItem, 0)
	for rows.Next() {
		var (
			q               DBQueueItem
			schedInt        int
			autoStartInt    int
			autoStopInt     int
			isRunningInt    int
			showProgressInt int
			showCompInt     int
			activeDaysStr   string
		)

		err := rows.Scan(
			&q.ID, &q.Name, &q.MaxConcurrent, &schedInt, &activeDaysStr,
			&autoStartInt, &q.AutoStartTime, &autoStopInt, &q.AutoStopTime, &isRunningInt,
			&showProgressInt, &showCompInt,
		)
		if err != nil {
			return "[]", err
		}

		q.ScheduleEnabled = (schedInt == 1)
		q.EnableAutoStartTime = (autoStartInt == 1)
		q.EnableAutoStopTime = (autoStopInt == 1)
		q.IsRunning = (isRunningInt == 1)
		q.ShowRealTimeProgress = (showProgressInt == 1)
		q.ShowCompletionWindow = (showCompInt == 1)
		if activeDaysStr != "" {
			q.ActiveDays = json.RawMessage(activeDaysStr)
		} else {
			q.ActiveDays = json.RawMessage(`["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]`)
		}

		items = append(items, q)
	}

	bytes, err := json.Marshal(items)
	if err != nil {
		return "[]", err
	}
	return string(bytes), nil
}

// =========================================================================
// Key-Value Table Operations (General Configs)
// =========================================================================

// GetKV retrieves a value by key from SQLite kv_store.
func GetKV(key string) (string, error) {
	cleanKey := normalizeKey(key)
	db, err := GetDB()
	if err != nil {
		return "", err
	}

	var value string
	query := `SELECT value FROM kv_store WHERE key = ? LIMIT 1;`
	err = db.QueryRow(query, cleanKey).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}

	return value, nil
}

// SetKV inserts or updates a key-value document in SQLite kv_store.
func SetKV(key string, value string) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	cleanKey := normalizeKey(key)
	db, err := GetDB()
	if err != nil {
		return err
	}

	query := `
	INSERT INTO kv_store (key, value, updated_at)
	VALUES (?, ?, CURRENT_TIMESTAMP)
	ON CONFLICT(key) DO UPDATE SET
		value = excluded.value,
		updated_at = CURRENT_TIMESTAMP;
	`
	_, err = db.Exec(query, cleanKey, value)
	return err
}

// DeleteKV removes a key from SQLite kv_store.
func DeleteKV(key string) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	cleanKey := normalizeKey(key)
	db, err := GetDB()
	if err != nil {
		return err
	}

	_, err = db.Exec(`DELETE FROM kv_store WHERE key = ?;`, cleanKey)
	return err
}

// UpdateDownloadThreadCount updates the thread_count column for a specific download ID.
func UpdateDownloadThreadCount(id string, threads int) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	db, err := GetDB()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE downloads SET thread_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, threads, id)
	return err
}

// UpdateDownloadSpeedLimit updates the speed_limit column for a specific download ID.
func UpdateDownloadSpeedLimit(id string, speedLimit *int64) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	db, err := GetDB()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE downloads SET speed_limit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, speedLimit, id)
	return err
}

// CheckFilenameExists checks if a download with the given name exists in SQLite downloads table.
func CheckFilenameExists(savePath, filename string) bool {
	cleanFile := strings.TrimSpace(filename)
	if cleanFile == "" {
		return false
	}
	db, err := GetDB()
	if err != nil {
		return false
	}
	cleanSave := filepath.Clean(savePath)
	var count int
	if cleanSave == "." || cleanSave == "" {
		_ = db.QueryRow(`SELECT COUNT(1) FROM downloads WHERE LOWER(name) = LOWER(?) LIMIT 1;`, cleanFile).Scan(&count)
	} else {
		_ = db.QueryRow(`SELECT COUNT(1) FROM downloads WHERE LOWER(name) = LOWER(?) AND (save_path = '' OR LOWER(save_path) = LOWER(?)) LIMIT 1;`, cleanFile, cleanSave).Scan(&count)
	}
	return count > 0
}

func normalizeKey(key string) string {
	k := strings.TrimSpace(key)
	if strings.HasSuffix(k, ".json") {
		k = strings.TrimSuffix(k, ".json")
	}
	return k
}
