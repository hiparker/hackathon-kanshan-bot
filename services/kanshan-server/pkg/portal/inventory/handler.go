// Package inventory hosts /api/inventory*. Handlers self-wire
// service.InventoryService.
package inventory

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

// Handler hosts /api/inventory.
type Handler struct {
	svc service.InventoryService
}

// New builds an /api/inventory handler with its own InventoryService.
func New() *Handler { return &Handler{svc: serviceimpl.NewInventoryService()} }

// Routes mounts /api/inventory under an authenticated parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/", h.list)
	r.Post("/use", h.use)
	r.Post("/deduct", h.deduct)
	r.Post("/restock", h.restock)
}

type itemView struct {
	ItemID               string  `json:"item_id"`
	Name                 string  `json:"name"`
	Qty                  int     `json:"qty"`
	Rarity               string  `json:"rarity"`
	CooldownRemainingSec int     `json:"cooldown_remaining_sec"`
	ExpireAt             *int64  `json:"expire_at"`
	ActionHint           string  `json:"action_hint,omitempty"`
	Precondition         *string `json:"precondition,omitempty"`
}

type listResponse struct {
	Items []itemView `json:"items"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := session.UserID(r.Context())
	items, err := h.svc.List(r.Context(), userID)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	out := make([]itemView, 0, len(items))
	for _, it := range items {
		out = append(out, toView(it))
	}
	httpx.WriteJSON(w, http.StatusOK, listResponse{Items: out})
}

type useRequest struct {
	ItemID string `json:"item_id"`
}

type useResponse struct {
	OK         bool      `json:"ok"`
	NewState   stateView `json:"new_state"`
	ActionHint string    `json:"action_hint"`
	Message    string    `json:"message,omitempty"`
}

type stateView struct {
	Hunger     int    `json:"hunger"`
	Happiness  int    `json:"happiness"`
	Energy     int    `json:"energy"`
	Spirit     int    `json:"spirit"`
	Health     int    `json:"health"`
	Growth     int    `json:"growth"`
	Mood       string `json:"mood"`
	Lifecycle  string `json:"lifecycle"`
	LastTickAt int64  `json:"last_tick_at"`
}

type qtyRequest struct {
	ItemID string `json:"item_id"`
	Qty    int    `json:"qty"`
	Reason string `json:"reason,omitempty"`
}

type itemOKResponse struct {
	OK   bool     `json:"ok"`
	Item itemView `json:"item"`
}

func (h *Handler) deduct(w http.ResponseWriter, r *http.Request) {
	var req qtyRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	it, err := h.svc.Deduct(r.Context(), userID, req.ItemID, req.Qty, req.Reason)
	if err != nil {
		errx.WriteServiceError(w, err, map[string]any{"item_id": req.ItemID, "qty": req.Qty})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, itemOKResponse{OK: true, Item: toView(it)})
}

func (h *Handler) restock(w http.ResponseWriter, r *http.Request) {
	if !debuggate.Require(w) {
		return
	}

	var req qtyRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	it, err := h.svc.Restock(r.Context(), userID, req.ItemID, req.Qty, req.Reason)
	if err != nil {
		errx.WriteServiceError(w, err, map[string]any{"item_id": req.ItemID, "qty": req.Qty})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, itemOKResponse{OK: true, Item: toView(it)})
}

func (h *Handler) use(w http.ResponseWriter, r *http.Request) {
	var req useRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	res, err := h.svc.Use(r.Context(), userID, req.ItemID)
	if err != nil {
		errx.WriteServiceError(w, err, map[string]any{"item_id": req.ItemID})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, useResponse{
		OK: true,
		NewState: stateView{
			Hunger:     res.NewState.Hunger,
			Happiness:  res.NewState.Happiness,
			Energy:     res.NewState.Energy,
			Spirit:     res.NewState.Spirit,
			Health:     res.NewState.Health,
			Growth:     res.NewState.Growth,
			Mood:       res.NewState.Mood,
			Lifecycle:  res.NewState.Lifecycle,
			LastTickAt: res.NewState.LastTickAt,
		},
		ActionHint: res.ActionHint,
		Message:    res.Message,
	})
}

func toView(it service.InventoryItem) itemView {
	return itemView{
		ItemID:               it.ItemID,
		Name:                 it.Name,
		Qty:                  it.Qty,
		Rarity:               it.Rarity,
		CooldownRemainingSec: it.CooldownRemainingSec,
		ExpireAt:             it.ExpireAt,
		ActionHint:           it.ActionHint,
		Precondition:         it.Precondition,
	}
}
