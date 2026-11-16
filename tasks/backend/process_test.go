package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestShellExitCleansBackgroundGroupBeforeSuccess(t *testing.T) {
	s := openTestService(t)
	dir := t.TempDir()
	marker := filepath.Join(dir, "leaked")
	_, _ = s.save("background", definition(dir, fmt.Sprintf("(sleep .3; touch '%s') & printf done", marker)), true)
	r, _ := s.trigger("background", nil)
	got := awaitRun(t, s, r.ID)
	if got.Status != "success" {
		t.Fatalf("background shell exit: %+v", got)
	}
	time.Sleep(400 * time.Millisecond)
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("background process survived shell exit")
	}
}
func TestCancelKillsShellAndItsChild(t *testing.T) {
	s := openTestService(t)
	dir := t.TempDir()
	pidPath := filepath.Join(dir, "child.pid")
	_, _ = s.save("group", definition(dir, fmt.Sprintf("sleep 30 & echo $! > '%s'; wait", pidPath)), true)
	r, _ := s.trigger("group", nil)
	deadline := time.Now().Add(time.Second)
	var pid int
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(pidPath)
		pid, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		if pid > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("child did not start")
	}
	if err := s.cancel(r.ID); err != nil {
		t.Fatal(err)
	}
	if got := awaitRun(t, s, r.ID); got.Status != "cancelled" {
		t.Fatal(got)
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err == nil {
		fields := strings.Fields(string(data))
		if len(fields) < 3 || fields[2] != "Z" {
			t.Fatalf("child still running: %s", data)
		}
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
func TestShutdownJoinsExecutionsAndReleasesDirectory(t *testing.T) {
	s := openTestService(t)
	_, _ = s.save("closing", definition(t.TempDir(), "sleep 30"), true)
	r, _ := s.trigger("closing", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.stop(ctx); err != nil {
		t.Fatal(err)
	}
	if got, err := s.getRun(r.ID); err != nil || got.Status != "cancelled" {
		t.Fatalf("shutdown %+v %v", got, err)
	}
	if _, err := s.trigger("closing", nil); err == nil {
		t.Fatal("accepted after shutdown")
	}
	other := newTaskService(Config{DataDir: s.dir})
	if err := other.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := other.stop(ctx); err != nil {
		t.Fatal(err)
	}
}
