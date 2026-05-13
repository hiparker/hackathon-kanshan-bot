// Package db is a thin data-only package that exposes the SQL migration
// files as an embedded filesystem. It contains zero runtime logic and zero
// imports of database/sql; only pkg/basic/dao/impl is allowed to consume
// these bytes against a real database.
package db

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS

// MigrationsDir is the directory inside Migrations where the *.sql files live.
const MigrationsDir = "migrations"
