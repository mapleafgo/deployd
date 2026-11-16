package backend

import (
	"context"
	"go.uber.org/fx"
	"red-berry-kit/boot/backend/app"
)

// Module 是本模块的后端装配入口，类型为 fx.Option。
// CLI 消费应用通过生成装配接入；独立组合应用时将 Module 传给 fx.New。
// 已使用生成装配的应用不要再次注册 Module。
var Module = fx.Module("github.com/mapleafgo/deployd/tasks",
	fx.Provide(newTaskService),
	fx.Invoke(registerTasks),
	app.ProvideBackground(func(s *taskService, lifetime app.Lifetime) app.Background {
		return app.Background{OnStart: func(_ context.Context) error { return s.start(lifetime.Context) }, OnStop: s.stop}
	}),
)
