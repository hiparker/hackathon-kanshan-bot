package impl

import (
	"context"
	"testing"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type fakeTaskDao struct {
	catalog map[string]dao.Task
	rows    map[string]dao.Task
	writes  []taskWrite
}

type taskWrite struct {
	taskID    string
	periodKey string
	doneCount int
}

func (d *fakeTaskDao) ListForUser(context.Context, string, string, string) ([]dao.Task, error) {
	return nil, nil
}

func (d *fakeTaskDao) GetForUser(_ context.Context, _ string, taskID, periodKey string) (dao.Task, error) {
	if periodKey == "" {
		row, ok := d.catalog[taskID]
		if !ok {
			return dao.Task{}, dao.ErrNotFound
		}
		return row, nil
	}
	key := taskID + "@" + periodKey
	row, ok := d.rows[key]
	if !ok {
		return dao.Task{}, dao.ErrNotFound
	}
	return row, nil
}

func (d *fakeTaskDao) UpsertProgress(_ context.Context, _ string, taskID, periodKey string, doneCount int, rewarded bool, doneAt *int64) error {
	if d.rows == nil {
		d.rows = map[string]dao.Task{}
	}
	base := d.catalog[taskID]
	base.DoneCount = doneCount
	base.Rewarded = rewarded
	base.DoneAt = doneAt
	d.rows[taskID+"@"+periodKey] = base
	d.writes = append(d.writes, taskWrite{taskID: taskID, periodKey: periodKey, doneCount: doneCount})
	return nil
}

type fakeTaskInventory struct {
	restocks []service.Reward
}

func (s *fakeTaskInventory) List(context.Context, string) ([]service.InventoryItem, error) {
	return nil, nil
}
func (s *fakeTaskInventory) Use(context.Context, string, string) (service.UseResult, error) {
	return service.UseResult{}, nil
}
func (s *fakeTaskInventory) Deduct(context.Context, string, string, int, string) (service.InventoryItem, error) {
	return service.InventoryItem{}, nil
}
func (s *fakeTaskInventory) Restock(_ context.Context, _ string, itemID string, qty int, _ string) (service.InventoryItem, error) {
	s.restocks = append(s.restocks, service.Reward{Kind: "item", ItemID: itemID, Qty: qty})
	return service.InventoryItem{ItemID: itemID, Qty: qty}, nil
}

type fakeTaskPetState struct {
	taskID string
}

func (s *fakeTaskPetState) Get(context.Context, string) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}
func (s *fakeTaskPetState) Tick(context.Context, string) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}
func (s *fakeTaskPetState) Interact(context.Context, string, string) (service.PetInteractionResult, error) {
	return service.PetInteractionResult{}, nil
}
func (s *fakeTaskPetState) ApplyTaskEffect(_ context.Context, _ string, taskID string) (service.PetInteractionResult, error) {
	s.taskID = taskID
	return service.PetInteractionResult{ActionHint: "exercise-temporary", NewState: service.PetSnapshot{Hunger: 48, Happiness: 55, Spirit: 60, Energy: 60, Health: 100, Lifecycle: "normal", Mood: "normal", LastTickAt: 10}}, nil
}
func (s *fakeTaskPetState) DebugSetState(context.Context, string, service.PetDebugStateInput) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}
func (s *fakeTaskPetState) CompleteItemUse(context.Context, string, *string, string, func() error) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}

func TestTaskProgressIgnoresDeltaAndUsesDailyPeriod(t *testing.T) {
	now := time.Date(2026, 5, 13, 16, 30, 0, 0, time.UTC)
	daoStore := &fakeTaskDao{catalog: map[string]dao.Task{
		"browse-5-posts": {TaskID: "browse-5-posts", Type: "daily", Name: "浏览 5 篇帖子", TargetCount: 5, RewardJSON: "[]"},
	}}
	svc := &taskService{dao: daoStore, inv: &fakeTaskInventory{}, petState: &fakeTaskPetState{}, random: func() float64 { return 1 }, now: func() time.Time { return now }}

	res, err := svc.Progress(context.Background(), "u1", "browse-5-posts", 99)
	if err != nil {
		t.Fatalf("Progress returned error: %v", err)
	}
	if res.Task.DoneCount != 1 {
		t.Fatalf("expected one-step progress, got %+v", res.Task)
	}
	if len(daoStore.writes) != 1 || daoStore.writes[0].periodKey != "2026-05-14" {
		t.Fatalf("expected Asia/Shanghai daily period key, got writes=%+v", daoStore.writes)
	}
}

