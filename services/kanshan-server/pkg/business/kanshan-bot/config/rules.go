package botconfig

import (
	"encoding/json"
	"os"
	"sync"

	_ "embed"
)

//go:embed interaction_rules.json
var defaultRulesJSON []byte

type Rules struct {
	Interactions      map[string]InteractionRule `json:"interactions"`
	Items             map[string]ItemRule        `json:"items"`
	ItemActionRewards ItemActionRewardRule       `json:"item_action_rewards"`
}

type InteractionRule struct {
	BlockedLifecycles   []string           `json:"blocked_lifecycles"`
	MinimumStats        map[string]int     `json:"minimum_stats"`
	Effect              map[string]any     `json:"effect"`
	RandomEffects       []RandomEffectRule `json:"random_effects"`
	ActionHint          string             `json:"action_hint"`
	InsufficientMessage string             `json:"insufficient_message"`
}

type RandomEffectRule struct {
	Probability float64        `json:"probability"`
	Effect      map[string]any `json:"effect"`
}

type ItemRule struct {
	AllowedLifecycles []string       `json:"allowed_lifecycles"`
	Precondition      *string        `json:"precondition"`
	ActionHint        string         `json:"action_hint"`
	Effect            map[string]any `json:"effect"`
}

type ItemActionRewardRule struct {
	HighHappinessThreshold     int     `json:"high_happiness_threshold"`
	HighHappinessProbability   float64 `json:"high_happiness_probability"`
	MediumHappinessThreshold   int     `json:"medium_happiness_threshold"`
	MediumHappinessProbability float64 `json:"medium_happiness_probability"`
	ActionHint                 string  `json:"action_hint"`
}

var (
	cachedRules Rules
	cachedErr   error
	once        sync.Once
)

func LoadRules() (Rules, error) {
	once.Do(func() {
		raw := defaultRulesJSON
		if path := os.Getenv("KANSHAN_RULES_CONFIG"); path != "" {
			var err error
			raw, err = os.ReadFile(path)
			if err != nil {
				cachedErr = err
				return
			}
		}
		cachedErr = json.Unmarshal(raw, &cachedRules)
	})
	return cachedRules, cachedErr
}

func MustLoadRules() Rules {
	rules, err := LoadRules()
	if err != nil {
		panic(err)
	}
	return rules
}

func EffectJSON(effect map[string]any) (string, error) {
	if len(effect) == 0 {
		return "{}", nil
	}
	raw, err := json.Marshal(effect)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func Contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
