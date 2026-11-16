package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/fx"
	"red-berry-kit/boot/backend/app"
)

func TestPersistedRunCorruptionIsStorageFailure(t *testing.T) {
	for _, kind := range []string{"directory", "symlink", "invalid-id", "mismatched-id", "invalid-name", "invalid-status"} {
		t.Run(kind, func(t *testing.T) {
			s := openTestService(t)
			id := "record"
			path := s.runPath(id)
			run := Run{ID: id, TaskName: "task", Status: "success"}
			switch kind {
			case "directory":
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink("missing", path); err != nil {
					t.Fatal(err)
				}
			default:
				switch kind {
				case "invalid-id":
					run.ID = "../escape"
				case "mismatched-id":
					run.ID = "other"
				case "invalid-name":
					run.TaskName = "../secret"
				case "invalid-status":
					run.Status = "unknown"
				}
				if err := writeJSONAtomically(path, run); err != nil {
					t.Fatal(err)
				}
			}
			for _, read := range []func() error{func() error { _, err := s.getRun(id); return err }, func() error { _, err := s.readRuns(); return err }, func() error { return s.cancel(id) }} {
				capture := captureDiagnostics(t)
				err := read()
				if err == nil || errors.Is(err, errInvalid) || errors.Is(err, errConflict) || errors.Is(err, errMissing) {
					t.Errorf("storage corruption misclassified: %v", err)
					continue
				}
				problem := fault(context.Background(), err).(*taskError)
				if problem.Status != 500 || problem.Code != "storageFailed" {
					t.Errorf("unsafe status: %+v", problem)
				}
				if strings.Count(capture.text(), "level=ERROR") != 1 {
					t.Errorf("fault not reported once: %s", capture.text())
				}
			}
		})
	}
}
func TestCancelPropagatesNonMissingStatFailure(t *testing.T) {
	s := openTestService(t)
	path := s.runPath("loop")
	if err := os.Symlink(path, path); err != nil {
		t.Fatal(err)
	}
	if err := s.cancel("loop"); err == nil || errors.Is(err, errConflict) || errors.Is(err, errMissing) {
		t.Fatalf("stat failure swallowed: %v", err)
	}
	if err := s.cancel("missing"); !errors.Is(err, errMissing) {
		t.Fatal(err)
	}
}
func TestEveryPersistenceRetryRetainsCauseAndTiming(t *testing.T) {
	capture := captureDiagnostics(t)
	s := newTaskService(Config{DataDir: t.TempDir()})
	if err := os.Mkdir(filepath.Join(s.dir, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	s.unsavedResults["retry"] = Run{ID: "retry", TaskName: "task", Status: "success"}
	if err := os.Mkdir(s.runPath("retry"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.saveUnsavedResults(); err == nil {
		t.Fatal("first failure missing")
	}
	if err := os.Rename(filepath.Join(s.dir, "runs"), filepath.Join(s.dir, "unavailable")); err != nil {
		t.Fatal(err)
	}
	if err := s.saveUnsavedResults(); err == nil {
		t.Fatal("second failure missing")
	}
	text := capture.text()
	if strings.Count(text, "level=ERROR") != 2 || strings.Count(text, "duration_ms=") != 2 || !strings.Contains(text, "no such file or directory") || !strings.Contains(text, "file exists") {
		t.Fatalf("retry causes/timings lost: %s", text)
	}
}

// 使用 boot 公开 command 入口取得真实 middlewareAPI；HTTP 使用独立随机端口，不读部署配置。
func withBootHTTP(t *testing.T, register func(huma.API), check func(string)) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "app.toml"), []byte("[red-berry-kit.boot]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	command := app.New(app.Options{Name: "backend-regression", ConfigDir: dir, Application: app.Assembly{Module: fx.Options(app.ProvideCommand(func(api huma.API) app.Command {
		register(api)
		return app.Command{Name: "verify", Run: func(context.Context, io.Reader, io.Writer) error {
			server := httptest.NewServer(api.Adapter())
			defer server.Close()
			check(server.URL)
			return nil
		}}
	}))}})
	if err := command.Run(context.Background(), []string{"backend-regression", "command", "verify"}); err != nil {
		t.Fatal(err)
	}
}
func registerValidationFixture(api huma.API, s *taskService) {
	localized := languageAPI(api)
	huma.Register(localized, huma.Operation{OperationID: "validation-create", Method: "POST", Path: "/validate"}, func(ctx context.Context, in *createTaskInput) (*taskOutput, error) {
		task, err := s.save(in.Body.Name, in.Body.TaskInput, true)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &taskOutput{task}, nil
	})
}
func TestSemanticValidationAggregatesSafeLocalizedFieldsThroughBootHTTP(t *testing.T) {
	s := openTestService(t)
	capture := captureDiagnostics(t)
	in := definition("relative", "script-secret\x00")
	in.Timeout = "999ms"
	in.Env = map[string]string{"KEY": "env-secret\x00", "token-secret!": "do-not-echo"}
	in.Steps[0].Name = " "
	in.Steps[0].Workdir = "relative"
	in.Steps[0].Env = map[string]string{}
	body := map[string]any{"name": "valid", "description": "", "parallel": false, "workdir": in.Workdir, "timeout": in.Timeout, "queue": in.SchedulingPolicy, "env": in.Env, "steps": in.Steps}
	raw, _ := json.Marshal(body)
	withBootHTTP(t, func(api huma.API) { registerValidationFixture(api, s) }, func(base string) {
		for _, lang := range []string{"zh-CN", "en"} {
			req, _ := http.NewRequest("POST", base+"/validate", strings.NewReader(string(raw)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept-Language", lang)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			data, _ := io.ReadAll(res.Body)
			res.Body.Close()
			var problem struct {
				Code   string `json:"code"`
				Errors []struct {
					Location, Message, Code string
					Value                   any
				} `json:"errors"`
			}
			if err := json.Unmarshal(data, &problem); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != 422 || problem.Code != "invalidTask" || len(problem.Errors) != 7 {
				t.Errorf("want 7 semantic errors: %d %s", res.StatusCode, data)
			}
			locations := map[string]bool{}
			for _, item := range problem.Errors {
				locations[item.Location] = true
				if item.Code == "" || item.Message == "" || item.Value != nil {
					t.Errorf("missing safe identity/detail: %+v", item)
				}
			}
			for _, loc := range []string{"body.timeout", "body.workdir", "body.env.KEY", "body.env", "body.steps[0].name", "body.steps[0].workdir", "body.steps[0].commands[0]"} {
				if !locations[loc] {
					t.Errorf("missing %s: %s", loc, data)
				}
			}
			for _, secret := range []string{"script-secret", "env-secret", "token-secret", "do-not-echo"} {
				if strings.Contains(string(data), secret) {
					t.Errorf("secret leaked: %s", data)
				}
			}
			if lang == "en" && !strings.Contains(string(data), "absolute") {
				t.Errorf("not English corrective message: %s", data)
			}
			if lang == "zh-CN" && !strings.Contains(string(data), "绝对") {
				t.Errorf("not Chinese corrective message: %s", data)
			}
		}
	})
	if text := capture.text(); strings.Contains(text, "level=ERROR") || strings.Contains(text, "script-secret") || strings.Contains(text, "env-secret") {
		t.Errorf("normal validation logged as fault or leaked input: %s", text)
	}
}
func TestSchemaAndSemanticValidationDoNotDuplicateLocations(t *testing.T) {
	s := openTestService(t)
	_, api := humatest.New(t)
	registerValidationFixture(api, s)
	response := api.Post("/validate", map[string]any{"name": "valid", "workdir": "/tmp", "timeout": "invalid", "queue": "wrong", "steps": []map[string]any{{"name": "", "workdir": "relative", "commands": []string{" "}}}})
	var problem struct {
		Errors []struct{ Location string } `json:"errors"`
	}
	_ = json.Unmarshal(response.Body.Bytes(), &problem)
	counts := map[string]int{}
	for _, item := range problem.Errors {
		counts[item.Location]++
	}
	for _, loc := range []string{"body.queue", "body.steps[0].name", "body.timeout", "body.steps[0].workdir", "body.steps[0].commands[0]"} {
		if counts[loc] != 1 {
			t.Errorf("want one %s: %s", loc, response.Body)
		}
	}
}
func TestSchemaDeduplicationRetainsDifferentRulesOnSameField(t *testing.T) {
	s := openTestService(t)
	_, api := humatest.New(t)
	registerValidationFixture(api, s)
	in := definition("/"+strings.Repeat("x", 4096)+"\x00", "true")
	in.Steps[0].Env = map[string]string{}
	response := api.Post("/validate", struct {
		Name string `json:"name"`
		TaskInput
	}{"valid", in})
	var problem struct {
		Errors []struct{ Location, Code string }
	}
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
		t.Fatal(err)
	}
	codes := map[string]int{}
	for _, detail := range problem.Errors {
		if detail.Location == "body.workdir" {
			codes[detail.Code]++
		}
	}
	if response.Code != 422 || codes["workdirTooLong"] != 1 || codes["noNul"] != 1 {
		t.Fatalf("distinct reasons discarded or schema duplicated: %d %s", response.Code, response.Body)
	}
}

func TestStorageFaultRequestBoundaryHasRunAndPhaseTiming(t *testing.T) {
	s := openTestService(t)
	if err := os.Mkdir(s.runPath("record"), 0700); err != nil {
		t.Fatal(err)
	}
	capture := captureDiagnostics(t)
	_, api := humatest.New(t)
	api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		next(huma.WithContext(ctx, context.WithValue(ctx.Context(), middleware.RequestIDKey, "record-request")))
	})
	localized := languageAPI(api)
	huma.Get(localized, "/api/runs/{id}", func(ctx context.Context, in *RunPathInput) (*runOutput, error) {
		r, err := s.getRun(in.ID)
		if err != nil {
			return nil, fault(ctx, err)
		}
		return &runOutput{r}, nil
	})
	response := api.Get("/api/runs/record")
	if response.Code != 500 {
		t.Fatalf("bad status: %d %s", response.Code, response.Body)
	}
	text := capture.text()
	for _, want := range []string{"record", "request_id=record-request", "duration_ms=", "error=", "storage"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s: %s", want, text)
		}
	}
	if strings.Count(text, "level=ERROR") != 1 {
		t.Error(text)
	}
}

