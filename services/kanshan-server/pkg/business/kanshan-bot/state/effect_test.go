package state

import "testing"

func TestApplyEffectSupportsSpiritAliasAndClamp(t *testing.T) {
	pet := &Pet{Hunger: 95, Happiness: 95, Energy: 95, Health: 100, Lifecycle: "normal"}

	if err := ApplyEffectJSON(pet, `{"hunger":10,"happiness":10,"spirit":10}`); err != nil {
		t.Fatalf("ApplyEffectJSON returned error: %v", err)
	}

	if pet.Hunger != 100 || pet.Happiness != 100 || pet.Energy != 100 {
		t.Fatalf("expected stats clamped to 100, got %+v", pet)
	}
}

func TestApplyEffectSupportsRecoverySetters(t *testing.T) {
	startSick := int64(1000)
	pet := &Pet{Hunger: 0, Happiness: 30, Energy: 20, Health: 100, Lifecycle: "sick", SickStartedAt: &startSick}

	if err := ApplyEffectJSON(pet, `{"set_hunger":50,"set_spirit":10,"set_happiness":10,"lifecycle":"normal"}`); err != nil {
		t.Fatalf("ApplyEffectJSON returned error: %v", err)
	}

	if pet.Hunger != 50 || pet.Energy != 10 || pet.Happiness != 10 {
		t.Fatalf("expected set effects, got %+v", pet)
	}
	if pet.Lifecycle != "normal" || pet.SickStartedAt != nil {
		t.Fatalf("expected normal lifecycle with cleared sick timestamp, got %+v", pet)
	}
}
