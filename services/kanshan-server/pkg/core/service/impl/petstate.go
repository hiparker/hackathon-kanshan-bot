package impl

import (
	"context"
	"errors"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	bizstate "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/kanshan-bot/state"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type petStateService struct {
	dao dao.PetStateDao
}

// NewPetStateService returns a service.PetStateService backed by the
// dao/impl singleton.
func NewPetStateService() service.PetStateService {
	return &petStateService{dao: daoimpl.NewPetStateDao()}
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
		Health:     p.Health,
		Growth:     p.Growth,
		Mood:       p.Mood,
		Lifecycle:  p.Lifecycle,
		LastTickAt: p.LastTickAt,
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
