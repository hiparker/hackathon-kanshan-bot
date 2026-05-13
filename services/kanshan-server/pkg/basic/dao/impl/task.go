package impl

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type taskDao struct{ db *sql.DB }

const taskSelect = `
SELECT
    c.task_id, c.type, c.name, c.target_count, c.reward_json, c.trigger_event,
    COALESCE(ut.done_count, 0) AS done_count,
    ut.done_at                 AS done_at,
    COALESCE(ut.rewarded, 0)   AS rewarded
FROM tasks_catalog c
LEFT JOIN user_tasks ut ON ut.task_id = c.task_id AND ut.user_id = ? AND ut.period_key = ?
`

func (d *taskDao) ListForUser(ctx context.Context, userID, periodType, periodKey string) ([]dao.Task, error) {
	args := []any{userID, periodKey}
	q := taskSelect
	if periodType != "" {
		q += ` WHERE c.type = ?`
		args = append(args, periodType)
	}
	q += ` ORDER BY c.type ASC, c.sort_order ASC, c.task_id ASC`
	rows, err := d.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dao.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (d *taskDao) GetForUser(ctx context.Context, userID, taskID, periodKey string) (dao.Task, error) {
	row := d.db.QueryRowContext(ctx, taskSelect+` WHERE c.task_id = ?`, userID, periodKey, taskID)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return dao.Task{}, dao.ErrNotFound
	}
	return t, err
}

func (d *taskDao) UpsertProgress(ctx context.Context, userID, taskID, periodKey string, doneCount int, rewarded bool, doneAt *int64) error {
	now := time.Now().Unix()
	rewardedI := 0
	if rewarded {
		rewardedI = 1
	}
	_, err := d.db.ExecContext(ctx, `INSERT INTO user_tasks(user_id, task_id, period_key, done_count, done_at, rewarded, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, task_id, period_key) DO UPDATE SET
			done_count = excluded.done_count,
			done_at    = COALESCE(excluded.done_at, user_tasks.done_at),
			rewarded   = excluded.rewarded,
			updated_at = excluded.updated_at`,
		userID, taskID, periodKey, doneCount, nullableInt64(doneAt), rewardedI, now,
	)
	return err
}

func scanTask(s scanner) (dao.Task, error) {
	var (
		t         dao.Task
		trigger   sql.NullString
		doneAt    sql.NullInt64
		rewardedI int
	)
	if err := s.Scan(
		&t.TaskID, &t.Type, &t.Name, &t.TargetCount, &t.RewardJSON,
		&trigger, &t.DoneCount, &doneAt, &rewardedI,
	); err != nil {
		return dao.Task{}, err
	}
	if trigger.Valid {
		t.TriggerEvent = trigger.String
	}
	if doneAt.Valid {
		v := doneAt.Int64
		t.DoneAt = &v
	}
	t.Rewarded = rewardedI != 0
	return t, nil
}
