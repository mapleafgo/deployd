// internal/logger/rotation.go
package logger

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

const MB = 1024 * 1024

// RotatingFileWriter 支持按大小轮转的文件写入器
type RotatingFileWriter struct {
	mu         sync.Mutex
	file       *os.File
	path       string
	maxSize    int64
	maxBackups int
	current    int64
}

// NewRotatingFileWriter 创建轮转文件写入器
func NewRotatingFileWriter(path string, maxSizeMB int, maxBackups int) (*RotatingFileWriter, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	return &RotatingFileWriter{
		file:       file,
		path:       path,
		maxSize:    int64(maxSizeMB) * MB,
		maxBackups: maxBackups,
		current:    info.Size(),
	}, nil
}

// Write 实现 io.Writer 接口
func (w *RotatingFileWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.current+int64(len(p)) > w.maxSize {
		if err := w.rotate(); err != nil {
			return 0, fmt.Errorf("log rotation failed: %w", err)
		}
	}

	n, err = w.file.Write(p)
	w.current += int64(n)
	return n, err
}

// rotate 执行日志轮转
func (w *RotatingFileWriter) rotate() error {
	if err := w.file.Close(); err != nil {
		return fmt.Errorf("close current log file: %w", err)
	}

	tmpPath := w.path + ".tmp"
	newFile, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		if recoverFile, openErr := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600); openErr == nil {
			w.file = recoverFile
		}
		return fmt.Errorf("create new log file: %w", err)
	}

	var errs []error
	for i := w.maxBackups - 1; i >= 1; i-- {
		oldPath := fmt.Sprintf("%s.%d", w.path, i)
		newPath := fmt.Sprintf("%s.%d", w.path, i+1)
		if err := os.Rename(oldPath, newPath); err != nil && !os.IsNotExist(err) {
			errs = append(errs, fmt.Errorf("rename %s to %s: %w", oldPath, newPath, err))
		}
	}

	if w.maxBackups > 0 {
		if err := os.Rename(w.path, w.path+".1"); err != nil && !os.IsNotExist(err) {
			errs = append(errs, fmt.Errorf("backup current file: %w", err))
		}
	}

	if w.maxBackups > 0 {
		oldestBackup := fmt.Sprintf("%s.%d", w.path, w.maxBackups)
		os.Remove(oldestBackup)
	}

	if err := os.Rename(tmpPath, w.path); err != nil {
		newFile.Close()
		return fmt.Errorf("rename new log file: %w", err)
	}

	w.file = newFile
	w.current = 0

	if len(errs) > 0 {
		slog.Warn("some backup files failed to rename during rotation",
			"file", w.path, "errors", errors.Join(errs...))
	}

	return nil
}

// Close 关闭文件
func (w *RotatingFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}
