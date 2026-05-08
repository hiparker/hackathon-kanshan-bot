// Package state hosts /api/pet/state*. Handlers self-wire
// service.PetStateService.
package state

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/errx"
)

// Handler hosts /api/pet/state*.
type Handler struct {
	svc service.PetStateService
}

// New builds an /api/pet handler with its own PetStateService.
func New() *Handler { return &Handler{svc: serviceimpl.NewPetStateService()} }

// Routes mounts /api/pet under an authenticated parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/state", h.get)
	r.Post("/state/tick", h.tick)
}

type stateResponse struct {
	UserID     string `json:"user_id"`
	Hunger     int    `json:"hunger"`
	Happiness  int    `json:"happiness"`
	Energy     int    `json:"energy"`
	Health     int    `json:"health"`
	Growth     int    `json:"growth"`
	Mood       string `json:"mood"`
	Lifecycle  string `json:"lifecycle"`
	LastTickAt int64  `json:"last_tick_at"`
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID := session.UserID(r.Context())
	pet, err := h.svc.Get(r.Context(), userID)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toResponse(pet))
}

func (h *Handler) tick(w http.ResponseWriter, r *http.Request) {
	userID := session.UserID(r.Context())
	pet, err := h.svc.Tick(r.Context(), userID)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toResponse(pet))
}

func toResponse(pet service.PetSnapshot) stateResponse {
	return stateResponse{
		UserID:     pet.UserID,
		Hunger:     pet.Hunger,
		Happiness:  pet.Happiness,
		Energy:     pet.Energy,
		Health:     pet.Health,
		Growth:     pet.Growth,
		Mood:       pet.Mood,
		Lifecycle:  pet.Lifecycle,
		LastTickAt: pet.LastTickAt,
	}
}