func TestSaveRetainsEverySemanticViolation(t *testing.T) {
	s := openTestService(t)
	in := definition("relative", "private-script\x00")
	in.Timeout = "25h"
	in.Env = map[string]string{"KEY": "private-value\x00"}
	in.Steps[0].Workdir = "relative"
	in.Steps[0].Name = " "
	_, err := s.save("invalid!", in, true)
	if !errors.Is(err, errInvalid) {
		t.Fatalf("compatibility identity lost: %v", err)
	}
	details := validationDetails(context.Background(), err)
	if len(details) != 7 {
		t.Fatalf("save discarded aggregate details: %+v %v", details, err)
	}
	for _, secret := range []string{"private-script", "private-value", "invalid!"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("input in error: %v", err)
		}
	}
}

func TestSchemaValidationThroughBootHTTPIsSafeLocalizedAndConcurrent(t *testing.T) {
	s := openTestService(t)
	capture := captureDiagnostics(t)
	// 缺失description、parallel和步骤env，促使Huma原始错误携带整个body；另有Schema/语义错误。
	body := `{"name":"valid","workdir":"/tmp","timeout":"invalid","queue":"wrong","env":{"KEY":"environment-canary"},"steps":[{"name":"","workdir":"relative","commands":["private-script-canary"]}]}`
	withBootHTTP(t, func(api huma.API) { registerValidationFixture(api, s) }, func(base string) {
		var wg sync.WaitGroup
		for i := 0; i < 16; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				lang, want := "en", "Correct the following"
				if i%2 == 0 {
					lang, want = "zh-CN", "请修改"
				}
				req, _ := http.NewRequest("POST", base+"/validate", strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept-Language", lang)
				res, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Error(err)
					return
				}
				data, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != 422 || res.Header.Get("Content-Language") != lang || !strings.Contains(string(data), want) {
					t.Errorf("locale/status mismatch: %d %s %s", res.StatusCode, res.Header.Get("Content-Language"), data)
				}
				var problem struct {
					Code   string
					Errors []struct{ Location, Code, Message string }
				}
				if err := json.Unmarshal(data, &problem); err != nil {
					t.Error(err)
					return
				}
				paths := map[string]int{}
				for _, item := range problem.Errors {
					paths[item.Location]++
					if item.Code == "" {
						t.Error("missing stable identity")
					}
				}
				for _, path := range []string{"body.description", "body.parallel", "body.queue", "body.timeout", "body.steps[0].name", "body.steps[0].env", "body.steps[0].workdir"} {
					if paths[path] != 1 {
						t.Errorf("missing/duplicated %s: %s", path, data)
					}
				}
				for _, secret := range []string{"environment-canary", "private-script-canary", `"value"`} {
					if strings.Contains(string(data), secret) {
						t.Errorf("secret value in response: %s", data)
					}
				}
			}(i)
		}
		wg.Wait()
	})
	if text := capture.text(); strings.Contains(text, "level=ERROR") || strings.Contains(text, "environment-canary") || strings.Contains(text, "private-script-canary") {
		t.Errorf("normal rejection diagnosed or secrets logged: %s", text)
	}
}

