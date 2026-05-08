package impl

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type userDao struct{ db *sql.DB }

func (d *userDao) Upsert(ctx context.Context, u dao.User) (dao.User, error) {
	now := time.Now().Unix()
	if u.CreatedAt == 0 {
		u.CreatedAt = now
	}
	u.UpdatedAt = now
	_, err := d.db.ExecContext(ctx, `INSERT INTO users(id, zhihu_user_id, name, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			zhihu_user_id = excluded.zhihu_user_id,
			name          = excluded.name,
			updated_at    = excluded.updated_at`,
		u.ID, nullable(u.ZhihuUserID), u.Name, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return dao.User{}, err
	}
	return u, nil
}

func (d *userDao) Get(ctx context.Context, id string) (dao.User, error) {
	var u dao.User
	var zhihuID sql.NullString
	row := d.db.QueryRowContext(ctx, `SELECT id, zhihu_user_id, name, created_at, updated_at FROM users WHERE id = ?`, id)
	if err := row.Scan(&u.ID, &zhihuID, &u.Name, &u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dao.User{}, dao.ErrNotFound
		}
		return dao.User{}, err
	}
	if zhihuID.Valid {
		u.ZhihuUserID = zhihuID.String
	}
	return u, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
