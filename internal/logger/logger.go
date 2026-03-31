// internal/logger/logger.go
package logger

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// 常量定义
const (
	MB = 1024 * 1024 // 1MB in bytes
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
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	// 打开或创建文件
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	// 获取当前文件大小（P0 修复：正确处理错误）
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("stat log file: %w", err)
	}
	currentSize := info.Size()

	return &RotatingFileWriter{
		file:       file,
		path:       path,
		maxSize:    int64(maxSizeMB) * MB, // 使用常量
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
			return 0, fmt.Errorf("log rotation failed: %w", err)
		}
	}

	n, err = w.file.Write(p)
	w.current += int64(n)
	return n, err
}

// rotate 执行日志轮转（P0 修复：改进原子性，P1: 使用 errors.Join）
func (w *RotatingFileWriter) rotate() error {
	// 步骤 1: 关闭当前文件
	if err := w.file.Close(); err != nil {
		return fmt.Errorf("close current log file: %w", err)
	}

	// 步骤 2: 创建临时新文件（确保能创建）
	tmpPath := w.path + ".tmp"
	newFile, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		// 创建失败，尝试重新打开原文件
		if recoverFile, openErr := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600); openErr == nil {
			w.file = recoverFile
			return fmt.Errorf("create new log file: %w", err)
		}
		return fmt.Errorf("create new log file and recover failed: %w", err)
	}

	// 步骤 3: 重命名备份文件（非阻塞，收集错误）
	var errs []error
	for i := w.maxBackups - 1; i >= 1; i-- {
		oldPath := fmt.Sprintf("%s.%d", w.path, i)
		newPath := fmt.Sprintf("%s.%d", w.path, i+1)
		if err := os.Rename(oldPath, newPath); err != nil && !os.IsNotExist(err) {
			errs = append(errs, fmt.Errorf("rename %s to %s: %w", oldPath, newPath, err))
		}
	}

	// 步骤 4: 当前文件重命名为第一个备份
	if w.maxBackups > 0 {
		backupPath := w.path + ".1"
		if err := os.Rename(w.path, backupPath); err != nil && !os.IsNotExist(err) {
			errs = append(errs, fmt.Errorf("backup current file: %w", err))
		}
	}

	// 步骤 5: 删除最旧的备份
	if w.maxBackups > 0 {
		oldestBackup := fmt.Sprintf("%s.%d", w.path, w.maxBackups)
		if err := os.Remove(oldestBackup); err != nil && !os.IsNotExist(err) {
			// 忽略删除失败（文件可能不存在）
		}
	}

	// 步骤 6: 临时文件原子性地重命名为正式文件名
	if err := os.Rename(tmpPath, w.path); err != nil {
		newFile.Close()
		return fmt.Errorf("rename new log file: %w", err)
	}

	w.file = newFile
	w.current = 0

	// 步骤 7: 如果有重命名错误，记录但不失败（P1: 使用 errors.Join）
	if len(errs) > 0 {
		slog.Warn("some backup files failed to rename during rotation",
			"file", w.path,
			"errors", errors.Join(errs...))
	}

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
