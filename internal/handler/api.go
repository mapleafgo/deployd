// internal/handler/api.go
package handler

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/mapleafgo/deployd/internal/config"
	"github.com/mapleafgo/deployd/internal/store"
)

// APIHandler API 处理器
type APIHandler struct {
	store *store.Store
	cfg   *config.Config
	log   *slog.Logger
}

// NewAPIHandler 创建 API 处理器
func NewAPIHandler(s *store.Store, cfg *config.Config, log *slog.Logger) *APIHandler {
	return &APIHandler{
		store: s,
		cfg:   cfg,
		log:   log,
	}
}

// AuthMiddleware 返回认证中间件
func (h *APIHandler) AuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.QueryParam("token") != h.cfg.Token {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			}
			return next(c)
		}
	}
}

// JobList 任务列表
// GET /api/jobs?name=hello&limit=20
func (h *APIHandler) JobList(c echo.Context) error {
	name := c.QueryParam("name")
	limit := 20
	if v := c.QueryParam("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 {
			limit = n
		}
	}

	jobsDir := filepath.Join(h.cfg.LogDir, "jobs")
	if name != "" {
		return h.listJobs(c, jobsDir, name, limit)
	}
	return h.listAllJobs(c, jobsDir, limit)
}

// JobInfo 任务信息
type JobInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	LogFile   string `json:"log_file"`
	UpdatedAt string `json:"updated_at"`
}

func (h *APIHandler) listJobs(c echo.Context, jobsDir, name string, limit int) error {
	entries, err := os.ReadDir(filepath.Join(jobsDir, name))
	if err != nil {
		return c.JSON(http.StatusOK, map[string]any{"jobs": []JobInfo{}, "total": 0})
	}

	var jobs []JobInfo
	for i := len(entries) - 1; i >= 0 && len(jobs) < limit; i-- {
		if entry := entries[i]; strings.HasSuffix(entry.Name(), ".log") {
			if info, err := entry.Info(); err == nil {
				jobs = append(jobs, JobInfo{
					ID:        strings.TrimSuffix(entry.Name(), ".log"),
					Name:      name,
					LogFile:   entry.Name(),
					UpdatedAt: info.ModTime().Format("2006-01-02 15:04:05"),
				})
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]any{"jobs": jobs, "total": len(jobs)})
}

func (h *APIHandler) listAllJobs(c echo.Context, jobsDir string, limit int) error {
	taskDirs, err := os.ReadDir(jobsDir)
	if err != nil {
		return c.JSON(http.StatusOK, map[string]any{"jobs": []JobInfo{}, "total": 0})
	}

	var jobs []JobInfo
	for _, taskDir := range taskDirs {
		if !taskDir.IsDir() {
			continue
		}

		name := taskDir.Name()
		entries, _ := os.ReadDir(filepath.Join(jobsDir, name))
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".log") {
				if info, err := entry.Info(); err == nil {
					jobs = append(jobs, JobInfo{
						ID:        strings.TrimSuffix(entry.Name(), ".log"),
						Name:      name,
						LogFile:   entry.Name(),
						UpdatedAt: info.ModTime().Format("2006-01-02 15:04:05"),
					})
				}
			}
		}
	}

	// 按时间倒序
	for i, j := 0, len(jobs)-1; i < j; i, j = i+1, j-1 {
		jobs[i], jobs[j] = jobs[j], jobs[i]
	}

	if len(jobs) > limit {
		jobs = jobs[:limit]
	}

	return c.JSON(http.StatusOK, map[string]any{"jobs": jobs, "total": len(jobs)})
}

// JobLog 日志详情
// GET /api/log/:name/:id
func (h *APIHandler) JobLog(c echo.Context) error {
	name := c.Param("name")
	jobID := c.Param("id")

	logPath := filepath.Join(h.cfg.LogDir, "jobs", name, jobID+".log")
	content, err := os.ReadFile(logPath)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "log not found"})
	}

	return c.String(http.StatusOK, string(content))
}

// JobCancel 取消任务
// GET /api/cancel/:id
func (h *APIHandler) JobCancel(c echo.Context) error {
	jobID := c.Param("id")

	if !h.store.Cancel(jobID) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "job not running"})
	}

	h.log.Info("job cancelled", "job_id", jobID)
	return c.JSON(http.StatusOK, map[string]string{"message": "job cancelled"})
}
