// Package storage provides pure-Go SQLite persistence for downloads, queues, and application settings.
//
// This file (sqlite_settings.go) manages key-value configuration persistence (`kv_store`)
// and relational `queues` table CRUD operations.
package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// DBQueueItem maps 1:1 with frontend QueueConfig for structured relational persistence.
type DBQueueItem struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	MaxConcurrent        int             `json:"maxConcurrent"`
	ScheduleEnabled      bool            `json:"scheduleEnabled"`
	ActiveDays           json.RawMessage `json:"activeDays"`
	EnableAutoStartTime  bool            `json:"enableAutoStartTime"`
	AutoStartTime        string          `json:"autoStartTime"`
	EnableAutoStopTime   bool            `json:"enableAutoStopTime"`
	AutoStopTime         string          `json:"autoStopTime"`
	IsRunning            bool            `json:"isRunning"`
	ShowRealTimeProgress bool            `json:"showRealTimeProgress,omitempty"`
	ShowCompletionWindow bool            `json:"showCompletionWindow,omitempty"`
}

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

func normalizeKey(key string) string {
	k := strings.TrimSpace(key)
	if strings.HasSuffix(k, ".json") {
		k = strings.TrimSuffix(k, ".json")
	}
	return k
}
