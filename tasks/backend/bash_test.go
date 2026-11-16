package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
)

func TestBashRequiredAndShellIdentity(t *testing.T) {
	for _, path := range []string{filepath.Join(t.TempDir(), "missing-bash"), "/bin/false", "/bin/true"} {
		if err := checkBash(context.Background(), path); err == nil || !strings.Contains(err.Error(), "Bash") {
			t.Fatalf("未拒绝不可用的 Bash %q: %v", path, err)
		}
	}
	if err := checkBash(context.Background(), bashPath); err != nil {
		t.Fatal(err)
	}
}

func TestBashSyntaxAndIndependentCommands(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), `items=(one two); [[ ${items[1]} == two ]] || exit 3; greeting() { printf '中文:%s' "${items[0]}"; }; greeting; export PRIVATE_VALUE=first`)
	in.Steps[0].Commands = append(in.Steps[0].Commands, `[[ ${PRIVATE_VALUE-unset} == unset ]] || exit 4; printf ':independent'`)
	if _, err := s.save("bash-features", in, true); err != nil {
		t.Fatal(err)
	}
	run, err := s.trigger("bash-features", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, run.ID); got.Status != "success" {
		t.Fatalf("Bash任务失败: %+v", got)
	}
	log, err := os.ReadFile(s.logPath(run.ID))
	if err != nil || string(log) != "中文:one:independent" {
		t.Fatalf("日志 %q: %v", log, err)
	}
}

