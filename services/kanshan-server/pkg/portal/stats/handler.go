// Package stats hosts /api/stats/event. Handlers self-wire
// service.StatsService.
package stats

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/errx"
)

// Handler hosts /api/stats.
type Handler struct {
	svc service.StatsService
}

// New builds an /api/stats handler with its own StatsService.
func New() *Handler { return &Handler{svc: serviceimpl.NewStatsService()} }

// Routes mounts /api/stats under an authenticated parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/event", h.event)
}

type eventRequest struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
	TS      int64          `json:"ts"`
}

type eventResponse struct {
	OK bool `json:"ok"`
}

func (h *Handler) event(w http.ResponseWriter, r *http.Request) {
	var req eventRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	if err := h.svc.Event(r.Context(), userID, service.StatsEventInput{
		Type:    req.Type,
		Payload: req.Payload,
		TS:      req.TS,
	}); err != nil {
		errx.WriteServiceError(w, err, map[string]any{"type": req.Type})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, eventResponse{OK: true})
}
