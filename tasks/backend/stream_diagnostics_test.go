package backend

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/go-chi/chi/v5/middleware"
	auth "red-berry-kit/auth/backend"
)

func streamFixture(t *testing.T, s *taskService, id string) {
	t.Helper()
	if err := writeJSONAtomically(s.runPath(id), Run{ID: id, TaskName: "stream-task", Status: "running", CreatedAt: now()}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.logPath(id), nil, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestSSEStorageFaultDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name, query, phase string
		setup              func(*testing.T, *taskService, string)
		status             int
	}{
		{"corrupt", "", "stream.run", func(t *testing.T, s *taskService, id string) {
			if err := os.WriteFile(s.runPath(id), []byte("{"), 0600); err != nil {
				t.Fatal(err)
			}
		}, 500},
		{"stat", "?offset=0", "stream.stat", func(t *testing.T, s *taskService, id string) {
			if err := os.Remove(s.logPath(id)); err != nil {
				t.Fatal(err)
			}
		}, 500},
		{"stat-loop", "?offset=0", "stream.stat", func(t *testing.T, s *taskService, id string) {
			path := s.logPath(id)
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(path, path); err != nil {
				t.Fatal(err)
			}
		}, 500},
		{"read-directory", "", "stream.read", func(t *testing.T, s *taskService, id string) {
			path := s.logPath(id)
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(path, 0700); err != nil {
				t.Fatal(err)
			}
		}, 200},
		{"read", "", "stream.read", func(t *testing.T, s *taskService, id string) {
			if err := os.Remove(s.logPath(id)); err != nil {
				t.Fatal(err)
			}
		}, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := openTestService(t)
			id := "stream-" + tc.name
			streamFixture(t, s, id)
			tc.setup(t, s, id)
			capture := captureDiagnostics(t)
			_, api := humatest.New(t)
			api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
				next(huma.WithContext(ctx, context.WithValue(ctx.Context(), middleware.RequestIDKey, "stream-request")))
			})
			registerLogStream(api, s, nil)
			response := api.Get("/api/runs/" + id + "/events" + tc.query)
			if strings.Contains(response.Body.String(), s.dir) {
				t.Error("storage path leaked in response")
			}
			if response.Code != tc.status {
				t.Errorf("status=%d want=%d body=%s", response.Code, tc.status, response.Body)
			}
			text := capture.text()
			for _, want := range []string{id, tc.phase, "request_id=stream-request", "duration_ms=", "error="} {
				if !strings.Contains(text, want) {
					t.Errorf("missing %q: %s", want, text)
				}
			}
			if strings.Count(text, "level=ERROR") != 1 {
				t.Errorf("want one fault: %s", text)
			}
			if tc.status == 200 && !strings.Contains(response.Body.String(), `"code":"streamFailed"`) {
				t.Error(response.Body)
			}
		})
	}
}

type streamAuthResult struct {
	principal auth.Principal
	err       error
	cancel    context.CancelFunc
}

func (a streamAuthResult) Authenticate(context.Context, string) (auth.Principal, error) {
	if a.cancel != nil {
		a.cancel()
	}
	return a.principal, a.err
}

