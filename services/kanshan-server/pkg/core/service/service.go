// Package service defines the business-assurance + data-secondary-processing
// contracts that sit between portal handlers and the dao layer. It lives
// under pkg/core because the kanshan-server family treats the service layer
// as the cross-cutting "core" of the program: portal calls into it, and it
// is the only layer allowed to compose dao + business packages.
//
// This package depends only on pkg/basic/dao (for model shapes) and never
// on database/sql.
package service

import "context"

// ===== Errors =====

// Error is a typed sentinel error returned by services so portal handlers
// can map it to a stable HTTP code without depending on dao internals.
type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrUnauthorized              Error = "UNAUTHORIZED"
	ErrBadRequest                Error = "BAD_REQUEST"
	ErrInventoryInsufficient     Error = "INVENTORY_INSUFFICIENT"
	ErrInventoryPreconditionFail Error = "INVENTORY_PRECONDITION_FAILED"
	ErrInventoryCooldown         Error = "INVENTORY_COOLDOWN"
	ErrTaskNotFound              Error = "TASK_NOT_FOUND"
	ErrInternal                  Error = "INTERNAL"
)

// ===== Auth =====

// AuthSession is the result of a successful sign-in.
type AuthSession struct {
	UserID       string
	SessionToken string
	ExpiresAt    int64
}

// AuthService handles login + session minting.
type AuthService interface {
	SignIn(ctx context.Context, code string) (AuthSession, error)
}

// ===== Inventory =====

// InventoryItem is the user-facing item shape after secondary processing.
type InventoryItem struct {
	ItemID               string
	Name                 string
	Qty                  int
	Rarity               string
	CooldownRemainingSec int
	ExpireAt             *int64
	ActionHint           string
	Precondition         *string
}

// UseResult is what InventoryService.Use returns.
type UseResult struct {
	NewState   PetSnapshot
	ActionHint string
}

// InventoryService validates use-conditions, decrements qty, applies effects.
type InventoryService interface {
	List(ctx context.Context, userID string) ([]InventoryItem, error)
	Use(ctx context.Context, userID, itemID string) (UseResult, error)
	// Deduct removes qty without pet precondition checks (crafting, shop, batch consume).
	// reason is stored in inventory_log (empty defaults to "deduct").
	Deduct(ctx context.Context, userID, itemID string, qty int, reason string) (InventoryItem, error)
	// Restock adds qty (task rewards, purchase). Empty reason defaults to "restock".
	Restock(ctx context.Context, userID, itemID string, qty int, reason string) (InventoryItem, error)
}

// ===== Pet state =====

// PetSnapshot is the user-facing pet state shape.
type PetSnapshot struct {
	UserID     string
	Hunger     int
	Happiness  int
	Energy     int
	Health     int
	Growth     int
	Mood       string
	Lifecycle  string
	LastTickAt int64
}

// PetStateService owns pet state read/tick semantics.
type PetStateService interface {
	Get(ctx context.Context, userID string) (PetSnapshot, error)
	Tick(ctx context.Context, userID string) (PetSnapshot, error)
	// CompleteItemUse applies decay, validates precondition, runs decrement (typically
	// inventory deduct), merges effect_json into pet, and saves. decrement is skipped
	// if precondition fails after decay.
	CompleteItemUse(ctx context.Context, userID string, precondition *string, effectJSON string, decrement func() error) (PetSnapshot, error)
}

// ===== Tasks =====

// Reward describes a single reward instance.
type Reward struct {
	Kind   string
	ItemID string
	Qty    int
}

// TaskView is the user-facing task shape.
type TaskView struct {
	TaskID       string
	Type         string
	Name         string
	TargetCount  int
	DoneCount    int
	Rewards      []Reward
	TriggerEvent string
}

// ProgressResult is what TaskService.Progress returns.
type ProgressResult struct {
	Task           TaskView
	RewardsGranted []Reward
}

// TaskService owns task listing and progress accounting.
type TaskService interface {
	List(ctx context.Context, userID, period string) ([]TaskView, error)
	Progress(ctx context.Context, userID, taskID string, delta int) (ProgressResult, error)
}

// ===== Stats =====

// StatsEventInput is the user-facing event shape.
type StatsEventInput struct {
	Type    string
	Payload map[string]any
	TS      int64
}

// StatsService owns event ingestion and (in P1) implicit task progression.
type StatsService interface {
	Event(ctx context.Context, userID string, e StatsEventInput) error
}
