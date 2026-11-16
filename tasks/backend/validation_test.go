package backend

import (
	"errors"
	"strings"
	"testing"
)

func TestUnicodeTextLengthsMatchPublicSchema(t *testing.T) {
	s := openTestService(t)
	in := definition(t.TempDir(), "true")
	in.Description = strings.Repeat("部", 500)
	in.Steps[0].Name = strings.Repeat("署", 100)
	if _, err := s.save("unicode-boundary", in, true); err != nil {
		t.Fatalf("schema-valid Chinese text rejected: %v", err)
	}
	tooLong := clone(in)
	tooLong.Description += "署"
	if _, err := s.save("description-too-long", tooLong, true); !errors.Is(err, errInvalid) {
		t.Fatalf("description above 500 characters accepted: %v", err)
	}
	tooLong = clone(in)
	tooLong.Steps[0].Name += "署"
	if _, err := s.save("step-too-long", tooLong, true); !errors.Is(err, errInvalid) {
		t.Fatalf("step name above 100 characters accepted: %v", err)
	}
}
