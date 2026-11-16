package main

import (
	"context"
	"fmt"
	"os"

	"github.com/mapleafgo/deployd/tasks/backend"
	"go.uber.org/fx"
	auth "red-berry-kit/auth/backend"
	"red-berry-kit/boot/backend/app"
	"red-berry-kit/boot/backend/config"
	cache "red-berry-kit/cache/backend"
)

// main 展示不使用生成装配的独立后端；CLI 消费应用不应重复此接线。
func main() {
	application := app.New(app.Options{
		Name: "tasks-example", Version: "0.1.0", ConfigDir: "config",
		Application: app.Assembly{
			Module: fx.Options(backend.Module, auth.Module, cache.Module),
			Configs: []config.Spec{
				config.SpecFor[backend.Config]("github.com/mapleafgo/deployd/tasks", ""),
				config.SpecFor[auth.Config]("red-berry-kit/auth", ""),
				config.SpecFor[cache.Config]("red-berry-kit/cache", ""),
			},
		},
	})
	if err := application.Run(context.Background(), os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
