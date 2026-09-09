package commands

import (
	"context"
	"log"
)

type QueueCommand struct {
	ctx context.Context
}

func NewQueueCommand() *QueueCommand {
	return &QueueCommand{}
}

func (c *QueueCommand) SetContext(ctx context.Context) {
	c.ctx = ctx
}

type QueueConfig struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	MaxConcurrentDownloads int      `json:"max_concurrent_downloads"`
	ScheduleEnabled        bool     `json:"schedule_enabled"`
	StartTime              *string  `json:"start_time"`
	StopTime               *string  `json:"stop_time"`
	Days                   []string `json:"days"`
	IsRunning              bool     `json:"is_running"`
	ShowRealTimeProgress   bool     `json:"show_real_time_progress,omitempty"`
	ShowCompletionWindow   bool     `json:"show_completion_window,omitempty"`
}

// Temporary in-memory store for queues
var queues []QueueConfig

func (c *QueueCommand) FetchQueue() ([]QueueConfig, error) {
	log.Println("[QueueCommand] FetchQueue called")
	return queues, nil
}

func (c *QueueCommand) UpdateQueue(config QueueConfig) error {
	log.Printf("[QueueCommand] UpdateQueue called for %s", config.ID)
	found := false
	for i, q := range queues {
		if q.ID == config.ID {
			queues[i] = config
			found = true
			break
		}
	}
	if !found {
		queues = append(queues, config)
	}
	return nil
}

func (c *QueueCommand) DeleteQueue(id string) error {
	log.Printf("[QueueCommand] DeleteQueue called for %s", id)
	if id == "main" || id == "Main" {
		return nil // Cannot delete default queue
	}
	var updated []QueueConfig
	for _, q := range queues {
		if q.ID != id {
			updated = append(updated, q)
		}
	}
	queues = updated
	return nil
}

