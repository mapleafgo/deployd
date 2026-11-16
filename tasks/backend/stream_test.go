package backend

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2/humatest"
	auth "red-berry-kit/auth/backend"
)

func TestSSEByteOffsetsAndLastEventID(t *testing.T) {
	s := openTestService(t)
	_, _ = s.save("binary", definition(t.TempDir(), "printf '\\377\\000abc'"), true)
	r, _ := s.trigger("binary", nil)
	awaitRun(t, s, r.ID)
	_, api := humatest.New(t)
	registerLogStream(api, s, nil)
	response := api.Get("/api/runs/"+r.ID+"/events?offset=0", "Last-Event-ID: 1")
	if response.Code != 200 {
		t.Fatalf("%d %s", response.Code, response.Body)
	}
	var data []byte
	for _, line := range strings.Split(response.Body.String(), "\n") {
		if strings.HasPrefix(line, "data: ") {
			var event logEvent
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) == nil && event.Data != "" {
				chunk, err := base64.StdEncoding.DecodeString(event.Data)
				if err != nil {
					t.Fatal(err)
				}
				data = append(data, chunk...)
				if event.Offset != 5 {
					t.Fatalf("byte offset %d", event.Offset)
				}
			}
		}
	}
	if !bytes.Equal(data, []byte{0, 'a', 'b', 'c'}) {
		t.Fatalf("invalid continuation %v stream=%s", data, response.Body)
	}
	if bad := api.Get("/api/runs/" + r.ID + "/events?offset=6"); bad.Code != 422 {
		t.Fatalf("past end allowed %d", bad.Code)
	}
	if bad := api.Get("/api/runs/"+r.ID+"/events", "Last-Event-ID: -1"); bad.Code != 422 {
		t.Fatalf("negative allowed %d", bad.Code)
	}
}

type revokingAuthenticator struct{ calls atomic.Int32 }

func (a *revokingAuthenticator) Authenticate(context.Context, string) (auth.Principal, error) {
	a.calls.Add(1)
	return auth.Principal{}, auth.ErrDenied
}
func TestSSERechecksAuthenticationAtFifteenSeconds(t *testing.T) {
	if testing.Short() {
		t.Skip("真实15秒鉴权边界")
	}
	s := openTestService(t)
	in := definition(t.TempDir(), "sleep 30")
	in.Timeout = "40s"
	_, _ = s.save("long-stream", in, true)
	r, _ := s.trigger("long-stream", nil)
	_, api := humatest.New(t)
	authenticator := &revokingAuthenticator{}
	registerLogStream(api, s, authenticator)
	server := httptest.NewServer(api.Adapter())
	defer server.Close()
	begin := time.Now()
	response, err := http.Get(server.URL + "/api/runs/" + r.ID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var events bytes.Buffer
	_, err = io.Copy(&events, response.Body)
	elapsed := time.Since(begin)
	if err != nil {
		t.Fatal(err)
	}
	if authenticator.calls.Load() != 1 || elapsed < 15*time.Second || elapsed > 18*time.Second {
		t.Fatalf("auth not bounded: calls=%d elapsed=%v", authenticator.calls.Load(), elapsed)
	}
	if !strings.Contains(events.String(), `"code":"loginRequired"`) {
		t.Fatalf("revocation missing safe error event: %s", events.String())
	}
	_ = s.cancel(r.ID)
}
func TestSSEDisconnectDoesNotCancelExecution(t *testing.T) {
	s := openTestService(t)
	gate := t.TempDir() + "/finished"
	_, _ = s.save("disconnect", definition(t.TempDir(), "printf abc; sleep .2; touch "+gate), true)
	r, _ := s.trigger("disconnect", nil)
	_, api := humatest.New(t)
	registerLogStream(api, s, nil)
	server := httptest.NewServer(api.Adapter())
	defer server.Close()
	response, err := http.Get(server.URL + "/api/runs/" + r.ID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(response.Body)
	_, _ = reader.ReadString('\n')
	_ = response.Body.Close()
	if got := awaitRun(t, s, r.ID); got.Status != "success" {
		t.Fatal(got)
	}
	if _, err := os.Stat(gate); err != nil {
		t.Fatal(err)
	}
}
func TestSSEResumesAcrossChunkBoundaries(t *testing.T) {
	s := openTestService(t)
	_, _ = s.save("chunks", definition(t.TempDir(), "head -c 40000 /dev/zero"), true)
	r, _ := s.trigger("chunks", nil)
	awaitRun(t, s, r.ID)
	_, api := humatest.New(t)
	registerLogStream(api, s, nil)
	response := api.Get("/api/runs/" + r.ID + "/events?offset=17000")
	last := int64(17000)
	total := 0
	for _, line := range strings.Split(response.Body.String(), "\n") {
		if strings.HasPrefix(line, "id: ") {
			offset, err := strconv.ParseInt(strings.TrimPrefix(line, "id: "), 10, 64)
			if err != nil || offset <= last {
				t.Fatalf("non-monotonic id %q", line)
			}
			last = offset
		}
		if strings.HasPrefix(line, "data: ") {
			var event logEvent
			_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event)
			if event.Data != "" {
				data, err := base64.StdEncoding.DecodeString(event.Data)
				if err != nil {
					t.Fatal(err)
				}
				total += len(data)
			}
		}
	}
	if total != 23000 || last != 40000 {
		t.Fatalf("chunk loss total=%d offset=%d stream=%s", total, last, response.Body)
	}
}
