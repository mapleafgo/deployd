// cmd/serve.go
package cmd

import (
	"context"
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
	"github.com/urfave/cli/v3"
)

// NewServeCommand creates the serve command
func NewServeCommand() *cli.Command {
	var configPath string

	return &cli.Command{
		Name:  "serve",
		Usage: "Start the deployd service",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:        "config",
				Aliases:     []string{"c"},
				Value:       "/etc/deployd/config.yaml",
				Usage:       "Config file path",
				Sources:     cli.EnvVars("DEPLOYD_CONFIG"),
				Destination: &configPath,
			},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			return runServe(configPath)
		},
	}
}

// runServe starts the deployd service
func runServe(configPath string) error {
	// Load configuration
	cfg, err := config.Load(configPath)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Create log directory
	if err := os.MkdirAll(cfg.LogDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	// Initialize logger
	log := logger.NewServiceLogger(cfg.LogDir)
	slog.SetDefault(log)

	slog.Info("Starting deployd", "port", cfg.Port, "config_dir", cfg.ConfigDir, "log_dir", cfg.LogDir)

	// Initialize components
	s := store.New()
	manager := job.NewManager(s, cfg.LogDir, log)
	hookHandler := handler.NewHookHandler(manager, cfg.ConfigDir)
	apiHandler := handler.NewAPIHandler(s, cfg, log)

	// Create Echo instance
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// Middleware
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

	// Routes
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

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("Shutting down...")
		e.Close()
	}()

	// Start server
	addr := fmt.Sprintf(":%d", cfg.Port)
	slog.Info("Server started", "addr", addr)
	if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server stopped: %w", err)
	}

	return nil
}