func TestTaskProgressCapsAtTargetAndSkipsEffects(t *testing.T) {
	daoStore := &fakeTaskDao{
		catalog: map[string]dao.Task{"exercise-2-times": {TaskID: "exercise-2-times", Type: "daily", Name: "运动 2 次", TargetCount: 2, RewardJSON: "[]"}},
		rows:    map[string]dao.Task{"exercise-2-times@2026-05-13": {TaskID: "exercise-2-times", Type: "daily", Name: "运动 2 次", TargetCount: 2, DoneCount: 2, RewardJSON: "[]"}},
	}
	petState := &fakeTaskPetState{}
	svc := &taskService{dao: daoStore, inv: &fakeTaskInventory{}, petState: petState, random: func() float64 { return 0 }, rules: botconfig.Rules{TaskEffects: map[string]botconfig.TaskEffectRule{"exercise-2-times": {Effect: map[string]any{"happiness": 5}}}}, now: func() time.Time { return time.Date(2026, 5, 13, 0, 0, 0, 0, time.UTC) }}

	res, err := svc.Progress(context.Background(), "u1", "exercise-2-times", 1)
	if err != nil {
		t.Fatalf("Progress returned error: %v", err)
	}
	if res.Task.DoneCount != 2 || res.NewState != nil || petState.taskID != "" {
		t.Fatalf("expected capped progress without task effect, got res=%+v pet=%+v", res, petState)
	}
}

func TestTaskProgressRandomRewardRestocksUserInventory(t *testing.T) {
	daoStore := &fakeTaskDao{catalog: map[string]dao.Task{
		"comment-3-times": {TaskID: "comment-3-times", Type: "daily", Name: "评论 3 次", TargetCount: 3, RewardJSON: "[]"},
	}}
	inventory := &fakeTaskInventory{}
	svc := &taskService{
		dao: daoStore, inv: inventory, petState: &fakeTaskPetState{}, random: func() float64 { return 0.61 }, now: func() time.Time { return time.Date(2026, 5, 13, 0, 0, 0, 0, time.UTC) },
		rules: botconfig.Rules{TaskRewards: map[string][]botconfig.TaskRewardRule{"comment-3-times": {
			{ItemID: "yarn-ball", Qty: 1, Probability: 0.3},
			{ItemID: "cat-baton", Qty: 1, Probability: 0.3},
			{ItemID: "nutrition-can", Qty: 1, Probability: 0.3},
		}}},
	}

	res, err := svc.Progress(context.Background(), "u1", "comment-3-times", 1)
	if err != nil {
		t.Fatalf("Progress returned error: %v", err)
	}
	if len(res.RewardsGranted) != 1 || res.RewardsGranted[0].ItemID != "nutrition-can" {
		t.Fatalf("expected nutrition-can reward, got %+v", res.RewardsGranted)
	}
	if len(inventory.restocks) != 1 || inventory.restocks[0].ItemID != "nutrition-can" {
		t.Fatalf("expected inventory restock, got %+v", inventory.restocks)
	}
}

func TestTaskProgressExerciseReturnsTaskEffectState(t *testing.T) {
	daoStore := &fakeTaskDao{catalog: map[string]dao.Task{
		"exercise-2-times": {TaskID: "exercise-2-times", Type: "daily", Name: "运动 2 次", TargetCount: 2, RewardJSON: "[]"},
	}}
	petState := &fakeTaskPetState{}
	svc := &taskService{
		dao: daoStore, inv: &fakeTaskInventory{}, petState: petState, random: func() float64 { return 1 }, now: func() time.Time { return time.Date(2026, 5, 13, 0, 0, 0, 0, time.UTC) },
		rules: botconfig.Rules{TaskEffects: map[string]botconfig.TaskEffectRule{"exercise-2-times": {ActionHint: "exercise-temporary", Effect: map[string]any{"happiness": 5, "spirit": 10, "hunger": -2}}}},
	}

	res, err := svc.Progress(context.Background(), "u1", "exercise-2-times", 1)
	if err != nil {
		t.Fatalf("Progress returned error: %v", err)
	}
	if res.ActionHint != "exercise-temporary" || res.NewState == nil || res.NewState.Hunger != 48 || petState.taskID != "exercise-2-times" {
		t.Fatalf("expected exercise task effect result, got res=%+v pet=%+v", res, petState)
	}
}
