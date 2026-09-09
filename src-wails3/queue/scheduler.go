package queue

import (
	"time"
)

// StartScheduler starts the background loop checking queue constraints
func StartScheduler() {
	ticker := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-ticker.C:
			// Logic to check queue constraints and start paused tasks
			// TODO: check free slots, get paused tasks, and start them
		}
	}
}
