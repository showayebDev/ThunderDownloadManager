// Package storage provides pure-Go SQLite persistence for downloads, queues, and application settings.
//
// This file (sqlite_downloads.go) implements structured CRUD, metadata/progress updates,
// filename existence checks, and batch deletion for the relational `downloads` table.
package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"
)

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

// UpdateDownloadMetadata updates the name and total size of a download.
func UpdateDownloadMetadata(id string, name string, size int64) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	db, err := GetDB()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE downloads SET name = ?, size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, name, size, id)
	return err
}

// UpdateDownloadProgress updates the progress, status, and error message of a download.
func UpdateDownloadProgress(id string, downloaded int64, totalSize int64, status string, errMsg string, chunks []byte) error {
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	db, err := GetDB()
	if err != nil {
		return err
	}

	if status == "Finished" && totalSize <= 0 && downloaded > 0 {
		totalSize = downloaded
	} else if totalSize <= 0 && downloaded > 0 {
		totalSize = downloaded
	}

	if len(chunks) > 0 {
		_, err = db.Exec(`UPDATE downloads SET downloaded = ?, size = ?, status = ?, error_message = ?, chunks_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, downloaded, totalSize, status, errMsg, string(chunks), id)
	} else {
		_, err = db.Exec(`UPDATE downloads SET downloaded = ?, size = ?, status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, downloaded, totalSize, status, errMsg, id)
	}
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

// DeleteDownloads removes multiple download records from SQLite downloads table by their IDs.
func DeleteDownloads(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	dbWriteMu.Lock()
	defer dbWriteMu.Unlock()

	db, err := GetDB()
	if err != nil {
		return err
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`DELETE FROM downloads WHERE id IN (%s);`, strings.Join(placeholders, ","))
	_, err = db.Exec(query, args...)
	return err
}
