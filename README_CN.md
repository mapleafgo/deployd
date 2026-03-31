# deployd

[English](README.md)

轻量级 Webhook 触发的命令执行服务。

## 功能特性

- 通过 HTTP GET 请求触发 webhook 执行任务
- 基于 YAML 的任务配置，支持环境变量
- Webhook 和管理 API 均支持 Token 认证
- 队列管理：等待排队（wait）或终止旧任务（terminate）
- 串行或并行步骤执行模式
- 任务执行超时控制
- 按任务分文件夹的日志存储
- RESTful 任务管理 API

## 安装

### 从源码构建

```bash
git clone https://github.com/mapleafgo/deployd.git
cd deployd
go build -o bin/deployd .
```

或使用 Task：

```bash
task build
```

## 配置

创建全局配置文件（默认路径：`/etc/deployd/config.yaml`）：

```yaml
# 全局配置
token: your-admin-token-here  # 管理 API 访问令牌
port: 8080                     # 服务端口
config_dir: /etc/deployd/jobs  # 任务配置文件目录
log_dir: /var/log/deployd     # 日志目录
```

## 任务配置

任务配置为 YAML 文件，放置在 `config_dir` 目录下，支持 `.yaml` 和 `.yml` 两种扩展名。每个任务定义其执行行为：

```yaml
# /etc/deployd/jobs/hello.yaml
token: your-webhook-token-here  # Webhook 认证令牌
workdir: /tmp                  # 命令执行的工作目录
timeout: 5m                 # 最大执行时间
queue: wait                 # 队列策略: "wait" 或 "terminate"
parallel: false             # 执行模式: false=串行, true=并行

# 环境变量（区分大小写）
env:
  NAME: world
  GREETING: hello

# 执行步骤
steps:
  - name: greet
    commands:
      - echo $GREETING $NAME
      - date

  - name: info
    commands:
      - pwd
      - whoami
```

### 配置字段说明

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `token` | string | 是 | Webhook 认证令牌 |
| `workdir` | string | 是 | 命令执行的工作目录 |
| `timeout` | duration | 否（默认30m） | 最大任务执行时间 |
| `queue` | string | 否（默认wait） | 队列策略：`wait` 或 `terminate` |
| `parallel` | bool | 否（默认false） | 步骤执行模式 |
| `env` | map | 否 | 全局环境变量（区分大小写） |
| `steps` | array | 是 | 执行步骤列表 |

### 步骤配置

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| `name` | string | 是 | 步骤名称 |
| `commands` | []string | 是 | Shell 命令列表 |
| `workdir` | string | 否 | 工作目录（覆盖全局配置） |
| `env` | map | 否 | 步骤级别环境变量 |

示例（带步骤级别覆盖）：

```yaml
steps:
  - name: build
    workdir: /app/src
    env:
      GOOS: linux
      GOARCH: amd64
    commands:
      - go build -o /app/bin/app .

  - name: deploy
    commands:
      - cp /app/bin/app /usr/local/bin/
      - systemctl restart app
```

## 使用方法

### 启动服务

```bash
./bin/deployd serve
# 或指定配置文件路径
./bin/deployd serve -c /path/to/config.yaml
```

### 验证任务配置

部署前可以验证任务配置文件：

```bash
# 检查单个任务文件
./bin/deployd check /etc/deployd/jobs/hello.yaml

# 检查目录下所有任务文件
./bin/deployd check /etc/deployd/jobs

# 检查当前目录所有任务文件
./bin/deployd check .
```

`check` 命令会验证：
- 必填字段（token、workdir、steps）
- 队列策略（wait/terminate）
- 超时时间范围（1秒 - 24小时）
- 绝对路径要求
- POSIX 环境变量命名规范
- 步骤配置有效性

### 配置为系统服务

```bash
# 1. 复制二进制文件
sudo cp bin/deployd /usr/local/bin/

# 2. 复制服务文件
sudo cp examples/deployd.service /etc/systemd/system/

# 3. 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable deployd
sudo systemctl start deployd

# 4. 查看状态和日志
sudo systemctl status deployd
sudo journalctl -u deployd -f
```

### 通过 Webhook 触发任务

