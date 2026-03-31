# deployd

[中文](README_CN.md)

A lightweight command execution service triggered by webhooks.

## Features

- Webhook-triggered job execution via HTTP GET requests
- YAML-based job configuration with environment variable support
- Token authentication for both webhook triggers and admin API
- Queue management: wait (enqueue) or terminate (cancel running job)
- Serial or parallel step execution modes
- Timeout control for job execution
- Comprehensive logging with per-job log files
- RESTful API for job management

## Installation

### Build from source

```bash
git clone https://github.com/mapleafgo/deployd.git
cd deployd
go build -o bin/deployd .
```

Or using Task:

```bash
task build
```

### Configuration

Create a global configuration file (default: `/etc/deployd/config.yaml`):

```yaml
# Global configuration
token: your-admin-token-here  # Token for admin API access
port: 8080                     # Server port
config_dir: /etc/deployd/jobs  # Directory containing job configs
log_dir: /var/log/deployd     # Directory for job logs
```

## Job Configuration

Job configurations are YAML files located in the `config_dir`. Both `.yaml` and `.yml` extensions are supported. Each job defines its execution behavior:

```yaml
# /etc/deployd/jobs/hello.yaml
token: your-webhook-token-here  # Token for webhook authentication
workdir: /tmp                  # Working directory for command execution
timeout: 5m                 # Maximum execution time
queue: wait                 # Queue policy: "wait" or "terminate"
parallel: false             # Execution mode: false=serial, true=parallel

# Environment variables (case-sensitive)
env:
  NAME: world
  GREETING: hello

# Execution steps
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

### Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Webhook authentication token |
| `workdir` | string | Yes | Working directory for command execution |
| `timeout` | duration | No (30m) | Maximum job execution time |
| `queue` | string | No (wait) | Queue policy: `wait` or `terminate` |
| `parallel` | bool | No (false) | Step execution mode |
| `env` | map | No | Global environment variables (case-sensitive) |
| `steps` | array | Yes | List of execution steps |

### Step Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Step name |
| `commands` | []string | Yes | List of shell commands |
| `workdir` | string | No | Working directory (overrides global) |
| `env` | map | No | Step-level environment variables |

Example with step-level overrides:

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

## Usage

### Start the server

```bash
# Foreground mode
./bin/deployd serve
# Or with custom config path
./bin/deployd serve -c /path/to/config.yaml

# Daemon mode (background process)
./bin/deployd serve -d
# Or with long option
./bin/deployd serve --daemon
```

### Validate job configurations

Before deploying, you can validate your job configuration files:

```bash
# Check a single job file
./bin/deployd check /etc/deployd/jobs/hello.yaml

# Check all job files in a directory
./bin/deployd check /etc/deployd/jobs

# Check all job files in current directory
./bin/deployd check .
```

The `check` command validates:
- Required fields (token, workdir, steps)
- Queue policy (wait/terminate)
- Timeout range (1s - 24h)
- Absolute path requirements
- POSIX environment variable names
- Step configuration validity

### Run as systemd service

```bash
# 1. Copy binary
sudo cp bin/deployd /usr/local/bin/

# 2. Copy service file
sudo cp examples/deployd.service /etc/systemd/system/

# 3. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable deployd
sudo systemctl start deployd

# 4. Check status and logs
sudo systemctl status deployd
sudo journalctl -u deployd -f
```

### Trigger a job via webhook

```bash
# Basic trigger
curl "http://localhost:8080/hook/hello?token=your-webhook-token-here"

# With environment variable override
curl "http://localhost:8080/hook/hello?token=your-webhook-token-here&GREETING=hi&NAME=deployd"
```

Environment variables passed via URL parameters are filtered against the whitelist defined in the job configuration.

### CI/CD Integration

Use deployd as the final step in your CI/CD pipeline to trigger deployment:

**Drone CI example:**

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

**Job configuration (`/etc/deployd/jobs/deploy.yaml`):**

```yaml
token: your-webhook-token
workdir: /app
timeout: 10m
queue: terminate  # Cancel old deployment if running

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

## API Reference

All API endpoints require the `token` query parameter with admin token.

### List Jobs

```
GET /api/jobs?token=<admin-token>
```

Query parameters:
- `name` (optional): Filter by job name
- `limit` (optional): Maximum results (default: 20)

Response:
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

### Get Job Details

```
GET /api/job/:name/:id?token=<admin-token>
```

Returns the raw log file content.

### Cancel Running Job

```
GET /api/cancel/:id?token=<admin-token>
```

Cancels a currently running job.

## Queue Policies

- **wait**: If a job with the same name is running, new requests wait in queue until completion
- **terminate**: If a job with the same name is running, cancel it and start the new job immediately

## Execution Modes

- **Serial** (`parallel: false`): Steps execute sequentially; stops on first failure
- **Parallel** (`parallel: true`): All steps execute concurrently; failures don't stop other steps

## Environment Variables

Environment variables are merged in this order (later overrides earlier):
1. Global job-level `env`
2. Step-level `env`
3. Webhook URL parameters (only if key exists in merged env)

This allows secure parameterization while preventing arbitrary variable injection.

## Logging

Job execution logs are stored per job name:

```
<log_dir>/
├── deployd.log                    # Service log
└── jobs/
    ├── hello/                     # Job name
    │   └── job_20260320_111405.log
    ├── deploy/
    │   └── job_20260320_111420.log
    └── web/
        └── job_20260320_111435.log
```

Log format:
```
[2026-03-20 11:14:05] Job started: hello
[2026-03-20 11:14:05] Step: greet
[2026-03-20 11:14:05] > echo $GREETING $NAME
hello world
[2026-03-20 11:14:05] > date
Thu Mar 20 11:14:05 CST 2026
[2026-03-20 11:14:05] Step greet completed in 0.0s
[2026-03-20 11:14:05] Job completed: success in 0.0s
```

## Architecture

```
deployd/
├── main.go                  # Application entry point
├── cmd/
│   ├── serve.go             # Server command
│   └── check.go             # Configuration validation command
├── internal/
│   ├── config/
│   │   ├── config.go        # Configuration loading
│   │   └── validator.go     # Configuration validation
│   ├── handler/
│   │   ├── api.go           # Admin API handlers
│   │   └── hook.go          # Webhook handlers
│   ├── job/
│   │   ├── manager.go       # Job queue management
│   │   └── runner.go        # Command execution
│   ├── logger/logger.go     # Structured logging
│   └── store/store.go       # Runtime state storage
└── examples/
    ├── config.yaml          # Example global config
    └── jobs/hello.yaml      # Example job config
```

## License

MIT License
