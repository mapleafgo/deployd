package backend

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
	auth "red-berry-kit/auth/backend"
	"red-berry-kit/boot/backend/diagnostics"
)

type logInput struct {
	RunPathInput
	Offset        int64  `query:"offset" minimum:"0" default:"0"`
	LastEventID   string `header:"Last-Event-ID"`
	Authorization string `header:"Authorization"`
}
type logEvent struct {
	Data   string `json:"data"`
	Offset int64  `json:"offset"`
}
type statusEvent struct {
	Status string `json:"status"`
	Offset int64  `json:"offset"`
}
type streamError struct {
	Code string `json:"code"`
}

// streamBudget 同时约束慢写、鉴权复查与单连接寿命。
type streamBudget struct{ expires, verifyAt time.Time }
type budgetKey struct{}
type humaStreamContext = huma.Context
type streamContext struct {
	humaStreamContext
	writer io.Writer
}

func (c streamContext) BodyWriter() io.Writer { return c.writer }

type deadlineWriter struct {
	io.Writer
	control *http.ResponseController
	budget  *streamBudget
}

func (w deadlineWriter) Flush() { _ = w.control.Flush() }
func (w deadlineWriter) SetWriteDeadline(t time.Time) error {
	if w.budget.expires.Before(t) {
		t = w.budget.expires
	}
	if w.budget.verifyAt.Before(t) {
		t = w.budget.verifyAt
	}
	return w.control.SetWriteDeadline(t)
}

// streamFault 只在故障边界记录失败耗时，避免轮询或正常拒绝产生诊断噪声。
func streamFault(ctx context.Context, id, phase string, started time.Time, err error) {
	if ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return
	}
	runFault(ctx, id, phase, err)
	diagnostics.Logger().InfoContext(ctx, "执行阶段结束", "module", "tasks", "operation", runOperation(id, phase), "result", "failed", "duration_ms", float64(time.Since(started))/float64(time.Millisecond))
}

// 已在运行边界记录原因，直接写安全业务错误，避免通用5xx转换再次记录同一故障。
func streamStorageError(api huma.API, ctx huma.Context) {
	problem := &taskError{ErrorModel: huma.ErrorModel{Status: 500, Title: http.StatusText(500), Detail: message(ctx.Context(), "保存或读取失败，请稍后重试；如仍失败，请提供请求编号联系维护者", "Storage operation failed. Try again later; if it persists, contact support with the request ID")}, Code: "storageFailed"}
	ctx.SetHeader("Content-Type", "application/problem+json")
	ctx.SetStatus(500)
	_ = api.Marshal(ctx.BodyWriter(), "application/problem+json", problem)
}