func TestBashIgnoresImplicitStartupEnvironment(t *testing.T) {
	startup := filepath.Join(t.TempDir(), "startup.sh")
	if err := os.WriteFile(startup, []byte("printf 'unexpected-startup'; exit 9"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BASH_ENV", startup)
	t.Setenv("ENV", startup)
	t.Setenv("SHELLOPTS", "nounset")
	t.Setenv("BASHOPTS", "failglob")
	t.Setenv("POSIXLY_CORRECT", "1")
	t.Setenv("BASH_FUNC_unexpected%%", "() { printf imported; }")
	s := openTestService(t)
	script := `[[ -z ${BASH_ENV-}${ENV-}${POSIXLY_CORRECT-} ]] || exit 3; [[ $- != *u* ]] || exit 4; shopt -q failglob && exit 5; declare -F unexpected && exit 6; printf clean`
	if _, err := s.save("clean-bash", definition(t.TempDir(), script), true); err != nil {
		t.Fatal(err)
	}
	run, err := s.trigger("clean-bash", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, run.ID); got.Status != "success" {
		t.Fatalf("环境隔离失败: %+v", got)
	}
	log, err := os.ReadFile(s.logPath(run.ID))
	if err != nil || string(log) != "clean" {
		t.Fatalf("日志 %q: %v", log, err)
	}
}

func TestReservedShellVariablesHaveStructuredLocations(t *testing.T) {
	for _, key := range []string{"BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "POSIXLY_CORRECT"} {
		t.Run(key, func(t *testing.T) {
			in := definition(t.TempDir(), "true")
			in.Env[key] = "secret-value"
			in.Steps[0].Env = map[string]string{key: "secret-value"}
			err := validateTask(in)
			if !errors.Is(err, errInvalid) {
				t.Fatalf("保留变量被接受: %v", err)
			}
			details := validationDetails(context.Background(), err)
			if len(details) != 2 || details[0].Code != "shellEnvReserved" || details[0].Location != "body.env."+key || details[1].Location != "body.steps[0].env."+key {
				t.Fatalf("字段错误: %+v", details)
			}
			for _, location := range []string{"body.env", "query"} {
				details = validationDetails(context.Background(), validateOverrides(map[string]string{key: "secret-value"}, location))
				if len(details) != 1 || details[0].Code != "shellEnvReserved" || details[0].Location != location+"."+key {
					t.Fatalf("覆盖字段错误: %+v", details)
				}
			}
		})
	}
}

func TestReservedShellVariableThroughBootHTTP(t *testing.T) {
	s := openTestService(t)
	withBootHTTP(t, func(api huma.API) { registerValidationFixture(api, s) }, func(base string) {
		input := definition(t.TempDir(), "true")
		input.Env["BASH_ENV"] = "startup-secret"
		input.Steps[0].Env = map[string]string{}
		body := map[string]any{"name": "bash-reserved", "description": "", "parallel": false, "workdir": input.Workdir, "timeout": input.Timeout, "queue": input.SchedulingPolicy, "env": input.Env, "steps": input.Steps}
		raw, _ := json.Marshal(body)
		for _, lang := range []string{"zh-CN", "en"} {
			req, _ := http.NewRequest("POST", base+"/validate", strings.NewReader(string(raw)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept-Language", lang)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(res.Body)
			res.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			var problem taskError
			if err := json.Unmarshal(data, &problem); err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != 422 || problem.Code != "invalidTask" || len(problem.Errors) != 1 || problem.Errors[0].Code != "shellEnvReserved" || problem.Errors[0].Location != "body.env.BASH_ENV" || strings.Contains(string(data), "startup-secret") {
				t.Fatalf("字段响应: %d %s", res.StatusCode, data)
			}
		}
	})
}

func TestLegacyReservedEnvironmentLoadsWithoutRewriting(t *testing.T) {
	dir := t.TempDir()
	s := newTaskService(Config{DataDir: dir})
	if err := os.MkdirAll(filepath.Join(dir, "tasks"), 0700); err != nil {
		t.Fatal(err)
	}
	startup := filepath.Join(t.TempDir(), "startup.sh")
	if err := os.WriteFile(startup, []byte("printf 'unexpected-startup'; exit 9"), 0600); err != nil {
		t.Fatal(err)
	}
	in := definition(t.TempDir(), `[[ -z ${BASH_ENV-}${ENV-}${POSIXLY_CORRECT-} ]] || exit 3; [[ $- != *u* ]] || exit 4; shopt -q failglob && exit 5; printf legacy-clean`)
	in.Env = map[string]string{"BASH_ENV": startup, "ENV": startup, "SHELLOPTS": "nounset", "BASHOPTS": "failglob", "POSIXLY_CORRECT": "1"}
	in.Steps[0].Env = map[string]string{"ENV": startup}
	task := Task{Name: "legacy-reserved", TaskInput: in, Token: "legacy-token", UpdatedAt: now()}
	original, err := json.MarshalIndent(task, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	original = append(original, '\n')
	path := s.taskPath(task.Name)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.start(context.Background()); err != nil {
		t.Fatalf("旧任务启动失败: %v", err)
	}
	t.Cleanup(func() {
		if err := s.stop(context.Background()); err != nil {
			t.Error(err)
		}
	})
	got, err := s.getTask(task.Name)
	if err != nil || got.Env["ENV"] != startup || got.Steps[0].Env["ENV"] != startup {
		t.Fatalf("旧配置未保留: %+v %v", got, err)
	}
	run, err := s.trigger(task.Name, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, run.ID); got.Status != "success" {
		t.Fatalf("旧任务运行失败: %+v", got)
	}
	log, err := os.ReadFile(s.logPath(run.ID))
	if err != nil || string(log) != "legacy-clean" {
		t.Fatalf("旧任务启动环境未过滤: %q %v", log, err)
	}
	if _, err := s.save(task.Name, got.TaskInput, false); !errors.Is(err, errInvalid) {
		t.Fatalf("重新保存接受保留变量: %v", err)
	}
	if _, err := s.trigger(task.Name, map[string]string{"ENV": startup}); !errors.Is(err, errInvalid) {
		t.Fatalf("触发接受保留变量: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(original) {
		t.Fatalf("旧JSON原文被改写: %v", err)
	}
}

func TestPersistedReservedEnvironmentDoesNotRelaxOtherValidation(t *testing.T) {
	good := definition(t.TempDir(), "true")
	good.Env["ENV"] = "legacy-value"
	if err := validatePersistedTask(good); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*TaskInput){
		"nul-value":        func(in *TaskInput) { in.Env["ENV"] = "bad\x00" },
		"invalid-name":     func(in *TaskInput) { in.Env["BASH_FUNC_bad%%"] = "() { :; }" },
		"relative-workdir": func(in *TaskInput) { in.Workdir = "relative" },
		"empty-steps":      func(in *TaskInput) { in.Steps = nil },
		"empty-commands":   func(in *TaskInput) { in.Steps[0].Commands = nil },
	} {
		t.Run(name, func(t *testing.T) {
			in := clone(good)
			change(&in)
			if err := validatePersistedTask(in); !errors.Is(err, errInvalid) {
				t.Fatalf("损坏配置被放行: %v", err)
			}
		})
	}
}
