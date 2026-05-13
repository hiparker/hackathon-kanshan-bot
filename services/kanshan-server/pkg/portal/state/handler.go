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
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/debuggate"
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
	r.Post("/interact", h.interact)
	r.Post("/debug/state", h.debugSetState)
}

type stateResponse struct {
	UserID     string `json:"user_id"`
	Hunger     int    `json:"hunger"`
	Happiness  int    `json:"happiness"`
	Energy     int    `json:"energy"`
	Spirit     int    `json:"spirit"`
	Health     int    `json:"health"`
	Growth     int    `json:"growth"`
	Mood       string `json:"mood"`
	Lifecycle  string `json:"lifecycle"`
	LastTickAt int64  `json:"last_tick_at"`
	ActionHint string `json:"action_hint,omitempty"`
	Message    string `json:"message,omitempty"`
}

type interactRequest struct {
	Action string `json:"action"`
}

type interactResponse struct {
	OK         bool          `json:"ok"`
	NewState   stateResponse `json:"new_state"`
	ActionHint string        `json:"action_hint,omitempty"`
	Message    string        `json:"message,omitempty"`
}

type debugStateRequest struct {
	Hunger      *int   `json:"hunger,omitempty"`
	Happiness   *int   `json:"happiness,omitempty"`
	Spirit      *int   `json:"spirit,omitempty"`
	Health      *int   `json:"health,omitempty"`
	Lifecycle   string `json:"lifecycle,omitempty"`
	SickDaysAgo *int   `json:"sick_days_ago,omitempty"`
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

func (h *Handler) interact(w http.ResponseWriter, r *http.Request) {
	var req interactRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	res, err := h.svc.Interact(r.Context(), userID, req.Action)
	if err != nil {
		if err == service.ErrPetActionNotAllowed {
			httpx.WriteJSON(w, http.StatusConflict, interactResponse{
				OK:         false,
				NewState:   toResponse(res.NewState),
				ActionHint: res.ActionHint,
				Message:    res.Message,
			})
			return
		}
		errx.WriteServiceError(w, err, map[string]any{"action": req.Action})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, interactResponse{
		OK:         true,
		NewState:   toResponse(res.NewState),
		ActionHint: res.ActionHint,
		Message:    res.Message,
	})
}

func (h *Handler) debugSetState(w http.ResponseWriter, r *http.Request) {
	if !debuggate.Require(w) {
		return
	}

	var req debugStateRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	pet, err := h.svc.DebugSetState(r.Context(), userID, service.PetDebugStateInput{
		Hunger:      req.Hunger,
		Happiness:   req.Happiness,
		Spirit:      req.Spirit,
		Health:      req.Health,
		Lifecycle:   req.Lifecycle,
		SickDaysAgo: req.SickDaysAgo,
	})
	if err != nil {
		errx.WriteServiceError(w, err, map[string]any{"lifecycle": req.Lifecycle})
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
		Spirit:     pet.Spirit,
		Health:     pet.Health,
		Growth:     pet.Growth,
		Mood:       pet.Mood,
		Lifecycle:  pet.Lifecycle,
		LastTickAt: pet.LastTickAt,
		ActionHint: pet.ActionHint,
		Message:    pet.Message,
	}
}
