package impl

import (
	"context"
	"testing"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type fakePetStateDao struct {
	row dao.PetState
}

func (d *fakePetStateDao) Get(context.Context, string) (dao.PetState, error) {
	return d.row, nil
}

func (d *fakePetStateDao) Save(_ context.Context, p dao.PetState) error {
	d.row = p
	return nil
}

func TestInteractChatConsumesSpirit(t *testing.T) {
	now := time.Now().Unix()
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     100,
		Happiness:  100,
		Energy:     10,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: now,
	}}
	svc := &petStateService{dao: store, random: func() float64 { return 1 }}

	res, err := svc.Interact(context.Background(), "u1", "chat")
	if err != nil {
		t.Fatalf("Interact returned error: %v", err)
	}
	if res.NewState.Spirit != 8 || store.row.Energy != 8 {
		t.Fatalf("expected chat to consume 2 spirit, got result=%+v stored=%+v", res.NewState, store.row)
	}
}

func TestInteractChatBlockedWhenSpiritInsufficient(t *testing.T) {
	now := time.Now().Unix()
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     100,
		Happiness:  100,
		Energy:     1,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: now,
	}}
	svc := &petStateService{dao: store, random: func() float64 { return 1 }}

	res, err := svc.Interact(context.Background(), "u1", "chat")
	if err != service.ErrPetActionNotAllowed {
		t.Fatalf("expected ErrPetActionNotAllowed, got %v", err)
	}
	if store.row.Energy != 1 || res.NewState.Spirit != 1 {
		t.Fatalf("blocked chat should not consume spirit, got result=%+v stored=%+v", res.NewState, store.row)
	}
	if res.Message == "" {
		t.Fatalf("expected blocked chat message")
	}
}

func TestInteractPatBlockedWhenHungry(t *testing.T) {
	now := time.Now().Unix()
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     40,
		Happiness:  100,
		Energy:     10,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "hungry",
		LastTickAt: now,
	}}
	svc := &petStateService{dao: store, random: func() float64 { return 0 }}

	res, err := svc.Interact(context.Background(), "u1", "pat")
	if err != service.ErrPetActionNotAllowed {
		t.Fatalf("expected ErrPetActionNotAllowed, got %v", err)
	}
	if res.Message == "" {
		t.Fatalf("expected blocked message")
	}
	if store.row.Happiness != 100 {
		t.Fatalf("blocked pat should not mutate happiness, got %+v", store.row)
	}
}

func TestInteractUsesConfiguredEffects(t *testing.T) {
	now := time.Now().Unix()
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     100,
		Happiness:  50,
		Energy:     10,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: now,
	}}
	svc := &petStateService{
		dao:    store,
		random: func() float64 { return 0 },
		rules: botconfig.Rules{Interactions: map[string]botconfig.InteractionRule{
			"chat": {MinimumStats: map[string]int{"spirit": 3}, Effect: map[string]any{"spirit": -3}},
			"pat": {
				Effect:        map[string]any{"happiness": 4},
				RandomEffects: []botconfig.RandomEffectRule{{Probability: 1, Effect: map[string]any{"spirit": 2}}},
			},
		}},
	}

	res, err := svc.Interact(context.Background(), "u1", "chat")
	if err != nil {
		t.Fatalf("Interact chat returned error: %v", err)
	}
	if res.NewState.Spirit != 7 || store.row.Energy != 7 {
		t.Fatalf("expected configured chat spirit -3, got result=%+v stored=%+v", res.NewState, store.row)
	}

	res, err = svc.Interact(context.Background(), "u1", "pat")
	if err != nil {
		t.Fatalf("Interact pat returned error: %v", err)
	}
	if res.NewState.Happiness != 54 || res.NewState.Spirit != 9 {
		t.Fatalf("expected configured pat happiness +4 and spirit +2, got %+v", res.NewState)
	}
}

func TestDefaultPatRuleAddsOneHappiness(t *testing.T) {
	now := time.Now().Unix()
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     100,
		Happiness:  50,
		Energy:     10,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: now,
	}}
	svc := &petStateService{dao: store, random: func() float64 { return 1 }}

	res, err := svc.Interact(context.Background(), "u1", "pat")
	if err != nil {
		t.Fatalf("Interact pat returned error: %v", err)
	}
	if res.NewState.Happiness != 51 || store.row.Happiness != 51 {
		t.Fatalf("expected default pat rule to add exactly 1 happiness, got result=%+v stored=%+v", res.NewState, store.row)
	}
	if res.NewState.Spirit != 10 || store.row.Energy != 10 {
		t.Fatalf("expected random spirit reward to be skipped, got result=%+v stored=%+v", res.NewState, store.row)
	}
}

func TestDebugSetStatePinsLifecycleAndStats(t *testing.T) {
	store := &fakePetStateDao{row: dao.PetState{
		UserID:     "u1",
		Hunger:     100,
		Happiness:  100,
		Energy:     100,
		Health:     100,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: time.Now().Unix(),
	}}
	svc := &petStateService{dao: store, random: func() float64 { return 1 }}

	hunger := 0
	spirit := 0
	sickDaysAgo := 2
	snap, err := svc.DebugSetState(context.Background(), "u1", service.PetDebugStateInput{
		Hunger:      &hunger,
		Spirit:      &spirit,
		Lifecycle:   "sick",
		SickDaysAgo: &sickDaysAgo,
	})
	if err != nil {
		t.Fatalf("DebugSetState returned error: %v", err)
	}
	if snap.Lifecycle != "sick" || snap.Hunger != 0 || snap.Spirit != 0 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	if store.row.SickStartedAt == nil {
		t.Fatalf("expected sick timestamp")
	}
}
