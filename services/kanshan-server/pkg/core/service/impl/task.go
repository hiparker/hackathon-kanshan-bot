package impl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type taskService struct {
	dao      dao.TaskDao
	inv      service.InventoryService
	petState service.PetStateService
	random   func() float64
	rules    botconfig.Rules
	now      func() time.Time
}

// NewTaskService returns a service.TaskService backed by the dao/impl
// singleton. The clock is fixed to time.Now; tests that need a frozen
// clock should construct taskService directly inside this package.
func NewTaskService() service.TaskService {
	return &taskService{
		dao:      daoimpl.NewTaskDao(),
		inv:      NewInventoryService(),
		petState: NewPetStateService(),
		random:   rand.Float64,
		rules:    botconfig.MustLoadRules(),
		now:      time.Now,
	}
}

func (s *taskService) List(ctx context.Context, userID, period string) ([]service.TaskView, error) {
	rows, err := s.dao.ListForUser(ctx, userID, period, s.periodKeyFor(period))
	if err != nil {
		return nil, service.ErrInternal
	}
	out := make([]service.TaskView, 0, len(rows))
	for _, r := range rows {
		v, err := toTaskView(r)
		if err != nil {
			return nil, service.ErrInternal
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *taskService) Progress(ctx context.Context, userID, taskID string, delta int) (service.ProgressResult, error) {
	if taskID == "" {
		return service.ProgressResult{}, service.ErrBadRequest
	}

	t, err := s.lookup(ctx, userID, taskID)
	if err != nil {
		return service.ProgressResult{}, err
	}

	periodKey := s.periodKeyFor(t.Type)
	progressed := t.DoneCount < t.TargetCount
	if t.DoneCount < t.TargetCount {
		t.DoneCount++
	}
	if t.DoneCount > t.TargetCount {
		t.DoneCount = t.TargetCount
	}

	rewardsAll, err := decodeRewards(t.RewardJSON)
	if err != nil {
		return service.ProgressResult{}, service.ErrInternal
	}

	var granted []service.Reward
	var doneAt *int64
	rewarded := t.Rewarded
	if t.DoneCount >= t.TargetCount && !rewarded {
		granted = rewardsAll
		rewarded = true
		now := s.now().Unix()
		doneAt = &now
	}

	if err := s.dao.UpsertProgress(ctx, userID, taskID, periodKey, t.DoneCount, rewarded, doneAt); err != nil {
		return service.ProgressResult{}, service.ErrInternal
	}

	if progressed {
		if reward, ok := s.pickTaskReward(taskID); ok {
			granted = append(granted, reward)
		}
	}

	if len(granted) > 0 {
		for _, rw := range granted {
			if rw.Kind == "item" && rw.ItemID != "" && rw.Qty > 0 {
				if _, err := s.inv.Restock(ctx, userID, rw.ItemID, rw.Qty, "task_reward:"+taskID); err != nil {
					return service.ProgressResult{}, err
				}
			}
		}
	}

	t.Rewarded = rewarded
	if doneAt != nil {
		t.DoneAt = doneAt
	}

	view, err := toTaskView(t)
	if err != nil {
		return service.ProgressResult{}, service.ErrInternal
	}

	var newState *service.PetSnapshot
	var actionHint string
	if progressed && s.hasTaskEffect(taskID) {
		res, err := s.petState.ApplyTaskEffect(ctx, userID, taskID)
		if err != nil {
			return service.ProgressResult{}, err
		}
		state := res.NewState
		newState = &state
		actionHint = res.ActionHint
	}

	return service.ProgressResult{Task: view, RewardsGranted: granted, NewState: newState, ActionHint: actionHint}, nil
}

func (s *taskService) pickTaskReward(taskID string) (service.Reward, bool) {
	rules := s.rulesForUse().TaskRewards[taskID]
	if len(rules) == 0 || s.random == nil {
		return service.Reward{}, false
	}
	roll := s.random()
	cumulative := 0.0
	for _, rule := range rules {
		if rule.ItemID == "" || rule.Qty <= 0 || rule.Probability <= 0 {
			continue
		}
		cumulative += rule.Probability
		if roll < cumulative {
			return service.Reward{Kind: "item", ItemID: rule.ItemID, Qty: rule.Qty}, true
		}
	}
	return service.Reward{}, false
}

func (s *taskService) hasTaskEffect(taskID string) bool {
	rule, ok := s.rulesForUse().TaskEffects[taskID]
	return ok && len(rule.Effect) > 0
}

func (s *taskService) rulesForUse() botconfig.Rules {
	if s.rules.Interactions == nil && s.rules.Items == nil && s.rules.TaskRewards == nil && s.rules.TaskEffects == nil {
		s.rules = botconfig.MustLoadRules()
	}
	return s.rules
}

// lookup resolves task metadata + per-period progress with two cheap reads:
// the first one (with empty period_key) fetches catalog metadata so we can
// derive the right period_key; the second one re-queries with that key to
// pick up real progress. The empty-period left-join produces done_count == 0
// because no user_tasks row carries period_key == "".
func (s *taskService) lookup(ctx context.Context, userID, taskID string) (dao.Task, error) {
	meta, err := s.dao.GetForUser(ctx, userID, taskID, "")
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return dao.Task{}, service.ErrTaskNotFound
		}
		return dao.Task{}, service.ErrInternal
	}
	periodKey := s.periodKeyFor(meta.Type)
	full, err := s.dao.GetForUser(ctx, userID, taskID, periodKey)
	if err != nil && !errors.Is(err, dao.ErrNotFound) {
		return dao.Task{}, service.ErrInternal
	}
	if errors.Is(err, dao.ErrNotFound) {
		meta.DoneCount = 0
		meta.Rewarded = false
		meta.DoneAt = nil
		return meta, nil
	}
	return full, nil
}

func (s *taskService) periodKeyFor(taskType string) string {
	switch taskType {
	case "daily":
		return s.now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	case "weekly":
		y, w := s.now().UTC().Add(8 * time.Hour).ISOWeek()
		return fmt.Sprintf("%04d-W%02d", y, w)
	default:
		return "lifetime"
	}
}

func decodeRewards(raw string) ([]service.Reward, error) {
	if raw == "" {
		return nil, nil
	}
	var arr []struct {
		Kind   string `json:"kind"`
		ItemID string `json:"item_id,omitempty"`
		Qty    int    `json:"qty,omitempty"`
	}
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return nil, err
	}
	out := make([]service.Reward, 0, len(arr))
	for _, r := range arr {
		out = append(out, service.Reward{Kind: r.Kind, ItemID: r.ItemID, Qty: r.Qty})
	}
	return out, nil
}

func toTaskView(r dao.Task) (service.TaskView, error) {
	rewards, err := decodeRewards(r.RewardJSON)
	if err != nil {
		return service.TaskView{}, err
	}
	return service.TaskView{
		TaskID:       r.TaskID,
		Type:         r.Type,
		Name:         r.Name,
		TargetCount:  r.TargetCount,
		DoneCount:    r.DoneCount,
		Rewards:      rewards,
		TriggerEvent: r.TriggerEvent,
	}, nil
}
