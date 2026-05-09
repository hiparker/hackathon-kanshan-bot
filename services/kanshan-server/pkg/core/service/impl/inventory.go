package impl

import (
	"context"
	"errors"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type inventoryService struct {
	itemDao  dao.ItemDao
	petState service.PetStateService
}

// NewInventoryService returns a service.InventoryService. It self-wires its
// dao + downstream PetStateService dependency.
func NewInventoryService() service.InventoryService {
	return &inventoryService{
		itemDao:  daoimpl.NewItemDao(),
		petState: NewPetStateService(),
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

// Use applies time decay + catalog effect_json to pet_state, after qty check and atomic deduct.
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

	snap, err := s.petState.CompleteItemUse(ctx, userID, item.Precondition, item.EffectJSON, func() error {
		return s.itemDao.DecrementQty(ctx, userID, itemID, 1, "use")
	})
	if err != nil {
		if errors.Is(err, dao.ErrInsufficientStock) {
			return service.UseResult{}, service.ErrInventoryInsufficient
		}
		switch err {
		case service.ErrInventoryPreconditionFail, service.ErrBadRequest:
			return service.UseResult{}, err
		default:
			return service.UseResult{}, service.ErrInternal
		}
	}

	return service.UseResult{
		NewState:   snap,
		ActionHint: item.ActionHint,
	}, nil
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