func registerLogStream(api huma.API, s *taskService, authenticator auth.Authenticator) {
	stream := huma.NewGroup(api)
	stream.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		started := time.Now()
		if _, err := s.getRun(ctx.Param("id")); err != nil {
			if errors.Is(err, errMissing) {
				_ = huma.WriteErr(api, ctx, 404, message(ctx.Context(), "记录不存在", "Record not found"))
			} else {
				streamFault(ctx.Context(), ctx.Param("id"), "stream.run", started, err)
				streamStorageError(api, ctx)
			}
			return
		}
		raw := ctx.Query("offset")
		if last := ctx.Header("Last-Event-ID"); last != "" {
			raw = last
		}
		if raw != "" {
			offset, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || offset < 0 {
				_ = huma.WriteErr(api, ctx, 422, message(ctx.Context(), "日志位置无效", "Invalid log offset"))
				return
			}
			started = time.Now()
			info, statErr := os.Stat(s.logPath(ctx.Param("id")))
			if statErr != nil {
				streamFault(ctx.Context(), ctx.Param("id"), "stream.stat", started, statErr)
				streamStorageError(api, ctx)
				return
			}
			if offset > info.Size() {
				_ = huma.WriteErr(api, ctx, 422, message(ctx.Context(), "日志位置无效", "Invalid log offset"))
				return
			}
		}
		clock := time.Now()
		budget := &streamBudget{expires: clock.Add(60 * time.Second), verifyAt: clock.Add(15 * time.Second)}
		lifetime, cancel := context.WithDeadline(ctx.Context(), budget.expires)
		defer cancel()
		ctx = huma.WithContext(ctx, context.WithValue(lifetime, budgetKey{}, budget))
		ctx.SetHeader("Cache-Control", "no-store")
		ctx.SetHeader("X-Accel-Buffering", "no")
		if writer, ok := ctx.BodyWriter().(http.ResponseWriter); ok {
			control := http.NewResponseController(writer)
			bounded := deadlineWriter{writer, control, budget}
			_ = bounded.SetWriteDeadline(clock.Add(sse.WriteTimeout))
			defer control.SetWriteDeadline(time.Time{})
			ctx = streamContext{ctx, bounded}
		}
		next(ctx)
	})
	sse.Register(stream, huma.Operation{OperationID: "stream-run-log", Method: "GET", Path: "/api/runs/{id}/events"}, map[string]any{"log": logEvent{}, "status": statusEvent{}, "error": streamError{}}, func(ctx context.Context, in *logInput, send sse.Sender) {
		budget := ctx.Value(budgetKey{}).(*streamBudget)
		offset := in.Offset
		if in.LastEventID != "" {
			offset, _ = strconv.ParseInt(in.LastEventID, 10, 64)
		}
		token := strings.TrimPrefix(in.Authorization, "Bearer ")
		allowed := func() bool {
			if ctx.Err() != nil || !time.Now().Before(budget.expires) {
				return false
			}
			if !time.Now().Before(budget.verifyAt) {
				if authenticator == nil {
					return false
				}
				started := time.Now()
				p, err := authenticator.Authenticate(auth.WithApp(ctx, "admin"), token)
				if ctx.Err() != nil || errors.Is(err, context.Canceled) || !time.Now().Before(budget.expires) {
					return false
				}
				if err != nil || !isAdmin(p) {
					code := "loginRequired"
					if err != nil && !errors.Is(err, auth.ErrDenied) && !errors.Is(err, auth.ErrTokenClaimsStale) {
						code = "streamFailed"
						if !errors.Is(err, auth.ErrLimited) {
							streamFault(ctx, in.ID, "stream.authenticate", started, err)
						}
					}
					// 撤销后只尝试交付安全失效事件，不再发送日志；写仍受连接期限约束。
					budget.verifyAt = budget.expires
					if ctx.Err() == nil {
						_ = send.Data(streamError{Code: code})
					}
					return false
				}
				budget.verifyAt = time.Now().Add(15 * time.Second)
			}
			return true
		}
		publish := func(event sse.Message) bool { return allowed() && send(event) == nil && allowed() }
		ticker := time.NewTicker(150 * time.Millisecond)
		defer ticker.Stop()
		for allowed() {
			// 在终态发布前日志已关闭，先读取状态再排空日志，避免遗漏尾部字节。
			started := time.Now()
			run, err := s.getRun(in.ID)
			if err != nil {
				if !errors.Is(err, errMissing) {
					streamFault(ctx, in.ID, "stream.run", started, err)
				}
				publish(sse.Message{Data: streamError{Code: "streamFailed"}})
				return
			}
			for allowed() {
				started = time.Now()
				chunk, err := s.readChunk(in.ID, offset)
				if err != nil {
					streamFault(ctx, in.ID, "stream.read", started, err)
					publish(sse.Message{Data: streamError{Code: "streamFailed"}})
					return
				}
				if len(chunk) == 0 {
					break
				}
				offset += int64(len(chunk))
				if !publish(sse.Message{IDString: strconv.FormatInt(offset, 10), Data: logEvent{Data: base64.StdEncoding.EncodeToString(chunk), Offset: offset}}) {
					return
				}
			}
			if !publish(sse.Message{Data: statusEvent{Status: run.Status, Offset: offset}}) || terminal(run.Status) {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
