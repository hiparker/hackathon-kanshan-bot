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
	if pet.Health != 100 {
		t.Fatalf("Health expected unchanged 100, got %d", pet.Health)
	}
	if pet.Hunger != 98 || pet.Happiness != 100 || pet.Energy != 100 {
		t.Fatalf("expected hunger-only decay, got %+v", pet)
	}
	if pet.LastTickAt != 3600 {
		t.Fatalf("LastTickAt expected 3600, got %d", pet.LastTickAt)
	}
}

func TestSickDoesNotDecayHealth(t *testing.T) {
	pet := &Pet{Health: 100, Hunger: 100, Happiness: 100, Energy: 100, Lifecycle: "sick", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Health != 100 {
		t.Fatalf("sick health expected unchanged 100, got %d", pet.Health)
	}
}

func TestSickToDeadAfterThreeDays(t *testing.T) {
	startSick := int64(1000)
	pet := &Pet{Health: 0, Hunger: 100, Happiness: 100, Energy: 100, Lifecycle: "sick", SickStartedAt: &startSick, LastTickAt: 1000}
	pet.Hunger = 0
	Apply(pet, 1000+72*3600+1, DefaultDecay)
	if pet.Lifecycle != "dead" {
		t.Fatalf("expected lifecycle=dead after 72h sick, got %s", pet.Lifecycle)
	}
}

func TestSickTransitionWhenHungerHitsZero(t *testing.T) {
	pet := &Pet{Hunger: 2, Happiness: 100, Energy: 100, Health: 100, Lifecycle: "normal", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Hunger != 0 {
		t.Fatalf("Hunger expected 0, got %d", pet.Hunger)
	}
	if pet.Lifecycle != "sick" {
		t.Fatalf("expected sick lifecycle, got %s", pet.Lifecycle)
	}
}

func TestHungryTransitionBelowSixty(t *testing.T) {
	pet := &Pet{Hunger: 61, Happiness: 100, Energy: 100, Health: 100, Lifecycle: "normal", LastTickAt: 0}
	Apply(pet, 3600, DefaultDecay)
	if pet.Hunger != 59 {
		t.Fatalf("Hunger expected 59, got %d", pet.Hunger)
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
