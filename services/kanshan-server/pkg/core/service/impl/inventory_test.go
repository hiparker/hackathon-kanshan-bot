package impl

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type fakeItemDao struct {
	item            dao.Item
	decrementAmount int
	decrementReason string
}

func (d *fakeItemDao) ListForUser(context.Context, string) ([]dao.Item, error) {
	return []dao.Item{d.item}, nil
}
func (d *fakeItemDao) GetForUser(context.Context, string, string) (dao.Item, error) {
	return d.item, nil
}
func (d *fakeItemDao) AdjustQty(context.Context, string, string, int, string) error { return nil }
func (d *fakeItemDao) DecrementQty(_ context.Context, _ string, _ string, amount int, reason string) error {
	d.decrementAmount = amount
	d.decrementReason = reason
	return nil
}

type fakeInventoryPetState struct {
	completeEffectJSON   string
	completePrecondition *string
}

func (s *fakeInventoryPetState) Get(context.Context, string) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}
func (s *fakeInventoryPetState) Tick(context.Context, string) (service.PetSnapshot, error) {
	return service.PetSnapshot{Lifecycle: "normal", Hunger: 50, Happiness: 50, Spirit: 50, Energy: 50}, nil
}
func (s *fakeInventoryPetState) Interact(context.Context, string, string) (service.PetInteractionResult, error) {
	return service.PetInteractionResult{}, nil
}
func (s *fakeInventoryPetState) ApplyTaskEffect(context.Context, string, string) (service.PetInteractionResult, error) {
	return service.PetInteractionResult{}, nil
}
func (s *fakeInventoryPetState) DebugSetState(context.Context, string, service.PetDebugStateInput) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, nil
}
func (s *fakeInventoryPetState) CompleteItemUse(_ context.Context, _ string, precondition *string, effectJSON string, decrement func() error) (service.PetSnapshot, error) {
	s.completePrecondition = precondition
	s.completeEffectJSON = effectJSON
	if err := decrement(); err != nil {
		return service.PetSnapshot{}, err
	}
	return service.PetSnapshot{Lifecycle: "normal", Hunger: 60, Happiness: 50, Spirit: 50, Energy: 50}, nil
}

func TestUseAppliesConfiguredItemEffectAndDeductsOneStock(t *testing.T) {
	itemDao := &fakeItemDao{item: dao.Item{ItemID: "fish-jerky", Qty: 3, EffectJSON: `{"hunger":999}`}}
	petState := &fakeInventoryPetState{}
	svc := &inventoryService{
		itemDao:  itemDao,
		petState: petState,
		rules: botconfig.Rules{Items: map[string]botconfig.ItemRule{
			"fish-jerky": {Effect: map[string]any{"hunger": 10}},
		}},
	}

	_, err := svc.Use(context.Background(), "u1", "fish-jerky")
	if err != nil {
		t.Fatalf("Use returned error: %v", err)
	}
	if itemDao.decrementAmount != 1 || itemDao.decrementReason != "use" {
		t.Fatalf("expected fixed stock decrement of 1/use, got amount=%d reason=%q", itemDao.decrementAmount, itemDao.decrementReason)
	}
	var effect map[string]int
	if err := json.Unmarshal([]byte(petState.completeEffectJSON), &effect); err != nil {
		t.Fatalf("effect json should be valid: %v", err)
	}
	if effect["hunger"] != 10 {
		t.Fatalf("expected configured hunger effect 10, got effect=%v", effect)
	}
}

func TestShouldDanceAfterUseUsesConfiguredThresholds(t *testing.T) {
	rule := botconfig.ItemActionRewardRule{
		HighHappinessThreshold:     85,
		HighHappinessProbability:   1,
		MediumHappinessThreshold:   65,
		MediumHappinessProbability: 0.50,
		ActionHint:                 "happy-temporary",
	}
	if !shouldDanceAfterUse(func() float64 { return 0.99 }, 90, rule) {
		t.Fatalf("expected happiness >85 to always dance")
	}
	if !shouldDanceAfterUse(func() float64 { return 0.49 }, 70, rule) {
		t.Fatalf("expected happiness >65 to dance below configured 50%% threshold")
	}
	if shouldDanceAfterUse(func() float64 { return 0.50 }, 70, rule) {
		t.Fatalf("expected happiness >65 to skip at configured threshold")
	}
	if shouldDanceAfterUse(func() float64 { return 0.49 }, 60, rule) {
		t.Fatalf("expected happiness <=65 to skip")
	}
}
