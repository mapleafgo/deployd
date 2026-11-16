package backend

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
)

func TestHTTPAdminBoundaryAndWebhookCompatibility(t *testing.T) {
	s := openTestService(t)
	_, api := humatest.New(t)
	registerTasks(api, s, nil)
	denied := api.Get("/api/tasks")
	if denied.Code != 401 {
		t.Fatalf("anonymous: %d %s", denied.Code, denied.Body)
	}
	task, _ := s.save("webhook", definition(t.TempDir(), "printf hook"), true)
	for _, path := range []string{"/api/hooks/webhook", "/hook/webhook"} {
		bad := api.Post(path + "?token=wrong")
		if bad.Code != 401 || strings.Contains(bad.Body.String(), task.Token) {
			t.Fatalf("denied: %d %s", bad.Code, bad.Body)
		}
		good := api.Post(path, "X-Hook-Token: "+task.Token)
		if good.Code != 202 {
			t.Fatalf("accepted: %d %s", good.Code, good.Body)
		}
		var run Run
		if err := json.Unmarshal(good.Body.Bytes(), &run); err != nil {
			t.Fatal(err)
		}
		if got := awaitRun(t, s, run.ID); got.Status != "success" {
			t.Fatal(got)
		}
	}
	response := api.Post("/api/hooks/missing?token=wrong", "Accept-Language: en")
	if response.Code != 401 || !strings.Contains(response.Body.String(), "Webhook authentication failed") {
		t.Fatalf("safe translated error: %d %s", response.Code, response.Body)
	}
	for _, id := range []string{"list-tasks", "create-task", "update-task", "get-task", "delete-task", "trigger-task", "list-runs", "get-run", "cancel-run", "stream-run-log", "get-hook", "post-hook", "get-legacy-hook", "post-legacy-hook"} {
		found := false
		for _, path := range api.OpenAPI().Paths {
			for _, op := range []*huma.Operation{path.Get, path.Post, path.Put, path.Delete} {
				if op != nil && op.OperationID == id {
					found = true
				}
			}
		}
		if !found {
			t.Errorf("missing operation %s", id)
		}
	}
}
