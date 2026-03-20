// internal/job/manager.go
package job

import (
	"context"
	"log/slog"
	"sync"

	"github.com/mapleafgo/deployd/internal/config"
	"github.com/mapleafgo/deployd/internal/logger"
	"github.com/mapleafgo/deployd/internal/store"
)

// Manager 任务管理器
type Manager struct {
	store  *store.Store
	logDir string
	log    *slog.Logger
	locks  sync.Map // job name -> *sync.Mutex
}

// NewManager 创建任务管理器
func NewManager(s *store.Store, logDir string, log *slog.Logger) *Manager {
	return &Manager{
		store:  s,
		logDir: logDir,
		log:    log,
	}
}

// getLock 获取指定 job name 的锁
func (m *Manager) getLock(name string) *sync.Mutex {
	actual, _ := m.locks.LoadOrStore(name, new(sync.Mutex))
	return actual.(*sync.Mutex)
}

// Trigger 触发任务
func (m *Manager) Trigger(name string, cfg *config.JobConfig, env map[string]string) (string, error) {
	jobID := GenerateJobID()
	lock := m.getLock(name)

	// terminate 模式：取消正在运行的同名任务
	if cfg.Queue == "terminate" {
		if runningID := m.store.GetRunning(name); runningID != "" {
			m.store.Cancel(runningID)
			m.log.Info("terminated running job", "job_id", runningID, "name", name)
		}
	}

	// 异步执行（获取锁后串行）
	go func() {
		lock.Lock()
		defer lock.Unlock()
		m.execute(name, cfg, env, jobID)
	}()

	m.log.Info("job triggered", "job", name, "job_id", jobID, "queue", cfg.Queue)
	return jobID, nil
}

// execute 执行任务
func (m *Manager) execute(name string, cfg *config.JobConfig, env map[string]string, jobID string) {
	defer m.store.Delete(jobID)

	// 创建日志记录器
	log, err := logger.New(m.logDir, jobID, name)
	if err != nil {
		m.log.Error("failed to create logger", "error", err, "job_id", jobID)
		return
	}
	defer log.Close()

	// 创建带超时的上下文
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
	defer cancel()

	// 注册到 store
	m.store.Add(jobID, name, cancel)

	// 执行
	runner := NewRunner(cfg, env, log, jobID)
	if err := runner.Run(ctx); err != nil {
		m.log.Error("job execution failed", "error", err, "job_id", jobID)
	}
}
