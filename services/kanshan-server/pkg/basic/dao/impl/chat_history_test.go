package impl

import (
	"context"
	"path/filepath"
	"testing"
)

func TestChatHistoryAppendKeepsRecentTurns(t *testing.T) {
	db, err := open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	d := &chatHistoryDao{db: db}
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `INSERT INTO users(id, zhihu_user_id, name, created_at, updated_at) VALUES('u1', 'z1', 'u1', 1, 1)`); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 12; i++ {
		if _, err := d.Append(ctx, "u1", "q"+string(rune('a'+i)), "a"+string(rune('a'+i)), 10); err != nil {
			t.Fatal(err)
		}
	}

	turns, err := d.ListRecent(ctx, "u1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 10 {
		t.Fatalf("len = %d, want 10", len(turns))
	}
	if turns[0].Query != "qc" || turns[9].Query != "ql" {
		t.Fatalf("unexpected chronological turns: first=%q last=%q", turns[0].Query, turns[9].Query)
	}
}
