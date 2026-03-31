// internal/logger/logger.go
package logger

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RotatingFileWriter 支持按大小轮转的文件写入器
type RotatingFileWriter struct {
	mu         sync.Mutex
	file       *os.File
	path       string
	maxSize    int64  // 最大文件大小（字节）
	maxBackups int    // 保留的备份文件数量
	current    int64  // 当前文件大小
}

// NewRotatingFileWriter 创建轮转文件写入器
func NewRotatingFileWriter(path string, maxSizeMB int, maxBackups int) (*RotatingFileWriter, error) {
	// 确保目录存在
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	// 打开或创建文件
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}

	// 获取当前文件大小
	info, _ := file.Stat()
	currentSize := info.Size()

	return &RotatingFileWriter{
		file:       file,
		path:       path,
		maxSize:    int64(maxSizeMB) * 1024 * 1024, // 转换为字节
		maxBackups: maxBackups,
		current:    currentSize,
	}, nil
}

// Write 实现 io.Writer 接口，写入前检查是否需要轮转
func (w *RotatingFileWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// 检查是否需要轮转
	if w.current+int64(len(p)) > w.maxSize {
		if err := w.rotate(); err != nil {
			return 0, err
		}
	}

	n, err = w.file.Write(p)
	w.current += int64(n)
	return n, err
}

// rotate 执行日志轮转
func (w *RotatingFileWriter) rotate() error {
	// 关闭当前文件
	if err := w.file.Close(); err != nil {
		return err
	}

	// 删除最旧的备份
	if w.maxBackups > 0 {
		oldestBackup := filepath.Join(w.path, fmt.Sprintf(".%d", w.maxBackups))
		os.Remove(oldestBackup)
	}

	// 重命名备份文件
	for i := w.maxBackups - 1; i >= 1; i-- {
		oldPath := filepath.Join(w.path, fmt.Sprintf(".%d", i))
		newPath := filepath.Join(w.path, fmt.Sprintf(".%d", i+1))
		os.Rename(oldPath, newPath)
	}

	// 重命名当前文件为第一个备份
	if w.maxBackups > 0 {
		backupPath := filepath.Join(w.path, ".1")
		os.Rename(w.path, backupPath)
	}

	// 创建新文件
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}

	w.file = file
	w.current = 0
	return nil
}

// Close 关闭文件
func (w *RotatingFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}

// Logger 任务日志记录器
type Logger struct {
	mu        sync.Mutex
	file      *os.File
	jobID     string
	jobName   string
	start     time.Time
	logDir    string
	stepStart time.Time // 当前步骤开始时间
}

// New 创建任务日志记录器
func New(logDir, jobID, jobName string) (*Logger, error) {
	// 创建日志目录
	jobLogDir := filepath.Join(logDir, "jobs", jobName)
	if err := os.MkdirAll(jobLogDir, 0755); err != nil {
		return nil, err
	}

	// 创建日志文件（仅所有者可读写，保护敏感信息）
	logPath := filepath.Join(jobLogDir, jobID+".log")
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, err
	}

	return &Logger{
		file:    file,
		jobID:   jobID,
		jobName: jobName,
		start:   time.Now(),
		logDir:  logDir,
	}, nil
}

// Write 直接写入日志文件
func (l *Logger) Write(p []byte) (n int, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.file.Write(p)
}

// Log 记录日志
func (l *Logger) Log(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	msg := fmt.Sprintf("[%s] %s\n", timestamp, fmt.Sprintf(format, args...))
	l.file.WriteString(msg)
}

// JobStarted 记录任务开始
func (l *Logger) JobStarted() {
	l.Log("Job started: %s", l.jobName)
}

// JobCompleted 记录任务完成
func (l *Logger) JobCompleted(status string) {
	duration := time.Since(l.start).Seconds()
	l.Log("Job completed: %s in %.1fs", status, duration)
}

// StepStarted 记录步骤开始
func (l *Logger) StepStarted(name string) {
	l.mu.Lock()
	l.stepStart = time.Now()
	l.mu.Unlock()
	l.Log("Step: %s", name)
}

// StepCompleted 记录步骤完成
func (l *Logger) StepCompleted(name string, err error) {
	l.mu.Lock()
	duration := time.Since(l.stepStart).Seconds()
	l.mu.Unlock()

	if err != nil {
		l.Log("Step %s failed in %.1fs: %v", name, duration, err)
	} else {
		l.Log("Step %s completed in %.1fs", name, duration)
	}
}

// Command 记录命令执行
func (l *Logger) Command(cmd string) {
	l.Log("> %s", cmd)
}

// CommandOutput 记录命令输出
func (l *Logger) CommandOutput(output string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.file.WriteString(output)
	if len(output) > 0 && output[len(output)-1] != '\n' {
		l.file.WriteString("\n")
	}
}

// Close 关闭日志文件
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.file.Close()
}

// Path 返回日志文件路径
func (l *Logger) Path() string {
	return filepath.Join(l.logDir, "jobs", l.jobName, l.jobID+".log")
}

// ReadLog 读取日志文件内容
func ReadLog(logDir, jobID, jobName string) (string, error) {
	logPath := filepath.Join(logDir, "jobs", jobName, jobID+".log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// NewServiceLogger 创建服务日志记录器（支持日志轮转）
func NewServiceLogger(logDir string, maxSizeMB int, maxBackups int) *slog.Logger {
	logPath := filepath.Join(logDir, "deployd.log")

	// 创建轮转文件写入器
	rotatingWriter, err := NewRotatingFileWriter(logPath, maxSizeMB, maxBackups)
	if err != nil {
		// 如果创建失败，使用标准错误输出
		return slog.New(slog.NewTextHandler(os.Stderr, nil))
	}

	handler := slog.NewTextHandler(io.MultiWriter(os.Stdout, rotatingWriter), &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})

	return slog.New(handler)
}
