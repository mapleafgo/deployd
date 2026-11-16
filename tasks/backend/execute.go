package backend

import (
	"context"
	"errors"
	"fmt"

	"io"
	"os"
	"os/exec"
	"red-berry-kit/boot/backend/diagnostics"
	"sort"
	"syscall"
	"time"
)

// execute 的 done 在进程、日志、终态全部收尾后关闭；取消排队不绕过前驱。
func (s *taskService) execute(ctx context.Context, e *execution, task Task, predecessor <-chan struct{}) {
	defer s.wg.Done()
	defer e.cancel()
	finishQueue := runStage(ctx, e.run.ID, "queue.wait")
	if predecessor != nil {
		<-predecessor
	}
	finishQueue(ctx.Err())
	finishExecute := runStage(ctx, e.run.ID, "execute")
	status := "cancelled"
	if ctx.Err() == nil {
		s.mu.Lock()
		at := now()
		e.run.StartedAt = &at
		e.run.Status = "running"
		finishPersist := runStage(ctx, e.run.ID, "running.persist")
		err := writeJSONAtomically(s.runPath(e.run.ID), e.run)
		finishPersist(err)
		s.mu.Unlock()
		if err != nil {
			runFault(ctx, e.run.ID, "running.persist", err)
			status = "failed"
		} else {
			duration, _ := time.ParseDuration(task.Timeout)
			running, cancel := context.WithTimeout(ctx, duration)
			status = s.runSteps(running, task, e.run.ID)
			if errors.Is(running.Err(), context.DeadlineExceeded) {
				status = "timeout"
			} else if ctx.Err() != nil {
				status = "cancelled"
			}
			cancel()
		}
	}
	s.mu.Lock()
	at := now()
	e.run.Status = status
	e.run.FinishedAt = &at
	finishPersist := runStage(ctx, e.run.ID, "result.persist")
	persistErr := writeJSONAtomically(s.runPath(e.run.ID), e.run)
	finishPersist(persistErr)
	if persistErr != nil {
		runFault(context.WithoutCancel(ctx), e.run.ID, "result.persist", persistErr)
		s.unsavedResults[e.run.ID] = clone(e.run)
	}
	var executionErr error
	switch status {
	case "cancelled":
		executionErr = context.Canceled
	case "timeout":
		executionErr = context.DeadlineExceeded
	case "failed":
		executionErr = errors.New("task execution failed")
	}
	finishExecute(executionErr)
	delete(s.active, e.run.ID)
	if s.tails[e.run.TaskName] == e.done {
		delete(s.tails, e.run.TaskName)
	}
	close(e.done)
	s.mu.Unlock()
}

func (s *taskService) runSteps(ctx context.Context, task Task, id string) string {
	finishOpen := runStage(ctx, id, "log.open")
	file, err := os.OpenFile(s.logPath(id), os.O_APPEND|os.O_WRONLY, 0600)
	finishOpen(err)
	if err != nil {
		runFault(ctx, id, "log.open", err)
		return "failed"
	}
	// 共享 O_APPEND 文件直接交给进程，不建立会被后台子进程占住的复制管道。
	output := file
	failed := false
	if task.Parallel {
		results := make(chan error, len(task.Steps))
		for index, step := range task.Steps {
			go func(index int, step Step) { results <- runStep(ctx, task, step, output, id, index) }(index, step)
		}
		for range task.Steps {
			if <-results != nil {
				failed = true
			}
		}
	} else {
		for index, step := range task.Steps {
			if err := runStep(ctx, task, step, output, id, index); err != nil {
				failed = true
				break
			}
		}
	}
	finishClose := runStage(ctx, id, "log.close")
	closeErr := file.Close()
	finishClose(closeErr)
	if closeErr != nil {
		runFault(context.WithoutCancel(ctx), id, "log.close", closeErr)
		failed = true
	}
	if failed {
		return "failed"
	}
	return "success"
}
func runStep(ctx context.Context, task Task, step Step, output io.Writer, id string, stepIndex int) (result error) {
	finishStep := runStage(ctx, id, fmt.Sprintf("step.%d", stepIndex))
	defer func() {
		if ctx.Err() != nil {
			finishStep(ctx.Err())
		} else {
			finishStep(result)
		}
	}()
	dir := task.Workdir
	if step.Workdir != "" {
		dir = step.Workdir
	}
	env := map[string]string{}
	for _, entry := range os.Environ() {
		for i := 0; i < len(entry); i++ {
			if entry[i] == '=' {
				env[entry[:i]] = entry[i+1:]
				break
			}
		}
	}
	for key, value := range task.Env {
		env[key] = value
	}
	for key, value := range step.Env {
		env[key] = value
	}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		values = append(values, key+"="+env[key])
	}
	for commandIndex, script := range step.Commands {
		if err := ctx.Err(); err != nil {
			return err
		}
		command := exec.Command("/bin/sh", "-c", script)
		command.Dir = dir
		command.Env = values
		command.Stdout = output
		command.Stderr = output
		command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		phase := fmt.Sprintf("step.%d.command.%d.process.start", stepIndex, commandIndex)
		finishStart := runStage(ctx, id, phase)
		startErr := command.Start()
		finishStart(startErr)
		if startErr != nil {
			runFault(ctx, id, phase, startErr)
			return startErr
		}
		finishWait := runStage(ctx, id, fmt.Sprintf("step.%d.command.%d.process.wait", stepIndex, commandIndex))
		done := make(chan error, 1)
		go func() { done <- command.Wait() }()
		var err error
		select {
		case err = <-done:
		case <-ctx.Done():
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			err = <-done
			if err == nil {
				err = ctx.Err()
			}
		}
		// 正常 shell 退出也清理残留后台子进程，避免后继与旧进程重叠。
		cleanupErr := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if cleanupErr != nil && !errors.Is(cleanupErr, syscall.ESRCH) {
			runFault(context.WithoutCancel(ctx), id, "process.cleanup", cleanupErr)
		}
		waitResult := err
		if ctx.Err() != nil {
			waitResult = ctx.Err()
		}
		finishWait(waitResult)
		if err != nil {
			if ctx.Err() == nil {
				var exit *exec.ExitError
				if errors.As(err, &exit) {
					diagnostics.Logger().WarnContext(ctx, "任务命令退出失败", "module", "tasks", "operation", "process.exit", "run_id", id, "step", stepIndex, "command_index", commandIndex, "exit_code", exit.ExitCode())
				} else {
					runFault(ctx, id, "process.wait", err)
				}
			}
			return err
		}
	}
	return nil
}
func (s *taskService) readChunk(id string, offset int64) ([]byte, error) {
	if !runIDPattern.MatchString(id) || offset < 0 {
		return nil, errInvalid
	}
	file, err := os.Open(s.logPath(id))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data := make([]byte, 16*1024)
	n, err := file.ReadAt(data, offset)
	if errors.Is(err, io.EOF) {
		err = nil
	}
	return data[:n], err
}
