package impl

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type petStateDao struct{ db *sql.DB }

func (d *petStateDao) Get(ctx context.Context, userID string) (dao.PetState, error) {
	var (
		p         dao.PetState
		sickAt    sql.NullInt64
		runawayAt sql.NullInt64
	)
	row := d.db.QueryRowContext(ctx, `SELECT user_id, hunger, happiness, energy, health, growth, mood, lifecycle, last_tick_at, sick_started_at, runaway_started_at
		FROM pet_state WHERE user_id = ?`, userID)
	if err := row.Scan(&p.UserID, &p.Hunger, &p.Happiness, &p.Energy, &p.Health, &p.Growth, &p.Mood, &p.Lifecycle, &p.LastTickAt, &sickAt, &runawayAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dao.PetState{}, dao.ErrNotFound
		}
		return dao.PetState{}, err
	}
	if sickAt.Valid {
		v := sickAt.Int64
		p.SickStartedAt = &v
	}
	if runawayAt.Valid {
		v := runawayAt.Int64
		p.RunawayStartedAt = &v
	}
	return p, nil
}

func (d *petStateDao) Save(ctx context.Context, p dao.PetState) error {
	now := time.Now().Unix()
	_, err := d.db.ExecContext(ctx, `INSERT INTO pet_state(user_id, hunger, happiness, energy, health, growth, mood, lifecycle, last_tick_at, sick_started_at, runaway_started_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			hunger             = excluded.hunger,
			happiness          = excluded.happiness,
			energy             = excluded.energy,
			health             = excluded.health,
			growth             = excluded.growth,
			mood               = excluded.mood,
			lifecycle          = excluded.lifecycle,
			last_tick_at       = excluded.last_tick_at,
			sick_started_at    = excluded.sick_started_at,
			runaway_started_at = excluded.runaway_started_at,
			updated_at         = excluded.updated_at`,
		p.UserID, p.Hunger, p.Happiness, p.Energy, p.Health, p.Growth, p.Mood, p.Lifecycle, p.LastTickAt,
		nullableInt64(p.SickStartedAt), nullableInt64(p.RunawayStartedAt), now,
	)
	return err
}

func nullableInt64(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}
