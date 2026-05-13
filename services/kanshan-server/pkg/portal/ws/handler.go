// Package ws hosts websocket endpoints.
package ws

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
)

const defaultPushInterval = 60 * time.Second

// Handler hosts websocket streaming endpoints.
type Handler struct {
	svc      service.MarketService
	interval time.Duration
	upgrader websocket.Upgrader
}

type messageEnvelope struct {
	Type        string                  `json:"type"`
	IntervalSec int                     `json:"interval_sec,omitempty"`
	Data        *service.MarketSnapshot `json:"data,omitempty"`
	Error       string                  `json:"error,omitempty"`
}

// New builds a /ws handler with its own MarketService.
func New() *Handler {
	return &Handler{
		svc:      serviceimpl.NewMarketService(),
		interval: streamIntervalFromEnv(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Routes mounts websocket routes under a parent router.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/market", h.streamMarket)
}

func (h *Handler) streamMarket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "WS_UPGRADE_FAILED", err.Error(), nil)
		return
	}
	defer conn.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	if !h.writeSnapshot(conn, r.Context()) {
		return
	}

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-done:
			return
		case <-ticker.C:
			if !h.writeSnapshot(conn, r.Context()) {
				return
			}
		}
	}
}

func (h *Handler) writeSnapshot(conn *websocket.Conn, parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()

	snapshot, err := h.svc.Snapshot(ctx)
	if err != nil {
		return h.writeJSON(conn, messageEnvelope{
			Type:        "market_error",
			IntervalSec: int(h.interval / time.Second),
			Error:       err.Error(),
		})
	}

	return h.writeJSON(conn, messageEnvelope{
		Type:        "market_snapshot",
		IntervalSec: int(h.interval / time.Second),
		Data:        &snapshot,
	})
}

func (h *Handler) writeJSON(conn *websocket.Conn, v any) bool {
	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteJSON(v) == nil
}

func streamIntervalFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("MARKET_WS_PUSH_INTERVAL_SEC"))
	if raw == "" {
		return defaultPushInterval
	}
	sec, err := strconv.Atoi(raw)
	if err != nil || sec < 5 {
		return defaultPushInterval
	}
	return time.Duration(sec) * time.Second
}