func TestStorageFailuresThroughBootHTTPRemainSafeAndOnceOnly(t *testing.T) {
	s := openTestService(t)
	if err := os.Mkdir(s.runPath("record"), 0700); err != nil {
		t.Fatal(err)
	}
	capture := captureDiagnostics(t)
	withBootHTTP(t, func(api huma.API) {
		api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
			next(huma.WithContext(ctx, context.WithValue(ctx.Context(), middleware.RequestIDKey, "boot-record-request")))
		})
		localized := languageAPI(api)
		huma.Get(localized, "/records/{id}", func(ctx context.Context, in *RunPathInput) (*runOutput, error) {
			run, err := s.getRun(in.ID)
			if err != nil {
				return nil, fault(ctx, err)
			}
			return &runOutput{run}, nil
		})
	}, func(base string) {
		for _, lang := range []string{"zh-CN", "en"} {
			req, _ := http.NewRequest("GET", base+"/records/record", nil)
			req.Header.Set("Accept-Language", lang)
			response, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			data, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != 500 || !strings.Contains(string(data), `"code":"storageFailed"`) || strings.Contains(string(data), s.dir) || strings.Contains(string(data), "regular file") {
				t.Errorf("unsafe storage response: %d %s", response.StatusCode, data)
			}
		}
	})
	text := capture.text()
	if strings.Count(text, "level=ERROR") != 2 || strings.Count(text, "operation=run.record.storage.run.read result=failed duration_ms=") != 2 || !strings.Contains(text, "request_id=boot-record-request") || !strings.Contains(text, "record.storage.run.read") || !strings.Contains(text, "not a regular file") {
		t.Errorf("missing/duplicate boot diagnostics: %s", text)
	}
}
