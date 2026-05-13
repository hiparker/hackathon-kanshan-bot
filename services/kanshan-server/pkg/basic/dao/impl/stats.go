package impl

import (
	"context"
	"database/sql"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type statsDao struct{ db *sql.DB }

func (d *statsDao) Append(ctx context.Context, e dao.StatsEvent) error {
	now := time.Now().Unix()
	occurredAt := e.OccurredAt
	if occurredAt == 0 {
		occurredAt = now
	}
	_, err := d.db.ExecContext(ctx, `INSERT INTO stats_event_log(user_id, event_type, payload, occurred_at, created_at) VALUES(?, ?, ?, ?, ?)`,
		e.UserID, e.EventType, payload(e.PayloadRaw), occurredAt, now,
	)
	return err
}

func payload(raw string) any {
	if raw == "" {
		return nil
	}
	return raw
}
