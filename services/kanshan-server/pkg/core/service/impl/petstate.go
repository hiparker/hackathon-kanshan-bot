package impl

import (
	"context"
	"errors"
	"math/rand"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	bizstate "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/state"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type petStateService struct {
	dao            dao.PetStateDao
	interactionDao dao.InteractionCountDao
	random         func() float64
	rules          botconfig.Rules
}

// NewPetStateService returns a service.PetStateService backed by the
// dao/impl singleton.
func NewPetStateService() service.PetStateService {
	return &petStateService{dao: daoimpl.NewPetStateDao(), interactionDao: daoimpl.NewInteractionCountDao(), random: rand.Float64, rules: botconfig.MustLoadRules()}
}

func (s *petStateService) Get(ctx context.Context, userID string) (service.PetSnapshot, error) {
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetSnapshot{}, err
	}
	return toSnapshot(userID, pet), nil
}

func (s *petStateService) Tick(ctx context.Context, userID string) (service.PetSnapshot, error) {
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetSnapshot{}, err
	}
	now := time.Now().Unix()
	bizstate.Apply(pet, now, bizstate.DefaultDecay)
	snap := toSnapshot(userID, pet)
	if pet.Happiness > 65 && s.random != nil && s.random() < 0.01 {
		snap.ActionHint = "happy-temporary"
	}
	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetSnapshot{}, service.ErrInternal
	}
	return snap, nil
}

func (s *petStateService) DebugSetState(ctx context.Context, userID string, input service.PetDebugStateInput) (service.PetSnapshot, error) {
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetSnapshot{}, err
	}
	now := time.Now().Unix()
	if input.Hunger != nil {
		pet.Hunger = clampStat(*input.Hunger)
	}
	if input.Happiness != nil {
		pet.Happiness = clampStat(*input.Happiness)
	}
	if input.Spirit != nil {
		pet.Energy = clampStat(*input.Spirit)
	}
	if input.Health != nil {
		pet.Health = clampStat(*input.Health)
	}
	if input.Lifecycle != "" {
		switch input.Lifecycle {
		case "normal", "hungry", "sick", "dead":
			pet.Lifecycle = input.Lifecycle
		default:
			return service.PetSnapshot{}, service.ErrBadRequest
		}
	}
	if pet.Lifecycle == "sick" {
		startedAt := now
		if input.SickDaysAgo != nil && *input.SickDaysAgo > 0 {
			startedAt = now - int64(*input.SickDaysAgo)*24*3600
		}
		pet.SickStartedAt = &startedAt
	} else {
		pet.SickStartedAt = nil
	}
	if input.Lifecycle == "" {
		bizstate.NormalizeLifecycle(pet, now)
	}
	pet.LastTickAt = now
	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetSnapshot{}, service.ErrInternal
	}
	return toSnapshot(userID, pet), nil
}

func (s *petStateService) Interact(ctx context.Context, userID, action string) (service.PetInteractionResult, error) {
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetInteractionResult{}, err
	}
	now := time.Now().Unix()
	bizstate.Apply(pet, now, bizstate.DefaultDecay)

	rule, ok := s.rulesForUse().Interactions[action]
	if !ok {
		return service.PetInteractionResult{}, service.ErrBadRequest
	}
	if action == "pat" {
		periodKey := dayPeriodKey(now)
		count, err := s.interactionCount(ctx, userID, action, periodKey)
		if err != nil {
			return service.PetInteractionResult{}, service.ErrInternal
		}
		if count >= 10 {
			return s.blockedInteract(ctx, userID, pet, "看山今天已经被摸摸 10 次了，明天再来吧。")
		}
	}
	if botconfig.Contains(rule.BlockedLifecycles, pet.Lifecycle) {
		return s.blockedInteract(ctx, userID, pet, blockedMessage(pet.Lifecycle, action))
	}
	if !hasMinimumStats(pet, rule.MinimumStats) {
		message := rule.InsufficientMessage
		if message == "" {
			message = blockedMessage(pet.Lifecycle, action)
		}
		return s.blockedInteract(ctx, userID, pet, message)
	}
	if err := applyConfiguredEffect(pet, rule.Effect); err != nil {
		return service.PetInteractionResult{}, service.ErrBadRequest
	}
	for _, randomEffect := range rule.RandomEffects {
		if s.random != nil && s.random() < randomEffect.Probability {
			if err := applyConfiguredEffect(pet, randomEffect.Effect); err != nil {
				return service.PetInteractionResult{}, service.ErrBadRequest
			}
		}
	}

	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetInteractionResult{}, service.ErrInternal
	}
	if action == "pat" {
		if _, err := s.incrementInteraction(ctx, userID, action, dayPeriodKey(now)); err != nil {
			return service.PetInteractionResult{}, service.ErrInternal
		}
	}
	return service.PetInteractionResult{NewState: toSnapshot(userID, pet), ActionHint: rule.ActionHint}, nil
}

func (s *petStateService) ApplyTaskEffect(ctx context.Context, userID, taskID string) (service.PetInteractionResult, error) {
	rule, ok := s.rulesForUse().TaskEffects[taskID]
	if !ok || len(rule.Effect) == 0 {
		return service.PetInteractionResult{}, service.ErrBadRequest
	}
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetInteractionResult{}, err
	}
	now := time.Now().Unix()
	bizstate.Apply(pet, now, bizstate.DefaultDecay)
	if err := applyConfiguredEffect(pet, rule.Effect); err != nil {
		return service.PetInteractionResult{}, service.ErrBadRequest
	}
	bizstate.NormalizeLifecycle(pet, now)
	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetInteractionResult{}, service.ErrInternal
	}
	return service.PetInteractionResult{NewState: toSnapshot(userID, pet), ActionHint: rule.ActionHint}, nil
}

