// Package state owns the pet long-term state shape and the offline decay
// algorithm described in planning/backend-rfc.md §6. It is the only place
// that encodes the per-hour decay rates listed in product-design.md 1.2.
package state

// Pet captures the subset of pet_state used by the decay algorithm. Fields
// match the SQL columns one-to-one so callers can fill it from a row scan.
type Pet struct {
	Hunger           int
	Happiness        int
	Energy           int
	Health           int
	Growth           int
	Mood             string
	Lifecycle        string
	LastTickAt       int64
	SickStartedAt    *int64
	RunawayStartedAt *int64
}

// DecayPerHour is the hackathon-simplified decay rate (avg of rand 1..3 ranges,
// rounded). See planning/backend-rfc.md §6.
type DecayPerHour struct {
	HealthNormal    int
	HealthSick      int
	Happiness       int
	Hunger          int
	Energy          int
	HappinessIgnore int
}

var DefaultDecay = DecayPerHour{
	HealthNormal:    0,
	HealthSick:      0,
	Happiness:       0,
	Hunger:          2,
	Energy:          0,
	HappinessIgnore: 5,
}

// Apply applies decay on `pet` for the elapsed time between pet.LastTickAt and now.
// It mutates `pet` in place and returns it for convenience.
func Apply(pet *Pet, now int64, decay DecayPerHour) *Pet {
	if pet == nil {
		return nil
	}
	deltaHours := int((now - pet.LastTickAt) / 3600)
	if deltaHours <= 0 {
		NormalizeLifecycle(pet, now)
		return pet
	}

	pet.Hunger = clamp(pet.Hunger - decay.Hunger*deltaHours)
	NormalizeLifecycle(pet, now)

	pet.LastTickAt = now
	return pet
}

// NormalizeLifecycle derives the long-term state from hunger. It intentionally
// leaves an already-dead pet dead until a revive effect overrides lifecycle.
func NormalizeLifecycle(pet *Pet, now int64) {
	if pet == nil || pet.Lifecycle == "dead" {
		return
	}
	if pet.Hunger <= 0 {
		if pet.Lifecycle != "sick" {
			pet.Lifecycle = "sick"
			ts := now
			pet.SickStartedAt = &ts
		}
		if pet.SickStartedAt != nil && now-*pet.SickStartedAt >= 72*3600 {
			pet.Lifecycle = "dead"
		}
		return
	}
	pet.SickStartedAt = nil
	if pet.Hunger < 60 {
		pet.Lifecycle = "hungry"
		return
	}
	pet.Lifecycle = "normal"
}

func clamp(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// Default returns a healthy initial pet snapshot. Used by handlers as a
// stand-in until the SQLite repository is wired up.
func Default(lastTickAt int64) *Pet {
	return &Pet{
		Hunger:     100,
		Happiness:  100,
		Energy:     100,
		Health:     100,
		Growth:     0,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: lastTickAt,
	}
}
