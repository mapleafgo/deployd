# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Build and Run
```bash
# Build the binary
task build

# Run locally with example config
task run

# Install binary and systemd service
task install

# Clean build artifacts
task clean
```

### Development
```bash
# Format code
task fmt

# Run linter
task lint

# Run tests
task test

# Run complete CI pipeline
task all
```

## Architecture

deployd 是一个通过 webhook 触发的命令执行服务,采用分层架构设计:

### 核心组件

- **Manager** (`internal/job/manager.go`): 任务管理器
  - 使用 `sync.Map` 为每个任务名称维护独立的 `sync.Mutex`,确保同名任务串行执行
  - 支持两种队列策略: `wait`(等待) 和 `terminate`(取消正在运行的同名任务)
  - 每个任务在独立的 goroutine 中异步执行

- **Runner** (`internal/job/runner.go`): 任务执行器
  - 支持串行(`parallel: false`)和并行(`parallel: true`)两种执行模式
  - 使用 `context.WithTimeout` 实现超时控制
  - 并行模式使用 `sync.WaitGroup` 和 `atomic.Bool` 跟踪失败状态

- **Store** (`internal/store/store.go`): 运行时状态存储
  - 使用 `sync.RWMutex` 保护 `map[string]*jobEntry`
  - 存储正在运行的任务信息 (jobID → name + cancel func)
  - 提供任务取消功能

- **Logger** (`internal/logger/logger.go`): 日志记录器
  - 按任务名称组织日志到子目录: `<log_dir>/jobs/<job_name>/job_<timestamp>.log`
  - 结构化日志格式,记录任务启动、步骤执行、命令输出等

- **Config** (`internal/config/config.go`): 配置管理
  - 使用 Viper 加载 YAML 配置
  - 环境变量采用白名单机制,防止任意变量注入
  - 支持全局和步骤级别的环境变量合并

### HTTP 层

- **Echo** 作为 web 框架,提供中间件和路由
- **urfave/cli/v3** 作为 CLI 框架,处理命令行参数
- **Handler** 分为两个部分:
  - `hook.go`: 处理 webhook 触发 (`GET /hook/:name`)
  - `api.go`: 处理管理 API (`GET /api/jobs`, `/api/log/:name/:id`, `/api/cancel/:id`)

### CLI 结构约定

本项目使用 **urfave/cli/v3** 作为 CLI 框架，命令定义遵循以下约定：

```
deployd/
├── main.go           # 程序入口 + 根命令定义
└── cmd/
    ├── serve.go      # serve 子命令实现
    └── check.go      # check 子命令实现
```

**约定规则**：
1. **根命令在 main.go**: 根命令和应用入口在同一个文件中，保持简洁
2. **子命令独立文件**: 每个子命令（serve, check 等）都有独立的文件在 `cmd/` 目录
3. **单一职责**: 每个子命令文件只包含该命令及其相关辅助函数
4. **工厂函数**: 使用 `NewXxxCommand()` 函数创建子命令
5. **入口极简**: main.go 包含根命令定义和程序启动，不包含具体业务逻辑

**添加新命令的步骤**：
1. 在 `cmd/` 目录创建 `xxx.go` 文件
2. 实现 `NewXxxCommand() *cli.Command` 函数
3. 在 `main.go` 的 `Commands` 列表中添加 `cmd.NewXxxCommand()`

示例：
```go
// cmd/version.go
package cmd

import "github.com/urfave/cli/v3"

func NewVersionCommand() *cli.Command {
    return &cli.Command{
        Name:  "version",
        Usage: "Show version information",
        Action: func(ctx context.Context, cmd *cli.Command) error {
            println("deployd v1.0.0")
            return nil
        },
    }
}
```

然后在 `cmd/root.go` 中注册：
```go
Commands: []*cli.Command{
    NewServeCommand(),
    NewCheckCommand(),
    NewVersionCommand(),  // 添加新命令
},
```

### 并发控制设计

关键并发模式:
1. **任务级别的串行**: 同名任务通过 `sync.Mutex` 串行执行,避免并发冲突
2. **步骤级别的并行/串行**: 根据 `parallel` 配置决定步骤执行方式
3. **状态访问保护**: Store 使用读写锁保护并发访问
4. **取消机制**: 通过 `context.CancelFunc` 实现任务取消

### 配置结构

```
/etc/deployd/
├── config.yaml         # 全局配置 (token, port, config_dir, log_dir)
└── jobs/
    ├── hello.yaml      # 任务配置文件
    ├── deploy.yaml
    └── ...
```

每个任务配置包含:
- `token`: webhook 认证令牌
- `workdir`: 工作目录
- `timeout`: 执行超时(默认 30m)
- `queue`: 队列策略 (`wait` 或 `terminate`)
- `parallel`: 是否并行执行步骤
- `env`: 全局环境变量
- `steps`: 执行步骤列表

### 日志结构

```
<log_dir>/
├── deployd.log           # 服务日志
└── jobs/
    ├── <job_name>/
    │   └── job_<timestamp>.log
    └── ...
```

## Key Design Decisions

1. **使用 sync.Map 而非 map + mutex**: Manager 的 locks 字段使用 `sync.Map`,因为锁的获取频率远高于更新,且读操作不需要阻塞
2. **环境变量白名单**: 通过 `FilterEnv` 方法只接受配置中定义的环境变量,防止恶意注入
3. **上下文传播**: 使用 `context.Context` 传递取消信号和超时,确保 goroutine 能及时退出
4. **锁的粒度**: 每个任务名称一个锁,而不是全局锁,提高并发性能
