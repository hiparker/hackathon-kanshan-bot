// Package portal is the external HTTP interface. It wires every handler
// together via chi and is the only place that knows the full route tree.
// Each sub-package's handler is parameterless: it self-wires its own
// service.* dependency through pkg/core/service/impl. Handlers MUST NOT
// import database/sql or any dao impl.
package portal

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/auth"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/chat"
	distillportal "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/distill"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/inventory"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/mcp"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/state"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/stats"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/task"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/ws"
)

// New builds the chi router with middleware, /healthz, /api/auth and the
// authenticated /api subtree. cmd/server/main.go must have called
// daoimpl.Init prior to invoking New, otherwise handler construction will
// panic on first dao access.
func New(logger *slog.Logger) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Heartbeat("/ping"))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", session.Header, "Authorization"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", health)
	r.Route("/ws", ws.New().Routes)

	r.Route("/api/auth", auth.New().Routes)

	// MCP（JSON-RPC）：无会话依赖，便于 OpenClaw / Cursor 直连；蒸馏工具与 /api/distill/* 同源逻辑。
	r.Post("/api/mcp", mcp.New().ServeHTTP)

	r.Route("/api", func(r chi.Router) {
		r.Use(session.Required)
		r.Route("/inventory", inventory.New().Routes)
		r.Route("/pet", state.New().Routes)
		r.Route("/tasks", task.New().Routes)
		r.Route("/stats", stats.New().Routes)
		r.Route("/distill", distillportal.New().Routes)
		r.Route("/chat", chat.New().Routes)
	})

	logger.Info("router ready",
		"routes", []string{
			"GET /healthz",
			"GET /ws/market",
			"GET /api/auth/zhihu/login",
			"GET /api/auth/zhihu/callback",
			"POST /api/auth/zhihu",
			"GET /api/auth/me",
			"POST /api/mcp",
			"GET /api/inventory",
			"POST /api/inventory/use",
			"POST /api/inventory/deduct",
			"POST /api/inventory/restock",
			"GET /api/pet/state",
			"POST /api/pet/state/tick",
			"POST /api/pet/interact",
			"POST /api/pet/debug/state",
			"GET /api/tasks",
			"POST /api/tasks/progress",
			"POST /api/stats/event",
			"GET /api/distill/mock-corpus",
			"POST /api/distill/profile",
			"POST /api/distill/snippets",
			"POST /api/chat/completions",
		},
	)
	return r
}