func (s *petStateService) rulesForUse() botconfig.Rules {
	if s.rules.Interactions == nil && s.rules.Items == nil {
		s.rules = botconfig.MustLoadRules()
	}
	return s.rules
}

func (s *petStateService) interactionCount(ctx context.Context, userID, action, periodKey string) (int, error) {
	if s.interactionDao == nil {
		return 0, nil
	}
	return s.interactionDao.GetCount(ctx, userID, action, periodKey)
}

func (s *petStateService) incrementInteraction(ctx context.Context, userID, action, periodKey string) (int, error) {
	if s.interactionDao == nil {
		return 0, nil
	}
	return s.interactionDao.Increment(ctx, userID, action, periodKey)
}

func dayPeriodKey(ts int64) string {
	return time.Unix(ts, 0).UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func applyConfiguredEffect(pet *bizstate.Pet, effect map[string]any) error {
	raw, err := botconfig.EffectJSON(effect)
	if err != nil {
		return err
	}
	if err := bizstate.ApplyEffectJSON(pet, raw); err != nil {
		return err
	}
	return nil
}

func hasMinimumStats(pet *bizstate.Pet, minimum map[string]int) bool {
	for key, value := range minimum {
		switch key {
		case "hunger":
			if pet.Hunger < value {
				return false
			}
		case "happiness":
			if pet.Happiness < value {
				return false
			}
		case "energy", "spirit":
			if pet.Energy < value {
				return false
			}
		case "health":
			if pet.Health < value {
				return false
			}
		}
	}
	return true
}

func (s *petStateService) blockedInteract(ctx context.Context, userID string, pet *bizstate.Pet, message string) (service.PetInteractionResult, error) {
	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetInteractionResult{}, service.ErrInternal
	}
	return service.PetInteractionResult{NewState: toSnapshot(userID, pet), Message: message}, service.ErrPetActionNotAllowed
}

func (s *petStateService) CompleteItemUse(ctx context.Context, userID string, precondition *string, effectJSON string, decrement func() error) (service.PetSnapshot, error) {
	if err := bizstate.ValidateEffectJSON(effectJSON); err != nil {
		return service.PetSnapshot{}, service.ErrBadRequest
	}
	pet, err := s.load(ctx, userID)
	if err != nil {
		return service.PetSnapshot{}, service.ErrInternal
	}
	now := time.Now().Unix()
	bizstate.Apply(pet, now, bizstate.DefaultDecay)

	if precondition != nil && *precondition != pet.Lifecycle {
		return service.PetSnapshot{}, service.ErrInventoryPreconditionFail
	}

	if err := decrement(); err != nil {
		return service.PetSnapshot{}, err
	}

	if err := bizstate.ApplyEffectJSON(pet, effectJSON); err != nil {
		return service.PetSnapshot{}, service.ErrBadRequest
	}
	bizstate.NormalizeLifecycle(pet, now)

	if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
		return service.PetSnapshot{}, service.ErrInternal
	}
	return toSnapshot(userID, pet), nil
}

func (s *petStateService) load(ctx context.Context, userID string) (*bizstate.Pet, error) {
	row, err := s.dao.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			pet := bizstate.Default(time.Now().Unix())
			if err := s.dao.Save(ctx, toDao(userID, pet)); err != nil {
				return nil, service.ErrInternal
			}
			return pet, nil
		}
		return nil, service.ErrInternal
	}
	return &bizstate.Pet{
		Hunger:           row.Hunger,
		Happiness:        row.Happiness,
		Energy:           row.Energy,
		Health:           row.Health,
		Growth:           row.Growth,
		Mood:             row.Mood,
		Lifecycle:        row.Lifecycle,
		LastTickAt:       row.LastTickAt,
		SickStartedAt:    row.SickStartedAt,
		RunawayStartedAt: row.RunawayStartedAt,
	}, nil
}

func toSnapshot(userID string, p *bizstate.Pet) service.PetSnapshot {
	return service.PetSnapshot{
		UserID:     userID,
		Hunger:     p.Hunger,
		Happiness:  p.Happiness,
		Energy:     p.Energy,
		Spirit:     p.Energy,
		Health:     p.Health,
		Growth:     p.Growth,
		Mood:       p.Mood,
		Lifecycle:  p.Lifecycle,
		LastTickAt: p.LastTickAt,
	}
}

func clampStat(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func blockedMessage(lifecycle, action string) string {
	switch lifecycle {
	case "hungry":
		return "看山肚子饿得咕咕叫，先给它吃点小鱼干或营养罐头吧。"
	case "sick":
		return "看山现在不太舒服，需要先吃感冒药。"
	case "dead":
		return "看山安静地睡着了，需要复活羽毛把它带回来。"
	default:
		if action == "chat" {
			return "看山现在还不想说话。"
		}
		return "看山现在还不能这样做。"
	}
}

func toDao(userID string, p *bizstate.Pet) dao.PetState {
	return dao.PetState{
		UserID:           userID,
		Hunger:           p.Hunger,
		Happiness:        p.Happiness,
		Energy:           p.Energy,
		Health:           p.Health,
		Growth:           p.Growth,
		Mood:             p.Mood,
		Lifecycle:        p.Lifecycle,
		LastTickAt:       p.LastTickAt,
		SickStartedAt:    p.SickStartedAt,
		RunawayStartedAt: p.RunawayStartedAt,
	}
}
