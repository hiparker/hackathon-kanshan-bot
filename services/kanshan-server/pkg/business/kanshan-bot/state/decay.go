// Package state owns the pet long-term state shape and the offline decay
// algorithm described in planning/backend-rfc.md §6. It is the only place
// that encodes the per-hour decay rates listed in product-design.md 1.2.
package state

// Pet captures the subset of pet_state used by the decay algorithm. Fields
// match the SQL columns one-to-one so callers can fill it from a row scan.
type Pet struct {
	Hunger             int
	Happiness          int
	Energy             int
	Health             int
	Growth             int
	Mood               string
	Lifecycle          string
	LastTickAt         int64
	SickStartedAt      *int64
	RunawayStartedAt   *int64
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
	HealthNormal:    5,
	HealthSick:      10,
	Happiness:       2,
	Hunger:          2,
	Energy:          2,
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
		return pet
	}

	healthRate := decay.HealthNormal
	if pet.Lifecycle == "sick" {
		healthRate = decay.HealthSick
	}

	pet.Health = clamp(pet.Health - healthRate*deltaHours)
	pet.Happiness = clamp(pet.Happiness - decay.Happiness*deltaHours)
	pet.Hunger = clamp(pet.Hunger - decay.Hunger*deltaHours)
	pet.Energy = clamp(pet.Energy - decay.Energy*deltaHours)

	if pet.Hunger <= 0 && pet.Lifecycle == "normal" {
		pet.Lifecycle = "hungry"
	}
	if pet.Health <= 0 && pet.Lifecycle != "sick" && pet.Lifecycle != "dead" {
		pet.Lifecycle = "sick"
		ts := now
		pet.SickStartedAt = &ts
	}
	if pet.Lifecycle == "sick" && pet.SickStartedAt != nil && now-*pet.SickStartedAt >= 48*3600 {
		pet.Lifecycle = "dead"
	}

	pet.LastTickAt = now
	return pet
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
		Hunger:     90,
		Happiness:  85,
		Energy:     80,
		Health:     95,
		Growth:     0,
		Mood:       "normal",
		Lifecycle:  "normal",
		LastTickAt: lastTickAt,
	}
}
