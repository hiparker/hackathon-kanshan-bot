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
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/inventory"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/state"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/stats"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/task"
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
		AllowedHeaders:   []string{"Content-Type", session.Header},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", health)

	r.Route("/api/auth", auth.New().Routes)

	r.Route("/api", func(r chi.Router) {
		r.Use(session.Required)
		r.Route("/inventory", inventory.New().Routes)
		r.Route("/pet", state.New().Routes)
		r.Route("/tasks", task.New().Routes)
		r.Route("/stats", stats.New().Routes)
	})

	logger.Info("router ready",
		"routes", []string{
			"GET /healthz",
			"POST /api/auth/zhihu",
			"GET /api/inventory",
			"POST /api/inventory/use",
			"GET /api/pet/state",
			"POST /api/pet/state/tick",
			"GET /api/tasks",
			"POST /api/tasks/progress",
			"POST /api/stats/event",
		},
	)
	return r
}
