package impl

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type itemDao struct{ db *sql.DB }

const itemSelect = `
SELECT
    c.item_id, c.name, c.rarity, c.cooldown_sec, c.effect_json, c.precondition, c.action_hint,
    COALESCE(ui.qty, 0)        AS qty,
    ui.last_used_at            AS last_used_at,
    ui.expire_at               AS expire_at
FROM items_catalog c
LEFT JOIN user_items ui ON ui.item_id = c.item_id AND ui.user_id = ?
`

func (d *itemDao) ListForUser(ctx context.Context, userID string) ([]dao.Item, error) {
	rows, err := d.db.QueryContext(ctx, itemSelect+` ORDER BY c.sort_order ASC, c.item_id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dao.Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (d *itemDao) GetForUser(ctx context.Context, userID, itemID string) (dao.Item, error) {
	row := d.db.QueryRowContext(ctx, itemSelect+` WHERE c.item_id = ?`, userID, itemID)
	it, err := scanItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return dao.Item{}, dao.ErrNotFound
	}
	return it, err
}

func (d *itemDao) AdjustQty(ctx context.Context, userID, itemID string, delta int, reason string) error {
	now := time.Now().Unix()
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `INSERT INTO user_items(user_id, item_id, qty, last_obtained_at, last_used_at)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(user_id, item_id) DO UPDATE SET
			qty              = MAX(0, user_items.qty + excluded.qty),
			last_obtained_at = CASE WHEN excluded.qty > 0 THEN excluded.last_obtained_at ELSE user_items.last_obtained_at END,
			last_used_at     = CASE WHEN excluded.qty < 0 THEN excluded.last_used_at     ELSE user_items.last_used_at     END`,
		userID, itemID, delta, now, now,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO inventory_log(user_id, item_id, delta, reason, created_at) VALUES(?, ?, ?, ?, ?)`,
		userID, itemID, delta, reason, now,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (d *itemDao) DecrementQty(ctx context.Context, userID, itemID string, amount int, reason string) error {
	if amount <= 0 {
		return fmt.Errorf("itemDao.DecrementQty: amount must be positive")
	}
	now := time.Now().Unix()
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var catExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM items_catalog WHERE item_id = ?`, itemID).Scan(&catExists); err != nil {
		return err
	}
	if catExists == 0 {
		return dao.ErrNotFound
	}

	res, err := tx.ExecContext(ctx,
		`UPDATE user_items SET qty = qty - ?, last_used_at = ? WHERE user_id = ? AND item_id = ? AND qty >= ?`,
		amount, now, userID, itemID, amount,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return dao.ErrInsufficientStock
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO inventory_log(user_id, item_id, delta, reason, created_at) VALUES(?, ?, ?, ?, ?)`,
		userID, itemID, -amount, reason, now,
	); err != nil {
		return err
	}
	return tx.Commit()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanItem(s scanner) (dao.Item, error) {
	var (
		it         dao.Item
		precond    sql.NullString
		actionHint sql.NullString
		lastUsedAt sql.NullInt64
		expireAt   sql.NullInt64
	)
	if err := s.Scan(
		&it.ItemID, &it.Name, &it.Rarity, &it.CooldownSec, &it.EffectJSON,
		&precond, &actionHint, &it.Qty, &lastUsedAt, &expireAt,
	); err != nil {
		return dao.Item{}, err
	}
	if precond.Valid {
		v := precond.String
		it.Precondition = &v
	}
	if actionHint.Valid {
		it.ActionHint = actionHint.String
	}
	if lastUsedAt.Valid {
		v := lastUsedAt.Int64
		it.LastUsedAt = &v
	}
	if expireAt.Valid {
		v := expireAt.Int64
		it.ExpireAt = &v
	}
	return it, nil
}
