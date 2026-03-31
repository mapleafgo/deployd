// internal/handler/api.go
package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
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

// buildJobInfo 从日志文件条目构建 JobInfo
func buildJobInfo(entry os.DirEntry, name string) (JobInfo, bool) {
	if !strings.HasSuffix(entry.Name(), ".log") {
		return JobInfo{}, false
	}

	info, err := entry.Info()
	if err != nil {
		return JobInfo{}, false
	}

	return JobInfo{
		ID:        strings.TrimSuffix(entry.Name(), ".log"),
		Name:      name,
		LogFile:   entry.Name(),
		UpdatedAt: info.ModTime().Format("2006-01-02 15:04:05"),
	}, true
}

func (h *APIHandler) listJobs(c echo.Context, jobsDir, name string, limit int) error {
	entries, err := os.ReadDir(filepath.Join(jobsDir, name))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return c.JSON(http.StatusOK, map[string]any{"jobs": []JobInfo{}, "total": 0})
		}
		h.log.Error("failed to read job directory", "path", filepath.Join(jobsDir, name), "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read jobs"})
	}

	// 预分配容量
	jobs := make([]JobInfo, 0, min(len(entries), limit))

	// 反向遍历，获取最新的日志
	for i := len(entries) - 1; i >= 0 && len(jobs) < limit; i-- {
		if jobInfo, ok := buildJobInfo(entries[i], name); ok {
			jobs = append(jobs, jobInfo)
		}
	}

	return c.JSON(http.StatusOK, map[string]any{"jobs": jobs, "total": len(jobs)})
}

func (h *APIHandler) listAllJobs(c echo.Context, jobsDir string, limit int) error {
	taskDirs, err := os.ReadDir(jobsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return c.JSON(http.StatusOK, map[string]any{"jobs": []JobInfo{}, "total": 0})
		}
		h.log.Error("failed to read jobs directory", "path", jobsDir, "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read jobs"})
	}

	// 预分配容量
	jobs := make([]JobInfo, 0, limit*2)

	// 收集所有任务的日志
	for _, taskDir := range taskDirs {
		if !taskDir.IsDir() {
			continue
		}

		name := taskDir.Name()
		entries, err := os.ReadDir(filepath.Join(jobsDir, name))
		if err != nil {
			continue // 跳过无法读取的目录
		}

		for _, entry := range entries {
			if jobInfo, ok := buildJobInfo(entry, name); ok {
				jobs = append(jobs, jobInfo)
			}
		}
	}

	// 按时间倒序排序
	slices.SortFunc(jobs, func(a, b JobInfo) int {
		// 按更新时间降序排序（字符串比较即可，因为是 ISO 8601 格式）
		if a.UpdatedAt > b.UpdatedAt {
			return -1
		}
		if a.UpdatedAt < b.UpdatedAt {
			return 1
		}
		return 0
	})

	// 限制返回数量
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
