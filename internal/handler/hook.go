// internal/handler/hook.go
package handler

import (
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/mapleafgo/deployd/internal/config"
	"github.com/mapleafgo/deployd/internal/job"
)

// HookHandler Webhook 处理器
type HookHandler struct {
	manager   *job.Manager
	configDir string
}

// NewHookHandler 创建 Webhook 处理器
func NewHookHandler(manager *job.Manager, configDir string) *HookHandler {
	return &HookHandler{
		manager:   manager,
		configDir: configDir,
	}
}

// Trigger 触发任务
func (h *HookHandler) Trigger(c echo.Context) error {
	name := c.Param("name")
	token := c.QueryParam("token")

	// 加载任务配置
	cfg, err := config.LoadJob(h.configDir, name)
	if err != nil {
		slog.Error("failed to load job config", "job", name, "config_dir", h.configDir, "error", err)
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "job not found",
		})
	}

	// 验证 token
	if cfg.Token != token {
		slog.Warn("invalid token", "job", name, "remote", c.RealIP())
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "invalid token",
		})
	}

	// 收集环境变量参数（排除 token）
	env := make(map[string]string)
	for k, v := range c.QueryParams() {
		if k != "token" && len(v) > 0 {
			env[k] = v[0]
		}
	}

	// 过滤环境变量
	filteredEnv := cfg.FilterEnv(env)

	// 触发任务
	jobID, err := h.manager.Trigger(name, cfg, filteredEnv)
	if err != nil {
		slog.Error("failed to trigger job", "job", name, "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"job_id":  jobID,
		"message": "Job triggered",
	})
}
