package debuggate

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequireRejectsWhenDebugModeDisabled(t *testing.T) {
	t.Setenv("KANSHAN_DEBUG_MODE", "false")

	recorder := httptest.NewRecorder()
	if Require(recorder) {
		t.Fatal("Require returned true when debug mode was disabled")
	}

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if !strings.Contains(recorder.Body.String(), "DEBUG_MODE_DISABLED") {
		t.Fatalf("body = %s, want DEBUG_MODE_DISABLED", recorder.Body.String())
	}
}

func TestRequireAllowsTruthyDebugMode(t *testing.T) {
	for _, value := range []string{"1", "true", "yes", "on"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("KANSHAN_DEBUG_MODE", value)

			recorder := httptest.NewRecorder()
			if !Require(recorder) {
				t.Fatalf("Require returned false for %q", value)
			}
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want default %d", recorder.Code, http.StatusOK)
			}
		})
	}
}
