package impl

import (
	"context"
	"encoding/json"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type statsService struct {
	dao dao.StatsDao
}

// NewStatsService returns a service.StatsService backed by the dao/impl
// singleton.
func NewStatsService() service.StatsService {
	return &statsService{dao: daoimpl.NewStatsDao()}
}

var allowedStatsEventTypes = map[string]struct{}{
	"post_view": {},
	"like":      {},
	"comment":   {},
	"reminder":  {},
	"long_stay": {},
}

func (s *statsService) Event(ctx context.Context, userID string, e service.StatsEventInput) error {
	if _, ok := allowedStatsEventTypes[e.Type]; !ok {
		return service.ErrBadRequest
	}
	var raw string
	if e.Payload != nil {
		buf, err := json.Marshal(e.Payload)
		if err != nil {
			return service.ErrBadRequest
		}
		raw = string(buf)
	}
	if err := s.dao.Append(ctx, dao.StatsEvent{
		UserID:     userID,
		EventType:  e.Type,
		PayloadRaw: raw,
		OccurredAt: e.TS,
	}); err != nil {
		return service.ErrInternal
	}
	return nil
}
