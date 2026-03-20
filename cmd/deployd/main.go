// cmd/deployd/main.go
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/mapleafgo/deployd/internal/config"
	"github.com/mapleafgo/deployd/internal/handler"
	"github.com/mapleafgo/deployd/internal/job"
	"github.com/mapleafgo/deployd/internal/logger"
	"github.com/mapleafgo/deployd/internal/store"
	"github.com/spf13/cobra"
)

var configPath string

var rootCmd = &cobra.Command{
	Use:   "deployd",
	Short: "A webhook-triggered command execution service",
	Run:   run,
}

func init() {
	rootCmd.Flags().StringVarP(&configPath, "config", "c", "/etc/deployd/config.yaml", "config file path")
}

func run(cmd *cobra.Command, args []string) {
	// 加载配置
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// 创建日志目录
	if err := os.MkdirAll(cfg.LogDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create log directory: %v\n", err)
		os.Exit(1)
	}

	// 初始化日志
	log := logger.NewServiceLogger(cfg.LogDir)
	slog.SetDefault(log)

	slog.Info("Starting deployd", "port", cfg.Port, "config_dir", cfg.ConfigDir, "log_dir", cfg.LogDir)

	// 初始化
	s := store.New()
	manager := job.NewManager(s, cfg.LogDir, log)
	hookHandler := handler.NewHookHandler(manager, cfg.ConfigDir)
	apiHandler := handler.NewAPIHandler(s, cfg, log)

	// 创建 Echo 实例
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// 中间件
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus:  true,
		LogMethod:  true,
		LogURI:     true,
		LogLatency: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			slog.Info("request", "method", v.Method, "uri", v.URI, "status", v.Status, "latency", v.Latency.Round(time.Millisecond))
			return nil
		},
	}))
	e.Use(middleware.Recover())

	// 路由
	e.GET("/hook/:name", hookHandler.Trigger)

	api := e.Group("/api", apiHandler.AuthMiddleware())
	api.GET("/jobs", apiHandler.JobList)
	api.GET("/log/:name/:id", apiHandler.JobLog)
	api.GET("/cancel/:id", apiHandler.JobCancel)

	slog.Info("Routes registered", "routes", []string{
		"GET /hook/:name",
		"GET /api/jobs",
		"GET /api/log/:name/:id",
		"GET /api/cancel/:id",
	})

	// 优雅关闭
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("Shutting down...")
		e.Close()
	}()

	// 启动服务
	addr := fmt.Sprintf(":%d", cfg.Port)
	slog.Info("Server started", "addr", addr)
	if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
		slog.Error("Server stopped", "error", err)
	}
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
