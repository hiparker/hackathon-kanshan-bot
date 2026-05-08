// Command server is the kanshan-server entry point. It only owns three
// concerns: configuration (flag/env/log), bootstrapping the dao layer
// (so that all package-level singletons are wired against a live SQLite
// connection), and running the HTTP server. service / dao instances are
// constructed by the layers that need them, not here.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "run migrations and exit")
	flag.Parse()

	logger := newLogger(os.Getenv("LOG_LEVEL"))
	slog.SetDefault(logger)

	dbPath := envOr("DB_PATH", "./kanshan.db")
	port := envOr("PORT", "8787")

	if err := daoimpl.Init(dbPath); err != nil {
		logger.Error("dao init failed", "err", err, "path", dbPath)
		os.Exit(1)
	}
	defer daoimpl.Close()

	if *migrateOnly {
		return
	}

	addr := ":" + port
	srv := &http.Server{
		Addr:              addr,
		Handler:           portal.New(logger),
		ReadHeaderTimeout: 10 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("kanshan-server listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		logger.Error("server crashed", "err", err)
		os.Exit(1)
	case sig := <-stop:
		logger.Info("shutting down", "signal", sig.String())
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
