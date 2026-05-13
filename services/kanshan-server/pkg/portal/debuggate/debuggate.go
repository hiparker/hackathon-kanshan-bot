// Package debuggate controls routes that mutate data for local debugging.
package debuggate

import (
	"net/http"
	"os"
	"strings"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
)

const envKey = "KANSHAN_DEBUG_MODE"

// Enabled reports whether database-mutating debug APIs are allowed.
func Enabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(envKey))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// Require writes a forbidden response when debug APIs are disabled.
func Require(w http.ResponseWriter) bool {
	if Enabled() {
		return true
	}

	httpx.WriteError(w, http.StatusForbidden, "DEBUG_MODE_DISABLED", "debug APIs are disabled", map[string]any{
		"env": envKey,
	})
	return false
}
