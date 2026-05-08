// Package dao defines the data access contracts for kanshan-server. Every
// concrete implementation lives in pkg/basic/dao/impl. By convention this
// package MUST NOT import database/sql or any SQL driver: the abstract
// boundary is what enforces "only dao/impl talks to SQL".
//
// Models in this package are plain Go structs that mirror the SQLite tables
// declared in db/migrations/0001_init.sql. They exist purely as a transport
// shape between the impl layer and the service layer; downstream packages
// should never embed driver-specific behavior into them.
package dao

import "context"

// ===== Models =====

// User mirrors the users table.
type User struct {
	ID          string
	ZhihuUserID string
	Name        string
	CreatedAt   int64
	UpdatedAt   int64
}

// Item mirrors items_catalog joined with the per-user user_items row.
// When a user has no row in user_items the impl returns Qty == 0.
type Item struct {
	ItemID               string
	Name                 string
	Rarity               string
	CooldownSec          int
	EffectJSON           string
	Precondition         *string
	ActionHint           string
	Qty                  int
	LastUsedAt           *int64
	ExpireAt             *int64
}

// PetState mirrors the pet_state table.
type PetState struct {
	UserID             string
	Hunger             int
	Happiness          int
	Energy             int
	Health             int
	Growth             int
	Mood               string
	Lifecycle          string
	LastTickAt         int64
	SickStartedAt      *int64
	RunawayStartedAt   *int64
}

// Task mirrors tasks_catalog joined with the per-user user_tasks row.
type Task struct {
	TaskID       string
	Type         string
	Name         string
	TargetCount  int
	RewardJSON   string
	TriggerEvent string
	DoneCount    int
	DoneAt       *int64
	Rewarded     bool
}

// StatsEvent mirrors a row in stats_event_log.
type StatsEvent struct {
	UserID     string
	EventType  string
	PayloadRaw string
	OccurredAt int64
}

// ===== Errors =====

// ErrNotFound is returned by Find/Get methods when the row is absent.
type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrNotFound      Error = "not found"
	ErrAlreadyExists Error = "already exists"
)

// ===== Interfaces =====

// UserDao persists users.
type UserDao interface {
	// Upsert inserts or refreshes a user keyed by ID. It returns the post-write row.
	Upsert(ctx context.Context, u User) (User, error)
	// Get returns the user with the given ID, or ErrNotFound.
	Get(ctx context.Context, id string) (User, error)
}

// ItemDao serves the inventory catalog joined with per-user holdings.
type ItemDao interface {
	// ListForUser returns the catalog with each row's Qty filled from user_items.
	ListForUser(ctx context.Context, userID string) ([]Item, error)
	// GetForUser returns one item by id with the per-user qty filled. ErrNotFound
	// means itemID is not in the catalog.
	GetForUser(ctx context.Context, userID, itemID string) (Item, error)
	// AdjustQty increments (or decrements when delta < 0) the per-user qty.
	// reason is recorded in inventory_log.
	AdjustQty(ctx context.Context, userID, itemID string, delta int, reason string) error
}

// PetStateDao persists the long-term pet state per user.
type PetStateDao interface {
	// Get returns the user's pet state, or ErrNotFound for fresh users.
	Get(ctx context.Context, userID string) (PetState, error)
	// Save inserts or updates the row.
	Save(ctx context.Context, p PetState) error
}

// TaskDao serves the task catalog joined with per-user progress.
type TaskDao interface {
	// ListForUser returns tasks filtered by period (empty period == all types)
	// with done_count filled from user_tasks for the given period_key.
	ListForUser(ctx context.Context, userID, periodType, periodKey string) ([]Task, error)
	// GetForUser returns one task with progress filled, or ErrNotFound.
	GetForUser(ctx context.Context, userID, taskID, periodKey string) (Task, error)
	// UpsertProgress writes the current progress and rewarded flag.
	UpsertProgress(ctx context.Context, userID, taskID, periodKey string, doneCount int, rewarded bool, doneAt *int64) error
}

// StatsDao persists raw events for later aggregation.
type StatsDao interface {
	// Append writes one event. Idempotency / aggregation is the service layer's job.
	Append(ctx context.Context, e StatsEvent) error
}
