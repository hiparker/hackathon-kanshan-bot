// Package impl is the only place in the module that imports database/sql
// and the SQLite driver. The public surface is intentionally small:
//   - Init(path) / Close()       — lifecycle, called by cmd/server/main.go
//   - NewXxxDao()                — factories that return dao.* interfaces
//
// *sql.DB never leaves this package.
package impl

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// open dials a SQLite database with sane defaults for a single-process
// server (WAL journaling, foreign keys, busy timeout).
func open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", path)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	return conn, nil
}
