package impl

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type interactionCountDao struct{ db *sql.DB }

func (d *interactionCountDao) GetCount(ctx context.Context, userID, action, periodKey string) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx, `SELECT count FROM user_interaction_counts WHERE user_id = ? AND action = ? AND period_key = ?`, userID, action, periodKey).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return count, err
}

func (d *interactionCountDao) Increment(ctx context.Context, userID, action, periodKey string) (int, error) {
	now := time.Now().Unix()
	_, err := d.db.ExecContext(ctx, `INSERT INTO user_interaction_counts(user_id, action, period_key, count, updated_at)
		VALUES(?, ?, ?, 1, ?)
		ON CONFLICT(user_id, action, period_key) DO UPDATE SET
			count = user_interaction_counts.count + 1,
			updated_at = excluded.updated_at`,
		userID, action, periodKey, now,
	)
	if err != nil {
		return 0, err
	}
	return d.GetCount(ctx, userID, action, periodKey)
}