func TestSSEStorageFaultAfterConnection(t *testing.T) {
	for _, phase := range []string{"run", "read"} {
		t.Run(phase, func(t *testing.T) {
			s := openTestService(t)
			id := "during-" + phase
			streamFixture(t, s, id)
			capture := captureDiagnostics(t)
			_, api := humatest.New(t)
			registerLogStream(api, s, nil)
			server := httptest.NewServer(api.Adapter())
			defer server.Close()
			res, err := http.Get(server.URL + "/api/runs/" + id + "/events")
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			reader := bufio.NewReader(res.Body)
			if _, err := reader.ReadString('\n'); err != nil {
				t.Fatal(err)
			}
			if phase == "run" {
				if err := os.WriteFile(s.runPath(id), []byte("{"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Remove(s.logPath(id)); err != nil {
					t.Fatal(err)
				}
			}
			data, err := io.ReadAll(reader)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(data), `"code":"streamFailed"`) {
				t.Errorf("missing safe error: %s", data)
			}
			text := capture.text()
			if strings.Count(text, "level=ERROR") != 1 || !strings.Contains(text, "stream."+phase) || !strings.Contains(text, "duration_ms=") {
				t.Errorf("missing once-only diagnostic: %s", text)
			}
		})
	}
}

func TestSSENormalRejectionsDoNotDiagnoseFault(t *testing.T) {
	s := openTestService(t)
	streamFixture(t, s, "reject")
	capture := captureDiagnostics(t)
	_, api := humatest.New(t)
	registerLogStream(api, s, nil)
	for _, path := range []string{"/api/runs/missing/events", "/api/runs/reject/events?offset=-1", "/api/runs/reject/events?offset=1"} {
		res := api.Get(path)
		if res.Code != 404 && res.Code != 422 {
			t.Errorf("unexpected status %d", res.Code)
		}
	}
	if text := capture.text(); strings.Contains(text, "stream.") || strings.Contains(text, "level=ERROR") {
		t.Errorf("normal rejection diagnosed: %s", text)
	}
}

type streamAuthFunc func(context.Context, string) (auth.Principal, error)

func (f streamAuthFunc) Authenticate(ctx context.Context, token string) (auth.Principal, error) {
	return f(ctx, token)
}

func TestSSEAuthenticationSuccessAndDisconnect(t *testing.T) {
	if testing.Short() {
		t.Skip("真实15秒成功复查与断开")
	}
	s := openTestService(t)
	id := "auth-success"
	streamFixture(t, s, id)
	capture := captureDiagnostics(t)
	_, api := humatest.New(t)
	verified := make(chan struct{})
	completed := make(chan struct{})
	registerLogStream(api, s, streamAuthFunc(func(ctx context.Context, token string) (auth.Principal, error) {
		if token != "success-secret" || auth.CurrentApp(ctx) != "admin" {
			return auth.Principal{}, errors.New("wrong authentication context")
		}
		close(verified)
		return auth.Principal{App: "admin", Source: "config", ID: "admin"}, nil
	}))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { defer close(completed); api.Adapter().ServeHTTP(w, r) }))
	defer server.Close()
	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/runs/"+id+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer success-secret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	select {
	case <-verified:
	case <-time.After(18 * time.Second):
		t.Fatal("successful recheck not reached")
	}
	if err := os.WriteFile(s.logPath(id), []byte("after"), 0600); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(res.Body)
	// 复查通过后仍可接收新增日志；断开只结束流，不取消独立运行。
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(line, `"data":"YWZ0ZXI="`) {
			break
		}
	}
	_ = res.Body.Close()
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("disconnect did not stop stream")
	}
	if text := capture.text(); strings.Contains(text, "level=ERROR") || strings.Contains(text, "success-secret") {
		t.Errorf("normal disconnect or secret diagnosed: %s", text)
	}
}

func TestSSEAuthenticationErrorIdentity(t *testing.T) {
	if testing.Short() {
		t.Skip("真实15秒鉴权错误分类边界")
	}
	for _, tc := range []struct {
		name      string
		err       error
		principal auth.Principal
		code      string
		fault     bool
	}{
		{"denied", fmt.Errorf("wrapped: %w", auth.ErrDenied), auth.Principal{}, "loginRequired", false},
		{"stale", auth.ErrTokenClaimsStale, auth.Principal{}, "loginRequired", false},
		{"permission", nil, auth.Principal{App: "admin", Source: "external", ID: "admin"}, "loginRequired", false},
		{"limited", auth.ErrLimited, auth.Principal{}, "streamFailed", false},
		{"dependency", errors.New("STREAM_CACHE_FAILURE"), auth.Principal{}, "streamFailed", true},
		{"canceled", context.Canceled, auth.Principal{}, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := openTestService(t)
			id := "auth-" + tc.name
			streamFixture(t, s, id)
			capture := captureDiagnostics(t)
			_, api := humatest.New(t)
			// 使用真实HTTP及15秒复查边界，不修改生产预算。
			api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
				next(huma.WithContext(ctx, context.WithValue(ctx.Context(), middleware.RequestIDKey, "auth-request")))
			})
			registerLogStream(api, s, streamAuthResult{principal: tc.principal, err: tc.err})
			server := httptest.NewServer(api.Adapter())
			defer server.Close()
			req, err := http.NewRequest(http.MethodGet, server.URL+"/api/runs/"+id+"/events", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer stream-token-secret")
			response, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			data, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			body := string(data)
			if tc.code != "" && !strings.Contains(body, `"code":"`+tc.code+`"`) {
				t.Errorf("wrong auth result: %s", body)
			}
			if tc.code == "" && strings.Contains(body, "event: error") {
				t.Errorf("cancellation emitted failure: %s", body)
			}
			text := capture.text()
			if strings.Contains(text, "stream-token-secret") || strings.Contains(body, "STREAM_CACHE_FAILURE") || strings.Contains(body, "stream-token-secret") {
				t.Error("sensitive diagnostic crossed boundary")
			}
			wantFaults := 0
			if tc.fault {
				wantFaults = 1
			}
			if got := strings.Count(text, "level=ERROR"); got != wantFaults {
				t.Errorf("want %d faults, got %d: %s", wantFaults, got, text)
			}
			if tc.fault {
				for _, want := range []string{"STREAM_CACHE_FAILURE", "stream.authenticate", "request_id=auth-request", "duration_ms="} {
					if !strings.Contains(text, want) {
						t.Errorf("missing %s: %s", want, text)
					}
				}
			}
		})
	}
}
