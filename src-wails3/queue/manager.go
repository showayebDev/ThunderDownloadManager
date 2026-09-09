package queue

import (
	"sync"
)

type Manager struct {
	queues map[string]*QueueConfig
	mu     sync.RWMutex
}

var instance *Manager
var once sync.Once

func GetManager() *Manager {
	once.Do(func() {
		instance = &Manager{
			queues: make(map[string]*QueueConfig),
		}
	})
	return instance
}

func (m *Manager) AddQueue(name string, config *QueueConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.queues[name] = config
}

func (m *Manager) GetQueue(name string) (*QueueConfig, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	val, ok := m.queues[name]
	return val, ok
}
