package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
)

func TestNormalizedSchemaRuleIsReturnedOnlyOnce(t *testing.T) {
	s := openTestService(t)
	withBootHTTP(t, func(api huma.API) { registerValidationFixture(api, s) }, func(base string) {
		in := definition(t.TempDir(), "true")
		in.Steps[0].Env = map[string]string{}
		data, _ := json.Marshal(struct {
			Name string `json:"name"`
			TaskInput
		}{"", in})
		for _, lang := range []string{"zh-CN", "en"} {
			req, _ := http.NewRequest("POST", base+"/validate", strings.NewReader(string(data)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept-Language", lang)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := io.ReadAll(res.Body)
			res.Body.Close()
			var problem struct{ Errors []taskErrorDetail }
			if err := json.Unmarshal(raw, &problem); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != 422 || len(problem.Errors) != 1 || problem.Errors[0].Location != "body.name" || problem.Errors[0].Code != "taskName" {
				t.Errorf("same normalized rule repeated: %d %s", res.StatusCode, raw)
			}
		}
	})
}

func TestTriggerOverrideErrorsAggregateAcrossServiceAndWebhook(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), `printf '%s:%s:%s' "$ALLOWED" "$STEP" "${UNKNOWN-unset}"`)
	in.Steps[0].Env = map[string]string{"STEP": "default"}
	task, err := s.save("trigger-fields", in, true)
	if err != nil {
		t.Fatal(err)
	}
	capture := captureDiagnostics(t)
	bad := map[string]string{"ALLOWED": "environment-secret\x00", "STEP": "script-secret\x00", "token-secret!": "unknown-secret\x00"}
	_, err = s.trigger(task.Name, bad)
	if !errors.Is(err, errInvalid) || len(validationDetails(context.Background(), err)) != 3 {
		t.Fatalf("direct trigger discarded errors: %v", err)
	}
	_, err = s.triggerHook(task.Name, bad, task.Token)
	details := validationDetails(context.Background(), err)
	if !errors.Is(err, errInvalid) || len(details) != 3 {
		t.Fatalf("direct hook discarded errors: %v", err)
	}
	for _, detail := range details {
		if detail.Location != "query" && !strings.HasPrefix(detail.Location, "query.") {
			t.Errorf("wrong hook source: %+v", detail)
		}
	}
	for _, name := range []string{task.Name, "missing"} {
		if _, err := s.triggerHook(name, bad, "wrong"); !errors.Is(err, errHookDenied) {
			t.Errorf("input validation ran before token authentication: %v", err)
		}
	}
	withBootHTTP(t, func(api huma.API) {
		huma.Post(languageAPI(api), "/validation-trigger/{name}", func(ctx context.Context, in *triggerInput) (*runOutput, error) {
			run, err := s.trigger(in.Name, in.Body.Env)
			if err != nil {
				return nil, fault(ctx, err)
			}
			return &runOutput{run}, nil
		})
		registerTasks(api, s, nil)
	}, func(base string) {
		data, _ := json.Marshal(map[string]any{"env": bad})
		for _, lang := range []string{"zh-CN", "en"} {
			paths := []struct{ method, path, body, prefix string }{
				{"POST", "/validation-trigger/" + task.Name, string(data), "body.env"},
			}
			for _, path := range []string{"/api/hooks/", "/hook/"} {
				for _, method := range []string{"GET", "POST"} {
					values := url.Values{}
					for key, value := range bad {
						values.Set(key, value)
					}
					paths = append(paths, struct{ method, path, body, prefix string }{method, path + task.Name + "?" + values.Encode(), "", "query"})
				}
			}
			for _, tc := range paths {
				req, _ := http.NewRequest(tc.method, base+tc.path, strings.NewReader(tc.body))
				req.Header.Set("Accept-Language", lang)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Hook-Token", task.Token)
				res, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := io.ReadAll(res.Body)
				res.Body.Close()
				var problem struct {
					Code   string
					Errors []taskErrorDetail
				}
				if err := json.Unmarshal(raw, &problem); err != nil {
					t.Fatal(err)
				}
				if res.StatusCode != 422 || problem.Code != "invalidTask" || len(problem.Errors) != 3 {
					t.Errorf("incomplete override errors: %d %s", res.StatusCode, raw)
				}
				positions := map[string]bool{}
				for _, detail := range problem.Errors {
					positions[detail.Location] = true
					if detail.Code != "noNul" {
						t.Errorf("wrong rule identity: %+v", detail)
					}
					want := "Remove null"
					if lang == "zh-CN" {
						want = "请移除空字符"
					}
					if !strings.Contains(detail.Message, want) {
						t.Errorf("wrong localized correction: %+v", detail)
					}
				}
				for _, position := range []string{tc.prefix, tc.prefix + ".ALLOWED", tc.prefix + ".STEP"} {
					if !positions[position] {
						t.Errorf("missing %s: %s", position, raw)
					}
				}
				for _, secret := range []string{"environment-secret", "script-secret", "unknown-secret", "token-secret", task.Token, `"value"`} {
					if strings.Contains(string(raw), secret) {
						t.Errorf("override secret leaked: %s", raw)
					}
				}
			}
			// 错令牌与不存在任务都优先拒绝；查询中的NUL不暴露存在性。
			for _, name := range []string{task.Name, "missing"} {
				req, _ := http.NewRequest("GET", base+"/api/hooks/"+name+"?ALLOWED=secret%00", nil)
				req.Header.Set("X-Hook-Token", "wrong")
				res, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != 401 || strings.Contains(string(raw), "noNul") {
					t.Errorf("hook authentication order changed: %d %s", res.StatusCode, raw)
				}
			}
		}
	})
	if rows, err := s.readRuns(); err != nil || len(rows) != 0 {
		t.Fatalf("invalid input admitted execution: %+v %v", rows, err)
	}
	if text := capture.text(); strings.Contains(text, "level=ERROR") || strings.Contains(text, "environment-secret") || strings.Contains(text, task.Token) {
		t.Errorf("normal rejection diagnosed or secret logged: %s", text)
	}
	// 未声明的普通覆盖值仍被忽略，任务变量和步骤变量保持原白名单覆盖次序。
	run, err := s.trigger(task.Name, map[string]string{"ALLOWED": "a", "STEP": "b", "UNKNOWN": "injected"})
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, run.ID); got.Status != "success" {
		t.Fatal(got)
	}
	output, err := os.ReadFile(s.logPath(run.ID))
	if err != nil || string(output) != "a:b:unset" {
		t.Fatalf("whitelist changed: %q %v", output, err)
	}
}
