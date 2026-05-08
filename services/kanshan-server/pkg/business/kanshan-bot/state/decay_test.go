package state

import "testing"

func TestApplyNoOpWhenLessThanOneHour(t *testing.T) {
	pet := &Pet{Hunger: 100, Happiness: 100, Energy: 100, Health: 100, Lifecycle: "normal", LastTickAt: 1000}
	Apply(pet, 1000+59*60, DefaultDecay)
	if pet.Hunger != 100 || pet.Happiness != 100 || pet.Energy != 100 || pet.Health != 100 {
		t.Fatalf("expected no decay below 1h, got %+v", pet)
	}
	if pet.LastTickAt != 1000 {
		t.Fatalf("LastTickAt should not advance below 1h, got %d", pet.LastTickAt)
	}
}

func TestApplyHourlyDecay(t *testing.T) {
	pet := &Pet{Hunger: 100, Happiness: 100, Energy: 100, Health: 100, Lifecycle: "normal", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Health != 95 {
		t.Fatalf("Health expected 95, got %d", pet.Health)
	}
	if pet.Hunger != 98 || pet.Happiness != 98 || pet.Energy != 98 {
		t.Fatalf("expected -2 each, got %+v", pet)
	}
	if pet.LastTickAt != 3600 {
		t.Fatalf("LastTickAt expected 3600, got %d", pet.LastTickAt)
	}
}

func TestSickAcceleratesHealthDecay(t *testing.T) {
	pet := &Pet{Health: 100, Hunger: 100, Happiness: 100, Energy: 100, Lifecycle: "sick", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Health != 90 {
		t.Fatalf("sick health decay expected 90, got %d", pet.Health)
	}
}

func TestSickToDeadAfter48h(t *testing.T) {
	startSick := int64(1000)
	pet := &Pet{Health: 0, Hunger: 100, Happiness: 100, Energy: 100, Lifecycle: "sick", SickStartedAt: &startSick, LastTickAt: 1000}
	Apply(pet, 1000+48*3600+1, DefaultDecay)
	if pet.Lifecycle != "dead" {
		t.Fatalf("expected lifecycle=dead after 48h sick, got %s", pet.Lifecycle)
	}
}

func TestHungryTransitionWhenHungerHitsZero(t *testing.T) {
	pet := &Pet{Hunger: 2, Happiness: 100, Energy: 100, Health: 100, Lifecycle: "normal", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Hunger != 0 {
		t.Fatalf("Hunger expected 0, got %d", pet.Hunger)
	}
	if pet.Lifecycle != "hungry" {
		t.Fatalf("expected hungry lifecycle, got %s", pet.Lifecycle)
	}
}

func TestClampStaysInRange(t *testing.T) {
	pet := &Pet{Hunger: 1, Happiness: 1, Energy: 1, Health: 1, Lifecycle: "normal", LastTickAt: 0}
	Apply(pet, 3600*100, DefaultDecay)
	if pet.Hunger < 0 || pet.Happiness < 0 || pet.Energy < 0 || pet.Health < 0 {
		t.Fatalf("values should not go negative, got %+v", pet)
	}
}
