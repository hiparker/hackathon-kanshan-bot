// Package auth hosts /api/auth/*. The handler self-wires its service
// dependency and never imports database/sql.
package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
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
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *Handler) zhihuCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "missing oauth code", nil)
		return
	}

	sess, err := h.svc.SignIn(r.Context(), code)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}

	writeAuthCallbackHTML(w, zhihuResponse{
		UserID:       sess.UserID,
		ZhihuUserID:  sess.ZhihuUserID,
		Name:         sess.Name,
		SessionToken: sess.SessionToken,
		ExpiresAt:    sess.ExpiresAt,
	})
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
	baseURL := envOr("ZHIHU_OAUTH_AUTHORIZE_URL", "https://www.zhihu.com/oauth/authorize")
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	values := parsed.Query()
	values.Set("response_type", "code")
	values.Set("client_id", os.Getenv("ZHIHU_OAUTH_CLIENT_ID"))
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

func writeAuthCallbackHTML(w http.ResponseWriter, sess zhihuResponse) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	escapedName := html.EscapeString(sess.Name)
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
  <p>可以关闭这个窗口，回到刘看山。</p>
</main>
<script>
const payload = %s;
try {
  window.opener && window.opener.postMessage({ type: 'kanshan:auth', session: payload }, '*');
} catch (_) {}
try {
  localStorage.setItem('kanshan.session', JSON.stringify(payload));
} catch (_) {}
setTimeout(() => window.close(), 800);
</script>`, escapedName, mustJSON(sess))
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