```bash
# 基本触发
curl "http://localhost:8080/hook/hello?token=your-webhook-token-here"

# 带环境变量覆盖
curl "http://localhost:8080/hook/hello?token=your-webhook-token-here&GREETING=hi&NAME=deployd"
```

通过 URL 参数传递的环境变量会被配置中的白名单过滤，只有配置中定义的变量才会被接受。

### CI/CD 集成

将 deployd 作为 CI/CD 流水线的最后一步，实现自动化部署：

**Drone CI 示例：**

```yaml
# .drone.yml
steps:
  - name: build
    commands:
      - go build -o bin/app ./cmd/app

  - name: deploy
    commands:
      - |
        curl "http://your-server:8080/hook/deploy?token=xxx&VERSION=${DRONE_TAG}"
    when:
      event: tag
```

**任务配置（`/etc/deployd/jobs/deploy.yaml`）：**

```yaml
token: your-webhook-token
workdir: /app
timeout: 10m
queue: terminate  # 如有旧部署正在运行则取消

env:
  VERSION: latest

steps:
  - name: pull
    commands:
      - git pull origin main

  - name: build
    commands:
      - go build -o bin/app ./cmd/app

  - name: restart
    commands:
      - systemctl restart app
```

## API 接口

所有 API 接口都需要在查询参数中提供管理 Token。

### 获取任务列表

```
GET /api/jobs?token=<admin-token>
```

查询参数：
- `name`（可选）：按任务名称过滤
- `limit`（可选）：最大结果数（默认：20）

响应示例：
```json
{
  "jobs": [
    {
      "id": "job_20260320_111405",
      "name": "hello",
      "log_file": "job_20260320_111405.log",
      "updated_at": "2026-03-20 11:14:05"
    }
  ],
  "total": 1
}
```

### 获取任务详情

```
GET /api/job/:name/:id?token=<admin-token>
```

返回原始日志文件内容。

### 取消运行中的任务

```
GET /api/cancel/:id?token=<admin-token>
```

取消正在运行的任务。

## 队列策略

- **wait**：如果同名任务正在运行，新请求进入队列等待
- **terminate**：如果同名任务正在运行，取消旧任务并立即执行新任务

## 执行模式

- **串行**（`parallel: false`）：步骤依次执行，遇到失败立即停止
- **并行**（`parallel: true`）：所有步骤同时执行，失败不影响其他步骤

## 环境变量

环境变量按以下顺序合并（后者覆盖前者）：
1. 任务全局 `env` 配置
2. 步骤级别 `env` 配置
3. Webhook URL 参数（仅当键存在于已合并的环境变量中时）

这种设计允许参数化配置，同时防止任意变量注入。

## 日志

任务执行日志按任务名分文件夹存储：

```
<log_dir>/
├── deployd.log                    # 服务日志
└── jobs/
    ├── hello/                     # 任务名
    │   └── job_20260320_111405.log
    ├── deploy/
    │   └── job_20260320_111420.log
    └── web/
        └── job_20260320_111435.log
```

日志格式：
```
[2026-03-20 11:14:05] Job started: hello
[2026-03-20 11:14:05] Step: greet
[2026-03-20 11:14:05] > echo $GREETING $NAME
hello world
[2026-03-20 11:14:05] > date
2026年 03月 20日 星期四 11:14:05 CST
[2026-03-20 11:14:05] Step greet completed in 0.0s
[2026-03-20 11:14:05] Job completed: success in 0.0s
```

## 项目结构

```
deployd/
├── main.go                  # 应用入口
├── cmd/
│   ├── serve.go             # 服务启动命令
│   └── check.go             # 配置验证命令
├── internal/
│   ├── config/
│   │   ├── config.go        # 配置加载
│   │   └── validator.go     # 配置验证
│   ├── handler/
│   │   ├── api.go           # 管理 API 处理器
│   │   └── hook.go          # Webhook 处理器
│   ├── job/
│   │   ├── manager.go       # 任务队列管理
│   │   └── runner.go        # 命令执行
│   ├── logger/logger.go     # 结构化日志
│   └── store/store.go       # 运行时状态存储
└── examples/
    ├── config.yaml          # 示例全局配置
    └── jobs/hello.yaml      # 示例任务配置
```

## 许可证

MIT License
