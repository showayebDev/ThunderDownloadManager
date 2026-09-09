package queue

type QueueConfig struct {
	Name           string   `json:"name"`
	MaxActiveTasks int      `json:"maxActiveTasks"`
	ActiveTaskIDs  []string `json:"activeTaskIds"`
	PendingTaskIDs []string `json:"pendingTaskIds"`
}

func NewQueueConfig(name string, maxActive int) *QueueConfig {
	return &QueueConfig{
		Name:           name,
		MaxActiveTasks: maxActive,
		ActiveTaskIDs:  make([]string, 0),
		PendingTaskIDs: make([]string, 0),
	}
}
