// internal/store/store.go
package store

import (
	"context"
	"sync"
)

// jobEntry 运行中的任务条目
type jobEntry struct {
	name   string
	cancel context.CancelFunc
}

// Store 运行时状态存储
type Store struct {
	mu   sync.RWMutex
	jobs map[string]*jobEntry // jobID -> entry
}

// New 创建存储实例
func New() *Store {
	return &Store{
		jobs: make(map[string]*jobEntry),
	}
}

// Add 添加运行中的任务
func (s *Store) Add(jobID, name string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[jobID] = &jobEntry{name: name, cancel: cancel}
}

// GetRunning 获取指定名称正在运行的任务 ID
func (s *Store) GetRunning(name string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for jobID, entry := range s.jobs {
		if entry.name == name {
			return jobID
		}
	}
	return ""
}

// Cancel 取消任务
func (s *Store) Cancel(jobID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.jobs[jobID]; ok {
		entry.cancel()
		delete(s.jobs, jobID)
		return true
	}
	return false
}

// Delete 删除任务记录
func (s *Store) Delete(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.jobs, jobID)
}
