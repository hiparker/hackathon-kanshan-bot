// Package auth hosts /api/auth/*. The handler self-wires its service
// dependency and never imports database/sql.
package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/errx"
)

// Handler hosts /api/auth.
type Handler struct {
	svc service.AuthService
}

// New builds an /api/auth handler. It pulls a fresh AuthService from the
// service-impl package; the dao/impl singletons must already be Init'd.
func New() *Handler { return &Handler{svc: serviceimpl.NewAuthService()} }

// Routes mounts /api/auth under the parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/zhihu", h.zhihu)
	r.Get("/zhihu/login", h.zhihuLogin)
	r.Get("/zhihu/callback", h.zhihuCallback)
	r.With(session.Required).Get("/me", h.me)
}

type zhihuRequest struct {
	Code string `json:"code"`
}

type zhihuResponse struct {
	UserID       string `json:"user_id"`
	ZhihuUserID  string `json:"zhihu_user_id"`
	Name         string `json:"name"`
	SessionToken string `json:"session_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

type meResponse struct {
	UserID      string `json:"user_id"`
	ZhihuUserID string `json:"zhihu_user_id"`
	Name        string `json:"name"`
}

func (h *Handler) zhihu(w http.ResponseWriter, r *http.Request) {
	var req zhihuRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	sess, err := h.svc.SignIn(r.Context(), req.Code)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, zhihuResponse{
		UserID:       sess.UserID,
		ZhihuUserID:  sess.ZhihuUserID,
		Name:         sess.Name,
		SessionToken: sess.SessionToken,
		ExpiresAt:    sess.ExpiresAt,
	})
}

func (h *Handler) zhihuLogin(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("dev_code"))
	if code != "" || !oauthLoginConfigured() {
		if code == "" {
			code = "local-dev"
		}
		callback := "/api/auth/zhihu/callback?code=" + url.QueryEscape(code)
		if returnTo := strings.TrimSpace(r.URL.Query().Get("return_to")); returnTo != "" {
			callback += "&return_to=" + url.QueryEscape(returnTo)
		}
		http.Redirect(w, r, callback, http.StatusFound)
		return
	}

	authURL, err := buildAuthorizeURL(r.URL.Query().Get("return_to"))
	if err != nil {
		errx.WriteServiceError(w, service.ErrInternal, nil)
		return
	}
	if returnTo := strings.TrimSpace(r.URL.Query().Get("return_to")); returnTo != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "kanshan_return_to",
			Value:    url.QueryEscape(returnTo),
			Path:     "/api/auth/zhihu",
			MaxAge:   600,
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *Handler) zhihuCallback(w http.ResponseWriter, r *http.Request) {
	slog.Info("zhihu oauth callback received", "query", r.URL.RawQuery)

	code := firstNonEmpty(
		r.URL.Query().Get("code"),
		r.URL.Query().Get("authorization_code"),
		r.URL.Query().Get("auth_code"),
	)
	if code == "" {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "missing oauth code", map[string]any{"query": r.URL.RawQuery})
		return
	}

	sess, err := h.svc.SignIn(r.Context(), code)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}

	returnTo := strings.TrimSpace(r.URL.Query().Get("return_to"))
	if returnTo == "" {
		returnTo = decodeOAuthState(r.URL.Query().Get("state"))
	}
	if returnTo == "" {
		if cookie, err := r.Cookie("kanshan_return_to"); err == nil {
			if decoded, err := url.QueryUnescape(cookie.Value); err == nil {
				returnTo = decoded
			}
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "kanshan_return_to", Value: "", Path: "/api/auth/zhihu", MaxAge: -1, HttpOnly: true})

	response := zhihuResponse{
		UserID:       sess.UserID,
		ZhihuUserID:  sess.ZhihuUserID,
		Name:         sess.Name,
		SessionToken: sess.SessionToken,
		ExpiresAt:    sess.ExpiresAt,
	}

	writeAuthCallbackHTML(w, response, returnTo)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, err := h.svc.CurrentUser(r.Context(), session.UserID(r.Context()))
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, meResponse{
		UserID:      user.UserID,
		ZhihuUserID: user.ZhihuUserID,
		Name:        user.Name,
	})
}

func oauthLoginConfigured() bool {
	return os.Getenv("ZHIHU_OAUTH_CLIENT_ID") != "" &&
		os.Getenv("ZHIHU_OAUTH_REDIRECT_URI") != "" &&
		envOr("ZHIHU_OAUTH_AUTHORIZE_URL", "https://www.zhihu.com/oauth/authorize") != ""
}

func buildAuthorizeURL(returnTo string) (string, error) {
	baseURL := envOr("ZHIHU_OAUTH_AUTHORIZE_URL", "https://openapi.zhihu.com/authorize")
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	values := parsed.Query()
	values.Set("response_type", "code")
	values.Set("app_id", os.Getenv("ZHIHU_OAUTH_CLIENT_ID"))
	values.Set("redirect_uri", os.Getenv("ZHIHU_OAUTH_REDIRECT_URI"))
	if scope := os.Getenv("ZHIHU_OAUTH_SCOPE"); scope != "" {
		values.Set("scope", scope)
	}
	if returnTo != "" {
		values.Set("state", base64.RawURLEncoding.EncodeToString([]byte(returnTo)))
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func decodeOAuthState(state string) string {
	if state == "" {
		return ""
	}
	data, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return ""
	}
	return string(data)
}

func isDesktopAuthReturnTo(returnTo string) bool {
	parsed, err := url.Parse(returnTo)
	return err == nil && parsed.Scheme == "kanshan" && parsed.Host == "auth"
}

func writeAuthCallbackHTML(w http.ResponseWriter, sess zhihuResponse, returnTo string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	escapedName := html.EscapeString(sess.Name)
	returnToJSON := "null"
	if strings.TrimSpace(returnTo) != "" {
		returnToJSON = mustJSON(returnTo)
	}
	isDesktopJSON := "false"
	if isDesktopAuthReturnTo(returnTo) {
		isDesktopJSON = "true"
	}
	fmt.Fprintf(w, `<!doctype html>
<meta charset="utf-8">
<title>刘看山登录成功</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f2e8;color:#17202a}
main{padding:28px;border:2px solid #17202a;border-radius:24px;background:#fffaf0;box-shadow:6px 6px 0 #17202a;text-align:center}
</style>
<main>
  <h1>登录成功</h1>
  <p>%s 的刘看山已准备好。</p>
  <p id="hint">正在返回刘看山。</p>
</main>
<script>
const payload = %s;
const returnTo = %s;
const isDesktop = %s;
try {
  window.opener && window.opener.postMessage({ type: 'kanshan:auth', session: payload }, '*');
} catch (_) {}
try {
  localStorage.setItem('kanshan.session', JSON.stringify(payload));
} catch (_) {}
if (isDesktop) {
  document.getElementById('hint').textContent = '请回到刘看山应用，登录状态会自动同步。';
  const url = new URL(returnTo);
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  url.searchParams.set('session', encoded);
  window.location.replace(url.toString());
} else if (returnTo) {
  const url = new URL(returnTo, window.location.origin);
  url.searchParams.set('kanshan_auth', btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  window.location.replace(url.toString());
} else {
  setTimeout(() => window.close(), 800);
}
</script>`, escapedName, mustJSON(sess), returnToJSON, isDesktopJSON)
}

func mustJSON(v any) string {
	bytes, _ := json.Marshal(v)
	return string(bytes)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
