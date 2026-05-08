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

// Use validates qty + precondition, decrements stock, and asks PetStateService
// to refresh the snapshot. The actual effect application against pet_state
// columns will land in P1 alongside real persistence.
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

	pet, err := s.petState.Get(ctx, userID)
	if err != nil {
		return service.UseResult{}, err
	}

	if item.Precondition != nil && *item.Precondition != pet.Lifecycle {
		return service.UseResult{}, service.ErrInventoryPreconditionFail
	}
	if item.Qty <= 0 {
		return service.UseResult{}, service.ErrInventoryInsufficient
	}

	if err := s.itemDao.AdjustQty(ctx, userID, itemID, -1, "use"); err != nil {
		return service.UseResult{}, service.ErrInternal
	}

	return service.UseResult{
		NewState:   pet,
		ActionHint: item.ActionHint,
	}, nil
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
