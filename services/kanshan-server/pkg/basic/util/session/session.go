// Package session decodes the opaque session token from the X-Session-Token
// HTTP header and exposes a chi-compatible middleware that injects the user
// id into the request context. The token format is owned here and consumed
// by every authenticated handler in pkg/portal.
package session

import (
	"context"
	"net/http"
	"strings"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
)

type ctxKey string

const ctxUserID ctxKey = "user_id"

// Header is the HTTP header that carries the opaque session token.
// P0: token format is "s_<user_id>"; P1+ will switch to JWT.
const Header = "X-Session-Token"

// Required wraps a handler so it returns 401 unless a valid session is present.
func Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get(Header)
		userID, ok := decodeToken(token)
		if !ok {
			httpx.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid session", nil)
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserID, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserID returns the user_id injected by Required, or empty string if absent.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxUserID).(string)
	return v
}

// EncodeToken is the inverse of decodeToken. It is exported for handlers
// (e.g. login) that need to mint a new session token.
func EncodeToken(userID string) string { return "s_" + userID }

func decodeToken(token string) (string, bool) {
	const prefix = "s_"
	if !strings.HasPrefix(token, prefix) {
		return "", false
	}
	id := strings.TrimPrefix(token, prefix)
	if id == "" {
		return "", false
	}
	return id, true
}
