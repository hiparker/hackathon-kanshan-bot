package impl

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
)

// Package-level state. Init opens the SQLite file once and stores the live
// connection here; the NewXxxDao constructors below read it back. *sql.DB
// is intentionally *not* exported in any form — outside callers only see
// dao.* interfaces.
var (
	connOnce sync.Once
	connErr  error
	conn     *sql.DB
	connPath string
)

// Init opens the SQLite database and applies all embedded migrations. It is
// safe to call multiple times with the same path; subsequent calls are
// no-ops. Calling it with a different path returns an error so the program
// fails fast on misconfiguration.
//
// cmd/server/main.go is the only place expected to call this.
func Init(path string) error {
	connOnce.Do(func() {
		c, err := open(path)
		if err != nil {
			connErr = err
			return
		}
		if err := migrate(c); err != nil {
			_ = c.Close()
			connErr = err
			return
		}
		conn = c
		connPath = path
		slog.Info("dao initialised", "db_path", path)
	})
	if connErr != nil {
		return connErr
	}
	if connPath != path {
		return fmt.Errorf("dao/impl: already initialised with %q, refusing %q", connPath, path)
	}
	return nil
}

// Close releases the underlying connection. Safe to call multiple times.
// After Close the NewXxxDao constructors will panic.
func Close() error {
	if conn == nil {
		return nil
	}
	err := conn.Close()
	conn = nil
	return err
}

// mustConn returns the package-level connection or panics. A panic here is
// always a programming error: it means a service/portal layer asked for a
// dao before main.go had a chance to call Init, or after Close.
func mustConn() *sql.DB {
	if conn == nil {
		panic("dao/impl: Init not called or Close has been called")
	}
	return conn
}

// NewUserDao returns a dao.UserDao backed by the package-level connection.
func NewUserDao() dao.UserDao { return &userDao{db: mustConn()} }

// NewItemDao returns a dao.ItemDao backed by the package-level connection.
func NewItemDao() dao.ItemDao { return &itemDao{db: mustConn()} }

// NewPetStateDao returns a dao.PetStateDao backed by the package-level connection.
func NewPetStateDao() dao.PetStateDao { return &petStateDao{db: mustConn()} }

// NewTaskDao returns a dao.TaskDao backed by the package-level connection.
func NewTaskDao() dao.TaskDao { return &taskDao{db: mustConn()} }

// NewInteractionCountDao returns a dao.InteractionCountDao backed by the package-level connection.
func NewInteractionCountDao() dao.InteractionCountDao { return &interactionCountDao{db: mustConn()} }

// NewStatsDao returns a dao.StatsDao backed by the package-level connection.
func NewStatsDao() dao.StatsDao { return &statsDao{db: mustConn()} }

// NewChatHistoryDao returns a dao.ChatHistoryDao backed by the package-level connection.
func NewChatHistoryDao() dao.ChatHistoryDao { return &chatHistoryDao{db: mustConn()} }
