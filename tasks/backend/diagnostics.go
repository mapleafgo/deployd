package backend

import (
	"context"
	"errors"
	"fmt"
	"time"

	"red-berry-kit/boot/backend/diagnostics"
)

// 操作名只含服务端运行ID及固定阶段名，不包含脚本、变量、令牌或用户步骤名。
func runOperation(id, phase string) string { return fmt.Sprintf("run.%s.%s", id, phase) }
func runStage(ctx context.Context, id, phase string) func(error) {
	return diagnostics.Start(ctx, "tasks", runOperation(id, phase))
}
func runFault(ctx context.Context, id, phase string, err error) {
	diagnostics.Failure(ctx, "tasks", runOperation(id, phase), err)
}

// 下层只携带技术原因及读写阶段，不记录日志；HTTP 或 SSE 边界各记录一次。
type storageError struct {
	id, phase string
	duration  time.Duration
	cause     error
}

func (e *storageError) Error() string { return e.phase + ": " + e.cause.Error() }
func (e *storageError) Unwrap() error { return e.cause }
func reportStorageFailure(ctx context.Context, err error) {
	phase := "storage"
	id := ""
	duration := time.Duration(0)
	var stored *storageError
	if errors.As(err, &stored) {
		phase, duration = stored.phase, stored.duration
		if runIDPattern.MatchString(stored.id) {
			id = stored.id
		}
	} else if state, _ := ctx.Value(validationKey{}).(*validationState); state != nil {
		duration = time.Since(state.started)
	}
	operation := phase
	if id != "" {
		operation = runOperation(id, phase)
	}
	diagnostics.Failure(ctx, "tasks", operation, err)
	diagnostics.Logger().InfoContext(ctx, "执行阶段结束", "module", "tasks", "operation", operation, "result", "failed", "duration_ms", float64(duration)/float64(time.Millisecond))
}
