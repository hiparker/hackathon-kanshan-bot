// Package task hosts /api/tasks*. Handlers self-wire service.TaskService.
package task

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/errx"
)

// Handler hosts /api/tasks*.
type Handler struct {
	svc service.TaskService
}

// New builds an /api/tasks handler with its own TaskService.
func New() *Handler { return &Handler{svc: serviceimpl.NewTaskService()} }

// Routes mounts /api/tasks under an authenticated parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/", h.list)
	r.Post("/progress", h.progress)
}

type rewardView struct {
	Kind   string `json:"kind"`
	ItemID string `json:"item_id,omitempty"`
	Qty    int    `json:"qty,omitempty"`
}

type taskView struct {
	TaskID       string       `json:"task_id"`
	Type         string       `json:"type"`
	Name         string       `json:"name"`
	TargetCount  int          `json:"target_count"`
	DoneCount    int          `json:"done_count"`
	Rewards      []rewardView `json:"rewards"`
	TriggerEvent string       `json:"trigger_event,omitempty"`
}

type listResponse struct {
	Tasks []taskView `json:"tasks"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := session.UserID(r.Context())
	period := r.URL.Query().Get("period")
	rows, err := h.svc.List(r.Context(), userID, period)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	out := make([]taskView, 0, len(rows))
	for _, t := range rows {
		out = append(out, toTaskView(t))
	}
	httpx.WriteJSON(w, http.StatusOK, listResponse{Tasks: out})
}

type progressRequest struct {
	TaskID string `json:"task_id"`
	Delta  int    `json:"delta"`
}

type progressResponse struct {
	OK             bool         `json:"ok"`
	Task           taskView     `json:"task"`
	RewardsGranted []rewardView `json:"rewards_granted"`
	NewState       *stateView   `json:"new_state,omitempty"`
	ActionHint     string       `json:"action_hint,omitempty"`
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

func (h *Handler) progress(w http.ResponseWriter, r *http.Request) {
	var req progressRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	userID := session.UserID(r.Context())
	res, err := h.svc.Progress(r.Context(), userID, req.TaskID, req.Delta)
	if err != nil {
		errx.WriteServiceError(w, err, map[string]any{"task_id": req.TaskID})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, progressResponse{
		OK:             true,
		Task:           toTaskView(res.Task),
		RewardsGranted: toRewards(res.RewardsGranted),
		NewState:       toStateView(res.NewState),
		ActionHint:     res.ActionHint,
	})
}

func toTaskView(t service.TaskView) taskView {
	return taskView{
		TaskID:       t.TaskID,
		Type:         t.Type,
		Name:         t.Name,
		TargetCount:  t.TargetCount,
		DoneCount:    t.DoneCount,
		Rewards:      toRewards(t.Rewards),
		TriggerEvent: t.TriggerEvent,
	}
}

func toStateView(snap *service.PetSnapshot) *stateView {
	if snap == nil {
		return nil
	}
	return &stateView{
		Hunger:     snap.Hunger,
		Happiness:  snap.Happiness,
		Energy:     snap.Energy,
		Spirit:     snap.Spirit,
		Health:     snap.Health,
		Growth:     snap.Growth,
		Mood:       snap.Mood,
		Lifecycle:  snap.Lifecycle,
		LastTickAt: snap.LastTickAt,
	}
}

func toRewards(in []service.Reward) []rewardView {
	if in == nil {
		return nil
	}
	out := make([]rewardView, 0, len(in))
	for _, r := range in {
		out = append(out, rewardView{Kind: r.Kind, ItemID: r.ItemID, Qty: r.Qty})
	}
	return out
}
