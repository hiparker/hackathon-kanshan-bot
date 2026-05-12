package state

import (
	"encoding/json"
	"fmt"
)

// ApplyEffectJSON merges items_catalog.effect_json onto pet (additive stats,
// lifecycle overrides). Unknown keys are ignored. Numbers in JSON unmarshal as float64.
func ApplyEffectJSON(p *Pet, raw string) error {
	if p == nil || raw == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return err
	}
	for k, v := range m {
		switch k {
		case "hunger":
			p.Hunger = clamp(p.Hunger + numDelta(v))
		case "set_hunger":
			p.Hunger = clamp(numDelta(v))
		case "happiness":
			p.Happiness = clamp(p.Happiness + numDelta(v))
		case "set_happiness":
			p.Happiness = clamp(numDelta(v))
		case "energy":
			p.Energy = clamp(p.Energy + numDelta(v))
		case "spirit":
			p.Energy = clamp(p.Energy + numDelta(v))
		case "set_energy", "set_spirit":
			p.Energy = clamp(numDelta(v))
		case "health":
			p.Health = clamp(p.Health + numDelta(v))
		case "growth":
			p.Growth = clampGrowth(p.Growth + numDelta(v))
		case "mood":
			if s, ok := v.(string); ok && s != "" {
				p.Mood = s
			}
		case "lifecycle":
			if s, ok := v.(string); ok && s != "" {
				p.Lifecycle = s
				if s == "normal" {
					p.SickStartedAt = nil
				}
				if s == "dead" {
					p.RunawayStartedAt = nil
				}
			}
		default:
			// ignore forward-compatible keys
		}
	}
	return nil
}

// ValidateEffectJSON ensures JSON is parseable (call before deducting inventory).
func ValidateEffectJSON(raw string) error {
	if raw == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return fmt.Errorf("effect_json: %w", err)
	}
	return nil
}

func numDelta(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case json.Number:
		i, _ := x.Int64()
		return int(i)
	default:
		return 0
	}
}

func clampGrowth(v int) int {
	if v < 0 {
		return 0
	}
	if v > 999999 {
		return 999999
	}
	return v
}
