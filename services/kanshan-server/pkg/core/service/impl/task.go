package impl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type taskService struct {
	dao dao.TaskDao
	now func() time.Time
}

// NewTaskService returns a service.TaskService backed by the dao/impl
// singleton. The clock is fixed to time.Now; tests that need a frozen
// clock should construct taskService directly inside this package.
func NewTaskService() service.TaskService {
	return &taskService{dao: daoimpl.NewTaskDao(), now: time.Now}
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
	if delta == 0 {
		delta = 1
	}

	t, err := s.lookup(ctx, userID, taskID)
	if err != nil {
		return service.ProgressResult{}, err
	}

	periodKey := s.periodKeyFor(t.Type)
	t.DoneCount += delta
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
	t.Rewarded = rewarded
	if doneAt != nil {
		t.DoneAt = doneAt
	}

	view, err := toTaskView(t)
	if err != nil {
		return service.ProgressResult{}, service.ErrInternal
	}
	return service.ProgressResult{Task: view, RewardsGranted: granted}, nil
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
