package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openTestService(t *testing.T) *taskService {
	t.Helper()
	s := newTaskService(Config{DataDir: t.TempDir()})
	if err := s.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.stop(ctx); err != nil {
			t.Error(err)
		}
	})
	return s
}
func definition(dir, script string) TaskInput {
	return TaskInput{Workdir: dir, Timeout: "3s", SchedulingPolicy: "wait", Env: map[string]string{"ALLOWED": "default"}, Steps: []Step{{Name: "execute", Commands: []string{script}}}}
}
func awaitRun(t *testing.T, s *taskService, id string) Run {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		r, err := s.getRun(id)
		if err != nil {
			t.Fatal(err)
		}
		if terminal(r.Status) {
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("run did not finish")
	return Run{}
}
func TestTaskPersistenceAndExclusiveOwnership(t *testing.T) {
	s := openTestService(t)
	input := definition(t.TempDir(), "true")
	saved, err := s.save("demo", input, true)
	if err != nil {
		t.Fatal(err)
	}
	input.Description = "changed"
	updated, err := s.save("demo", input, false)
	if err != nil || updated.Token != saved.Token {
		t.Fatalf("token changed: %v", err)
	}
	for _, p := range []string{s.dir, filepath.Join(s.dir, "tasks"), filepath.Join(s.dir, "runs")} {
		info, err := os.Stat(p)
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatalf("private directory %s: %v", p, err)
		}
	}
	info, err := os.Stat(s.taskPath("demo"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private file: %v", err)
	}
	other := newTaskService(Config{DataDir: s.dir})
	if err := other.start(context.Background()); err == nil {
		t.Fatal("second owner acquired directory")
	}
	got, err := s.getTask("demo")
	if err != nil || got.Description != "changed" {
		t.Fatalf("get: %+v %v", got, err)
	}
	if err := s.remove("demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.getTask("demo"); !errors.Is(err, errMissing) {
		t.Fatal(err)
	}
}
func TestSnapshotsWhitelistAndFIFO(t *testing.T) {
	s := openTestService(t)
	dir := t.TempDir()
	_, err := s.save("queue", definition(dir, "sleep .15; printf '%s:%s' \"$ALLOWED\" \"${FORBIDDEN-unset}\""), true)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.trigger("queue", map[string]string{"ALLOWED": "first", "FORBIDDEN": "leak"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.trigger("queue", map[string]string{"ALLOWED": "second"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.save("queue", definition(dir, "printf changed"), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.remove("queue"); !errors.Is(err, errConflict) {
		t.Fatal("active task removed")
	}
	a, b := awaitRun(t, s, first.ID), awaitRun(t, s, second.ID)
	if a.Status != "success" || b.Status != "success" || b.StartedAt.Before(*a.FinishedAt) {
		t.Fatalf("FIFO %+v %+v", a, b)
	}
	data, err := os.ReadFile(s.logPath(second.ID))
	if err != nil || string(data) != "second:unset" {
		t.Fatalf("snapshot/whitelist: %q %v", data, err)
	}
}
func TestTerminateAndTimeout(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), "sleep 3")
	in.SchedulingPolicy = "terminate"
	_, _ = s.save("replace", in, true)
	first, err := s.trigger("replace", nil)
	if err != nil {
		t.Fatal(err)
	}
	in.Steps[0].Commands = []string{"printf replacement"}
	_, _ = s.save("replace", in, false)
	second, err := s.trigger("replace", nil)
	if err != nil {
		t.Fatal(err)
	}
	a, b := awaitRun(t, s, first.ID), awaitRun(t, s, second.ID)
	if a.Status != "cancelled" || b.Status != "success" || b.StartedAt.Before(*a.FinishedAt) {
		t.Fatalf("replacement overlaps %+v %+v", a, b)
	}
	in.Timeout = "1s"
	in.SchedulingPolicy = "wait"
	in.Steps[0].Commands = []string{"sleep 3"}
	_, _ = s.save("slow", in, true)
	r, _ := s.trigger("slow", nil)
	if got := awaitRun(t, s, r.ID); got.Status != "timeout" {
		t.Fatalf("timeout: %+v", got)
	}
}
func TestWebhookDeniedWithoutDisclosure(t *testing.T) {
	s := openTestService(t)
	task, _ := s.save("hook", definition(t.TempDir(), "true"), true)
	for _, name := range []string{"missing", "hook"} {
		if _, err := s.triggerHook(name, nil, "wrong"); !errors.Is(err, errHookDenied) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := s.triggerHook("hook", nil, task.Token); err != nil {
		t.Fatal(err)
	}
}
func TestParallelFailureDoesNotHideSiblingFailure(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), "sleep .05; exit 1")
	in.Parallel = true
	in.Steps = append(in.Steps, Step{Name: "success", Commands: []string{"printf sibling"}})
	_, _ = s.save("parallel", in, true)
	r, _ := s.trigger("parallel", nil)
	if got := awaitRun(t, s, r.ID); got.Status != "failed" {
		t.Fatal(got)
	}
	data, _ := os.ReadFile(s.logPath(r.ID))
	if !strings.Contains(string(data), "sibling") {
		t.Fatalf("sibling not joined: %q", data)
	}
}
