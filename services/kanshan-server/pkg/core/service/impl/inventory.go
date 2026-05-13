package impl

import (
	"context"
	"errors"
	"math/rand"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	botconfig "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/config"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type inventoryService struct {
	itemDao  dao.ItemDao
	petState service.PetStateService
	random   func() float64
	rules    botconfig.Rules
}

// NewInventoryService returns a service.InventoryService. It self-wires its
// dao + downstream PetStateService dependency.
func NewInventoryService() service.InventoryService {
	return &inventoryService{
		itemDao:  daoimpl.NewItemDao(),
		petState: NewPetStateService(),
		random:   rand.Float64,
		rules:    botconfig.MustLoadRules(),
	}
}

func (s *inventoryService) List(ctx context.Context, userID string) ([]service.InventoryItem, error) {
	rows, err := s.itemDao.ListForUser(ctx, userID)
	if err != nil {
		return nil, service.ErrInternal
	}
	out := make([]service.InventoryItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, toInventoryItem(r))
	}
	return out, nil
}

// Use applies time decay + configured item effects to pet_state, after qty check and fixed one-item atomic deduct.
func (s *inventoryService) Use(ctx context.Context, userID, itemID string) (service.UseResult, error) {
	if itemID == "" {
		return service.UseResult{}, service.ErrBadRequest
	}

	item, err := s.itemDao.GetForUser(ctx, userID, itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return service.UseResult{}, service.ErrBadRequest
		}
		return service.UseResult{}, service.ErrInternal
	}

	if item.Qty <= 0 {
		return service.UseResult{}, service.ErrInventoryInsufficient
	}

	current, err := s.petState.Tick(ctx, userID)
	if err != nil {
		return service.UseResult{}, err
	}
	itemRule, hasItemRule := s.rulesForUse().Items[item.ItemID]
	if hasItemRule && len(itemRule.AllowedLifecycles) > 0 && !botconfig.Contains(itemRule.AllowedLifecycles, current.Lifecycle) {
		return service.UseResult{}, service.ErrPetActionNotAllowed
	}
	effectJSON := item.EffectJSON
	precondition := item.Precondition
	if hasItemRule {
		var err error
		effectJSON, err = botconfig.EffectJSON(itemRule.Effect)
		if err != nil {
			return service.UseResult{}, service.ErrBadRequest
		}
		precondition = itemRule.Precondition
	}

	snap, err := s.petState.CompleteItemUse(ctx, userID, precondition, effectJSON, func() error {
		return s.itemDao.DecrementQty(ctx, userID, itemID, 1, "use")
	})
	if err != nil {
		if errors.Is(err, dao.ErrInsufficientStock) {
			return service.UseResult{}, service.ErrInventoryInsufficient
		}
		switch err {
		case service.ErrInventoryPreconditionFail, service.ErrBadRequest, service.ErrPetActionNotAllowed:
			return service.UseResult{}, err
		default:
			return service.UseResult{}, service.ErrInternal
		}
	}

	actionHint := item.ActionHint
	if hasItemRule && itemRule.ActionHint != "" {
		actionHint = itemRule.ActionHint
	}
	if actionHint == "" && shouldDanceAfterUse(s.random, snap.Happiness, s.rulesForUse().ItemActionRewards) {
		actionHint = s.rulesForUse().ItemActionRewards.ActionHint
	}
	return service.UseResult{NewState: snap, ActionHint: actionHint}, nil
}

func (s *inventoryService) rulesForUse() botconfig.Rules {
	if s.rules.Interactions == nil && s.rules.Items == nil {
		s.rules = botconfig.MustLoadRules()
	}
	return s.rules
}

func (s *inventoryService) Deduct(ctx context.Context, userID, itemID string, qty int, reason string) (service.InventoryItem, error) {
	if itemID == "" || qty <= 0 {
		return service.InventoryItem{}, service.ErrBadRequest
	}
	if reason == "" {
		reason = "deduct"
	}
	if err := s.itemDao.DecrementQty(ctx, userID, itemID, qty, reason); err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return service.InventoryItem{}, service.ErrBadRequest
		}
		if errors.Is(err, dao.ErrInsufficientStock) {
			return service.InventoryItem{}, service.ErrInventoryInsufficient
		}
		return service.InventoryItem{}, service.ErrInternal
	}
	item, err := s.itemDao.GetForUser(ctx, userID, itemID)
	if err != nil {
		return service.InventoryItem{}, service.ErrInternal
	}
	return toInventoryItem(item), nil
}

func shouldDanceAfterUse(random func() float64, happiness int, rule botconfig.ItemActionRewardRule) bool {
	if random == nil {
		return false
	}
	if happiness > rule.HighHappinessThreshold {
		return random() < rule.HighHappinessProbability
	}
	if happiness > rule.MediumHappinessThreshold {
		return random() < rule.MediumHappinessProbability
	}
	return false
}

func (s *inventoryService) Restock(ctx context.Context, userID, itemID string, qty int, reason string) (service.InventoryItem, error) {
	if itemID == "" || qty <= 0 {
		return service.InventoryItem{}, service.ErrBadRequest
	}
	if reason == "" {
		reason = "restock"
	}
	if err := s.itemDao.AdjustQty(ctx, userID, itemID, qty, reason); err != nil {
		return service.InventoryItem{}, service.ErrInternal
	}
	item, err := s.itemDao.GetForUser(ctx, userID, itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return service.InventoryItem{}, service.ErrBadRequest
		}
		return service.InventoryItem{}, service.ErrInternal
	}
	return toInventoryItem(item), nil
}

func toInventoryItem(r dao.Item) service.InventoryItem {
	return service.InventoryItem{
		ItemID:               r.ItemID,
		Name:                 r.Name,
		Qty:                  r.Qty,
		Rarity:               r.Rarity,
		CooldownRemainingSec: 0,
		ExpireAt:             r.ExpireAt,
		ActionHint:           r.ActionHint,
		Precondition:         r.Precondition,
	}
}
