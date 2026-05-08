// Package auth hosts /api/auth/*. The handler self-wires its service
// dependency and never imports database/sql.
package auth

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
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
}

type zhihuRequest struct {
	Code string `json:"code"`
}

type zhihuResponse struct {
	UserID       string `json:"user_id"`
	SessionToken string `json:"session_token"`
	ExpiresAt    int64  `json:"expires_at"`
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
		SessionToken: sess.SessionToken,
		ExpiresAt:    sess.ExpiresAt,
	})
}
