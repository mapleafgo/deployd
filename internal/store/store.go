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
	mu        sync.RWMutex
	jobs      map[string]*jobEntry // jobID -> entry
	nameIndex map[string]string    // name -> jobID (反向索引，优化查找)
}

// New 创建存储实例
func New() *Store {
	return &Store{
		jobs:      make(map[string]*jobEntry),
		nameIndex: make(map[string]string),
	}
}

// Add 添加运行中的任务
func (s *Store) Add(jobID, name string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[jobID] = &jobEntry{name: name, cancel: cancel}
	s.nameIndex[name] = jobID // 维护反向索引
}

// GetRunning 获取指定名称正在运行的任务 ID
// 使用反向索引优化查找性能：O(1) 而不是 O(n)
func (s *Store) GetRunning(name string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.nameIndex[name]
}

// Cancel 取消任务
func (s *Store) Cancel(jobID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.jobs[jobID]; ok {
		entry.cancel()
		delete(s.jobs, jobID)
		delete(s.nameIndex, entry.name) // 清理反向索引
		return true
	}
	return false
}

// Delete 删除任务记录
func (s *Store) Delete(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.jobs[jobID]; ok {
		delete(s.nameIndex, entry.name) // 清理反向索引
	}
	delete(s.jobs, jobID)
}
