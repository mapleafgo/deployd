package backend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStepWhitelistOverridesAndValidation(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), "printf '%s:%s' \"$ALLOWED\" \"$STEP\"")
	in.Steps[0].Env = map[string]string{"ALLOWED": "step-default", "STEP": "step-default"}
	_, err := s.save("env", in, true)
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.trigger("env", map[string]string{"ALLOWED": "override", "STEP": "override"})
	if err != nil {
		t.Fatal(err)
	}
	awaitRun(t, s, r.ID)
	data, _ := os.ReadFile(s.logPath(r.ID))
	if string(data) != "override:override" {
		t.Fatalf("step whitelist not overridden: %q", data)
	}
	for _, change := range []func(*TaskInput){func(in *TaskInput) { in.Timeout = "999ms" }, func(in *TaskInput) { in.Timeout = "25h" }, func(in *TaskInput) { in.Workdir = "relative" }, func(in *TaskInput) { in.Steps[0].Workdir = "relative" }, func(in *TaskInput) { in.Steps[0].Name = "  " }} {
		invalid := clone(in)
		change(&invalid)
		if _, err := s.save("invalid", invalid, true); !errors.Is(err, errInvalid) {
			t.Fatalf("accepted invalid input: %+v, %v", invalid, err)
		}
	}
}
func TestResultRetryRetainsMemoryWithoutReexecution(t *testing.T) {
	s := openTestService(t)
	dir := t.TempDir()
	gate := filepath.Join(dir, "gate")
	count := filepath.Join(dir, "count")
	script := fmt.Sprintf("while [ ! -f '%s' ]; do sleep .01; done; printf x >> '%s'", gate, count)
	_, _ = s.save("retry", definition(dir, script), true)
	r, err := s.trigger("retry", nil)
	if err != nil {
		t.Fatal(err)
	}
	// 运行已写入 running 后，用同名目录模拟终态原子替换失败。
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		got, _ := s.getRun(r.ID)
		if got.Status == "running" {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if err := os.Remove(s.runPath(r.ID)); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(s.runPath(r.ID), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(gate, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, r.ID); got.Status != "success" {
		t.Fatal(got)
	}
	s.mu.Lock()
	unsavedResults := len(s.unsavedResults)
	s.mu.Unlock()
	if unsavedResults != 1 {
		t.Fatalf("lost unpersisted result: %d", unsavedResults)
	}
	rows, listErr := s.readRuns()
	if listErr != nil || len(rows) != 1 || rows[0].Status != "success" {
		t.Fatalf("memory result not listable: %+v %v", rows, listErr)
	}
	if err := os.Remove(s.runPath(r.ID)); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		unsavedResults = len(s.unsavedResults)
		s.mu.Unlock()
		if unsavedResults == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if unsavedResults != 0 {
		t.Fatal("result not retried")
	}
	data, _ := os.ReadFile(count)
	if string(data) != "x" {
		t.Fatalf("execution repeated: %q", data)
	}
}
func TestStartupRecoversInterruptedWithoutExecuting(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONAtomically(filepath.Join(dir, "runs", "old.json"), Run{ID: "old", TaskName: "old-task", Status: "running", CreatedAt: now()}); err != nil {
		t.Fatal(err)
	}
	s := newTaskService(Config{DataDir: dir})
	if err := s.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer s.stop(context.Background())
	run, err := s.getRun("old")
	if err != nil || run.Status != "interrupted" || run.FinishedAt == nil {
		t.Fatalf("recovery %+v %v", run, err)
	}
}
func TestQueueTimeoutStartsAfterPredecessor(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), "sleep .65; printf x")
	in.Timeout = "1s"
	_, _ = s.save("timed-queue", in, true)
	a, _ := s.trigger("timed-queue", nil)
	b, _ := s.trigger("timed-queue", nil)
	if got := awaitRun(t, s, a.ID); got.Status != "success" {
		t.Fatal(got)
	}
	if got := awaitRun(t, s, b.ID); got.Status != "success" {
		t.Fatalf("queue consumed timeout: %+v", got)
	}
}
func TestAdmissionCapacityIncludesPendingResults(t *testing.T) {
	s := openTestService(t)
	_, _ = s.save("capacity", definition(t.TempDir(), "true"), true)
	s.mu.Lock()
	for i := range 256 {
		id := fmt.Sprintf("unsavedResults-%d", i)
		s.unsavedResults[id] = Run{ID: id, TaskName: "capacity", Status: "success"}
	}
	s.mu.Unlock()
	if _, err := s.trigger("capacity", nil); !errors.Is(err, errConflict) {
		t.Fatalf("capacity not enforced %v", err)
	}
}
func TestCancelledQueueKeepsFIFOChain(t *testing.T) {
	s := openTestService(t)
	dir := t.TempDir()
	in := definition(dir, "sleep .25; printf a")
	_, _ = s.save("chain", in, true)
	a, _ := s.trigger("chain", nil)
	b, _ := s.trigger("chain", nil)
	_ = s.cancel(b.ID)
	in.Steps[0].Commands = []string{"printf c"}
	_, _ = s.save("chain", in, false)
	c, _ := s.trigger("chain", nil)
	first, middle, last := awaitRun(t, s, a.ID), awaitRun(t, s, b.ID), awaitRun(t, s, c.ID)
	if first.Status != "success" || middle.Status != "cancelled" || last.Status != "success" || last.StartedAt.Before(*first.FinishedAt) {
		t.Fatalf("broken chain %+v %+v %+v", first, middle, last)
	}
	data, _ := os.ReadFile(s.logPath(b.ID))
	if strings.TrimSpace(string(data)) != "" {
		t.Fatal("cancelled queued script ran")
	}
}
