// internal/job/runner.go
package job

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mapleafgo/deployd/internal/config"
	"github.com/mapleafgo/deployd/internal/logger"
)

// Runner 任务执行器
type Runner struct {
	cfg   *config.JobConfig
	env   map[string]string
	log   *logger.Logger
	jobID string
}

// NewRunner 创建执行器
func NewRunner(cfg *config.JobConfig, env map[string]string, log *logger.Logger, jobID string) *Runner {
	return &Runner{
		cfg:   cfg,
		env:   env,
		log:   log,
		jobID: jobID,
	}
}

// Run 执行任务
func (r *Runner) Run(ctx context.Context) error {
	r.log.JobStarted()

	var failed bool
	if r.cfg.Parallel {
		failed = r.runParallel(ctx)
	} else {
		failed = r.runSerial(ctx)
	}

	status := "success"
	if failed {
		status = "failed"
	}

	r.log.JobCompleted(status)
	return nil
}

// runSerial 串行执行步骤
func (r *Runner) runSerial(ctx context.Context) bool {
	for _, step := range r.cfg.Steps {
		select {
		case <-ctx.Done():
			return true
		default:
		}

		if r.runStep(ctx, step) {
			return true
		}
	}
	return false
}

// runParallel 并行执行步骤，返回是否有失败
func (r *Runner) runParallel(ctx context.Context) bool {
	var wg sync.WaitGroup
	var failed atomic.Bool

	for _, step := range r.cfg.Steps {
		wg.Add(1)
		go func(s config.StepConfig) {
			defer wg.Done()
			if r.runStep(ctx, s) {
				failed.Store(true)
			}
		}(step)
	}

	wg.Wait()
	return failed.Load()
}

// runStep 执行单个步骤，返回是否失败
func (r *Runner) runStep(ctx context.Context, step config.StepConfig) bool {
	r.log.StepStarted(step.Name)

	// 合并环境变量
	env := r.cfg.MergeEnv(step.Env)
	for k, v := range r.env {
		if _, ok := env[k]; ok {
			env[k] = v
		}
	}

	// 确定工作目录
	workdir := step.Workdir
	if workdir == "" {
		workdir = r.cfg.Workdir
	}

	// 执行命令
	for _, cmd := range step.Commands {
		select {
		case <-ctx.Done():
			r.log.StepCompleted(step.Name, ctx.Err())
			return true
		default:
		}

		if err := r.execCommand(ctx, cmd, workdir, env); err != nil {
			r.log.StepCompleted(step.Name, err)
			return true
		}
	}

	r.log.StepCompleted(step.Name, nil)
	return false
}

// execCommand 执行单个命令
func (r *Runner) execCommand(ctx context.Context, cmd, workdir string, env map[string]string) error {
	r.log.Command(cmd)

	c := exec.CommandContext(ctx, "/bin/sh", "-c", cmd)
	c.Dir = workdir
	c.Env = os.Environ()

	for k, v := range env {
		c.Env = append(c.Env, fmt.Sprintf("%s=%s", k, v))
	}

	output, err := c.CombinedOutput()
	if len(output) > 0 {
		r.log.CommandOutput(string(output))
	}

	return err
}

// GenerateJobID 生成任务 ID
func GenerateJobID() string {
	return "job_" + time.Now().Format("20060102_150405")
}
