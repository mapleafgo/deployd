package backend

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type diagnosticCapture struct {
	mu sync.Mutex
	bytes.Buffer
}

func (c *diagnosticCapture) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Buffer.Write(p)
}
func (c *diagnosticCapture) text() string { c.mu.Lock(); defer c.mu.Unlock(); return c.Buffer.String() }
func captureDiagnostics(t *testing.T) *diagnosticCapture {
	t.Helper()
	capture := &diagnosticCapture{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(capture, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return capture
}
func TestExecutionDiagnosticsCorrelateCauseAndTimingWithoutSecrets(t *testing.T) {
	capture := captureDiagnostics(t)
	s := openTestService(t)
	in := definition(filepath.Join(t.TempDir(), "missing"), "printf command-secret")
	in.Env["PRIVATE"] = "environment-secret"
	task, err := s.save("diagnostic", in, true)
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.trigger("diagnostic", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, run.ID); got.Status != "failed" {
		t.Fatal(got)
	}
	text := capture.text()
	for _, required := range []string{run.ID, "process.start", "duration_ms=", "result=failed", "error="} {
		if !strings.Contains(text, required) {
			t.Errorf("missing %q in diagnostics: %s", required, text)
		}
	}
	for _, secret := range []string{"command-secret", "environment-secret", task.Token} {
		if strings.Contains(text, secret) {
			t.Errorf("secret leaked: %s", text)
		}
	}
}
func TestResultPersistenceDiagnosticsReportRetryFailureAndRecovery(t *testing.T) {
	capture := captureDiagnostics(t)
	s := openTestService(t)
	dir := t.TempDir()
	gate := filepath.Join(dir, "gate")
	in := definition(dir, fmt.Sprintf("while [ ! -f '%s' ]; do sleep .01; done", gate))
	_, err := s.save("diagnostic-storage", in, true)
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.trigger("diagnostic-storage", nil)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		current, _ := s.getRun(run.ID)
		if current.Status == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("run not started")
		}
		time.Sleep(time.Millisecond)
	}
	path := s.runPath(run.ID)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })
	if err := os.WriteFile(gate, nil, 0600); err != nil {
		t.Fatal(err)
	}
	awaitRun(t, s, run.ID)
	deadline = time.Now().Add(time.Second)
	for !strings.Contains(capture.text(), "result.retry") {
		if time.Now().After(deadline) {
			t.Fatalf("retry failure not diagnosed: %s", capture.text())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		remaining := len(s.unsavedResults)
		s.mu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("retry did not recover")
		}
		time.Sleep(10 * time.Millisecond)
	}
	text := capture.text()
	for _, required := range []string{run.ID, "result.persist", "result.retry", "recovered", "error=", "duration_ms="} {
		if !strings.Contains(text, required) {
			t.Errorf("missing %q in diagnostics: %s", required, text)
		}
	}
}
func TestExpectedCancellationIsNotFaultDiagnostic(t *testing.T) {
	capture := captureDiagnostics(t)
	s := openTestService(t)
	_, _ = s.save("cancel-diagnostic", definition(t.TempDir(), "sleep 30"), true)
	run, _ := s.trigger("cancel-diagnostic", nil)
	_ = s.cancel(run.ID)
	awaitRun(t, s, run.ID)
	if err := s.stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if text := capture.text(); strings.Contains(text, "level=ERROR") {
		t.Fatalf("normal cancellation logged as fault: %s", text)
	}
}
