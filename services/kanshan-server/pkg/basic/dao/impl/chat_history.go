package impl

import (
	"context"
	"database/sql"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

type chatHistoryDao struct{ db *sql.DB }

func (d *chatHistoryDao) ListRecent(ctx context.Context, userID string, limit int) ([]dao.ChatTurn, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := d.db.QueryContext(ctx, `SELECT id, user_id, query, answer, created_at, updated_at
		FROM chat_turns
		WHERE user_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	turns := make([]dao.ChatTurn, 0, limit)
	for rows.Next() {
		turn, err := scanChatTurn(rows)
		if err != nil {
			return nil, err
		}
		turns = append(turns, turn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for left, right := 0, len(turns)-1; left < right; left, right = left+1, right-1 {
		turns[left], turns[right] = turns[right], turns[left]
	}
	return turns, nil
}

func (d *chatHistoryDao) Append(ctx context.Context, userID, query, answer string, keep int) (dao.ChatTurn, error) {
	if keep <= 0 {
		keep = 10
	}
	now := time.Now().Unix()
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return dao.ChatTurn{}, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `INSERT INTO chat_turns(user_id, query, answer, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?)`, userID, query, answer, now, now)
	if err != nil {
		return dao.ChatTurn{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return dao.ChatTurn{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_turns
		WHERE user_id = ?
		AND id NOT IN (
			SELECT id FROM chat_turns
			WHERE user_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		)`, userID, userID, keep); err != nil {
		return dao.ChatTurn{}, err
	}
	if err := tx.Commit(); err != nil {
		return dao.ChatTurn{}, err
	}
	return dao.ChatTurn{ID: id, UserID: userID, Query: query, Answer: answer, CreatedAt: now, UpdatedAt: now}, nil
}

func scanChatTurn(scanner scanner) (dao.ChatTurn, error) {
	var turn dao.ChatTurn
	if err := scanner.Scan(&turn.ID, &turn.UserID, &turn.Query, &turn.Answer, &turn.CreatedAt, &turn.UpdatedAt); err != nil {
		return dao.ChatTurn{}, err
	}
	return turn, nil
}
