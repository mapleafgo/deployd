package backend

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"red-berry-kit/boot/backend/diagnostics"
)

// Step 中的每个 command 是独立 Shell；步骤之间可串行或并行。
type Step struct {
	Name     string            `json:"name" minLength:"1" maxLength:"100"`
	Workdir  string            `json:"workdir"`
	Env      map[string]string `json:"env"`
	Commands []string          `json:"commands" minItems:"1" maxItems:"100" nullable:"false"`
}

// TaskInput 是任务完整替换输入。
type TaskInput struct {
	Description string `json:"description" maxLength:"500"`
	// Workdir 除公开 Schema 外还受操作系统路径字节上限4096约束。
	Workdir string `json:"workdir" minLength:"1" maxLength:"4096"`
	Timeout string `json:"timeout" default:"30m"`
	// SchedulingPolicy 控制同名运行调度，JSON 字段沿用 queue。
	SchedulingPolicy string            `json:"queue" enum:"wait,terminate" default:"wait"`
	Parallel         bool              `json:"parallel"`
	Env              map[string]string `json:"env"`
	Steps            []Step            `json:"steps" minItems:"1" maxItems:"100" nullable:"false"`
}

// Task 是管理端任务详情，包含仅管理员可见的 Webhook 令牌；完整更新保留令牌。
type Task struct {
	Name string `json:"name"`
	TaskInput
	Token     string    `json:"token"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Run 是独立于任务当前配置的持久化历史；终态不可重新执行，未落盘终态仍可查询。
type Run struct {
	ID string `json:"id"`
	// TaskName 是所属任务名称，JSON 字段沿用 name。
	TaskName   string     `json:"name"`
	Status     string     `json:"status" enum:"queued,running,success,failed,cancelled,timeout,interrupted"`
	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

var (
	errInvalid      = errors.New("invalid")
	errMissing      = errors.New("missing")
	errConflict     = errors.New("conflict")
	errHookDenied   = errors.New("hook denied")
	taskNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
	// 历史运行ID沿用既有安全字符范围，不将任务名规则当作运行ID领域规则。
	runIDPattern   = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
	envNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
)

func now() time.Time { return time.Now().UTC() }
func terminal(status string) bool {
	switch status {
	case "success", "failed", "cancelled", "timeout", "interrupted":
		return true
	}
	return false
}
func clone[T any](value T) T {
	data, _ := json.Marshal(value)
	var out T
	_ = json.Unmarshal(data, &out)
	return out
}
func writeJSONAtomically(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".write-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	if err = os.Rename(name, path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

type execution struct {
	run    Run
	cancel context.CancelFunc
	done   chan struct{}
}
type taskService struct {
	mu             sync.Mutex
	dir            string
	tasks          map[string]Task
	active         map[string]*execution
	unsavedResults map[string]Run
	tails          map[string]chan struct{}
	ctx            context.Context
	closing        bool
	lock           *os.File
	wg             sync.WaitGroup
	retryCancel    context.CancelFunc
	retryDone      chan struct{}
	retryAttempts  map[string]uint64
}

func newTaskService(cfg Config) *taskService {
	return &taskService{dir: cfg.DataDir, tasks: map[string]Task{}, active: map[string]*execution{}, unsavedResults: map[string]Run{}, tails: map[string]chan struct{}{}}
}
func (s *taskService) taskPath(name string) string {
	return filepath.Join(s.dir, "tasks", name+".json")
}
func (s *taskService) runPath(id string) string { return filepath.Join(s.dir, "runs", id+".json") }
func (s *taskService) logPath(id string) string { return filepath.Join(s.dir, "runs", id+".log") }
func ensurePrivateDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("storage directory is not a real directory")
	}
	return os.Chmod(path, 0700)
}
func readJSON(path string, value any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("persisted record is not a regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}
func (s *taskService) start(ctx context.Context) (result error) {
	finish := diagnostics.Start(ctx, "tasks", "storage.start")
	defer func() { finish(result) }()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, path := range []string{s.dir, filepath.Join(s.dir, "tasks"), filepath.Join(s.dir, "runs")} {
		if err := ensurePrivateDir(path); err != nil {
			return err
		}
	}
	lockPath := filepath.Join(s.dir, ".lock")
	fd, err := syscall.Open(lockPath, syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	lock := os.NewFile(uintptr(fd), lockPath)
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = lock.Close()
		return err
	}
	defer func() {
		if result != nil {
			_ = syscall.Flock(fd, syscall.LOCK_UN)
			_ = lock.Close()
		}
	}()
	entries, err := os.ReadDir(filepath.Join(s.dir, "tasks"))
	if err != nil {
		return err
	}
	loaded := map[string]Task{}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		var task Task
		if err := readJSON(filepath.Join(s.dir, "tasks", entry.Name()), &task); err != nil {
			return err
		}
		if !taskNamePattern.MatchString(task.Name) || entry.Name() != task.Name+".json" || validateTask(task.TaskInput) != nil || task.Token == "" {
			return errors.New("persisted task has invalid identity, configuration or token")
		}
		loaded[task.Name] = task
	}
	runs, err := s.diskRuns()
	if err != nil {
		return err
	}
	for _, run := range runs {
		if !terminal(run.Status) {
			run.Status = "interrupted"
			at := now()
			run.FinishedAt = &at
			if err := writeJSONAtomically(s.runPath(run.ID), run); err != nil {
				return err
			}
		}
	}
	s.tasks = loaded
	s.ctx = ctx
	s.lock = lock
	s.closing = false
	retryCtx, cancel := context.WithCancel(context.Background())
	s.retryCancel = cancel
	s.retryDone = make(chan struct{})
	go s.retryResultPersistence(retryCtx)
	return nil
}
func (s *taskService) retryResultPersistence(ctx context.Context) {
	defer close(s.retryDone)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			_ = s.saveUnsavedResults()
			s.mu.Unlock()
		}
	}
}
func (s *taskService) saveUnsavedResults() error {
	var result error
	if s.retryAttempts == nil {
		s.retryAttempts = map[string]uint64{}
	}
	ctx := context.Background()
	if s.ctx != nil {
		ctx = context.WithoutCancel(s.ctx)
	}
	for id, run := range s.unsavedResults {
		s.retryAttempts[id]++
		finish := runStage(ctx, id, "result.retry")
		err := writeJSONAtomically(s.runPath(id), run)
		finish(err)
		if err != nil {
			runFault(ctx, id, "result.retry", fmt.Errorf("attempt %d: %w", s.retryAttempts[id], err))
			result = errors.Join(result, err)
		} else {
			diagnostics.Logger().InfoContext(ctx, "运行结果补写恢复", "module", "tasks", "operation", "result.retry", "run_id", id, "result", "recovered")
			delete(s.retryAttempts, id)
			delete(s.unsavedResults, id)
		}
	}
	return result
}
func (s *taskService) stop(ctx context.Context) (result error) {
	finish := diagnostics.Start(ctx, "tasks", "storage.stop")
	defer func() { finish(result) }()
	s.mu.Lock()
	s.closing = true
	for _, e := range s.active {
		e.cancel()
	}
	if s.retryCancel != nil {
		s.retryCancel()
	}
	s.mu.Unlock()
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		if s.retryDone != nil {
			<-s.retryDone
		}
		close(done)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.saveUnsavedResults()
	if s.lock != nil {
		err = errors.Join(err, syscall.Flock(int(s.lock.Fd()), syscall.LOCK_UN), s.lock.Close())
		s.lock = nil
	}
	return err
}
func (s *taskService) save(name string, in TaskInput, create bool) (Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	validationErr := validateTask(in)
	if !taskNamePattern.MatchString(name) {
		validationErr = errors.Join(validationErr, fieldError("body.name", "taskName"))
	}
	if validationErr != nil {
		return Task{}, validationErr
	}
	if s.closing || s.lock == nil {
		return Task{}, errConflict
	}
	old, exists := s.tasks[name]
	if create && exists {
		return Task{}, errConflict
	}
	if !create && !exists {
		return Task{}, errMissing
	}
	token := old.Token
	if token == "" {
		token = rand.Text()
	}
	task := Task{Name: name, TaskInput: clone(in), Token: token, UpdatedAt: now()}
	if err := writeJSONAtomically(s.taskPath(name), task); err != nil {
		return Task{}, err
	}
	s.tasks[name] = task
	return clone(task), nil
}
func (s *taskService) getTask(name string) (Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.tasks[name]
	if !ok {
		return Task{}, errMissing
	}
	return clone(task), nil
}
func (s *taskService) listTasks() []Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		out = append(out, clone(task))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
func (s *taskService) remove(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tasks[name]; !ok {
		return errMissing
	}
	for _, e := range s.active {
		if e.run.TaskName == name {
			return errConflict
		}
	}
	if s.closing {
		return errConflict
	}
	if err := os.Remove(s.taskPath(name)); err != nil {
		return err
	}
	delete(s.tasks, name)
	return nil
}
func (s *taskService) diskRuns() ([]Run, error) {
	started := time.Now()
	entries, err := os.ReadDir(filepath.Join(s.dir, "runs"))
	if err != nil {
		return nil, &storageError{phase: "storage.runs.list", duration: time.Since(started), cause: err}
	}
	out := []Run{}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		// 未落盘终态与活动记录以内存为准，损坏的旧文件不能遮蔽结果。
		id := strings.TrimSuffix(entry.Name(), ".json")
		if _, ok := s.unsavedResults[id]; ok {
			continue
		}
		if _, ok := s.active[id]; ok {
			continue
		}
		run, err := s.loadRun(id)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, nil
}
func (s *taskService) readRuns() ([]Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.diskRuns()
	if err != nil {
		return nil, err
	}
	byID := map[string]Run{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	for id, r := range s.unsavedResults {
		byID[id] = r
	}
	for id, e := range s.active {
		byID[id] = e.run
	}
	out := make([]Run, 0, len(byID))
	for _, r := range byID {
		out = append(out, clone(r))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}
func (s *taskService) getRun(id string) (Run, error) {
	if !runIDPattern.MatchString(id) {
		return Run{}, errMissing
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.active[id]; e != nil {
		return clone(e.run), nil
	}
	if r, ok := s.unsavedResults[id]; ok {
		return clone(r), nil
	}
	run, err := s.loadRun(id)
	if errors.Is(err, os.ErrNotExist) {
		return Run{}, errMissing
	}
	return run, err
}

// loadRun 统一校验历史记录；存储不变量损坏不是可由请求输入纠正的错误。
func (s *taskService) loadRun(id string) (Run, error) {
	started := time.Now()
	var run Run
	err := readJSON(s.runPath(id), &run)
	if err == nil {
		switch {
		case !runIDPattern.MatchString(run.ID) || run.ID != id:
			err = errors.New("persisted run id does not match its file identity")
		case !taskNamePattern.MatchString(run.TaskName):
			err = errors.New("persisted run has invalid task name")
		case !terminal(run.Status) && run.Status != "running" && run.Status != "queued":
			err = errors.New("persisted run has invalid status")
		}
	}
	if err != nil {
		return Run{}, &storageError{id: id, phase: "storage.run.read", duration: time.Since(started), cause: err}
	}
	return run, nil
}
func (s *taskService) cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := s.active[id]; e != nil {
		e.cancel()
		return nil
	}
	if _, ok := s.unsavedResults[id]; ok {
		return errConflict
	}
	if !runIDPattern.MatchString(id) {
		return errMissing
	}
	if _, err := s.loadRun(id); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return errMissing
		}
		return err
	}
	return errConflict
}
func (s *taskService) trigger(name string, env map[string]string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.accept(name, env, "body.env")
}
func (s *taskService) triggerHook(name string, env map[string]string, token string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.tasks[name]
	if !ok || token == "" || subtle.ConstantTimeCompare([]byte(task.Token), []byte(token)) != 1 {
		return Run{}, errHookDenied
	}
	return s.accept(name, env, "query")
}
func (s *taskService) accept(name string, overrides map[string]string, location string) (Run, error) {
	task, exists := s.tasks[name]
	if !exists {
		return Run{}, errMissing
	}
	if s.lock == nil || s.closing || len(s.active)+len(s.unsavedResults) >= 256 {
		return Run{}, errConflict
	}
	if err := validateOverrides(overrides, location); err != nil {
		return Run{}, err
	}
	task = clone(task)
	if task.Env == nil {
		task.Env = map[string]string{}
	}
	for key, value := range overrides {
		_, allowed := task.Env[key]
		for _, step := range task.Steps {
			if _, ok := step.Env[key]; ok {
				allowed = true
			}
		}
		if allowed {
			task.Env[key] = value
			for i := range task.Steps {
				if _, ok := task.Steps[i].Env[key]; ok {
					task.Steps[i].Env[key] = value
				}
			}
		}
	}
	run := Run{ID: fmt.Sprintf("%x-%s", time.Now().UnixNano(), rand.Text()), TaskName: name, Status: "queued", CreatedAt: now()}
	file, err := os.OpenFile(s.logPath(run.ID), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return Run{}, err
	}
	if err = file.Close(); err != nil {
		return Run{}, err
	}
	if err := writeJSONAtomically(s.runPath(run.ID), run); err != nil {
		_ = os.Remove(s.logPath(run.ID))
		return Run{}, err
	}
	ctx, cancel := context.WithCancel(s.ctx)
	entry := &execution{run: run, cancel: cancel, done: make(chan struct{})}
	predecessor := s.tails[name]
	if task.SchedulingPolicy == "terminate" {
		for _, existing := range s.active {
			if existing.run.TaskName == name {
				existing.cancel()
			}
		}
	}
	s.active[run.ID] = entry
	s.tails[name] = entry.done
	s.wg.Add(1)
	go s.execute(ctx, entry, task, predecessor)
	return run, nil
}
