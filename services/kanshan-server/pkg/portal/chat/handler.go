// Package chat hosts the authenticated LLM chat proxy.
package chat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
	serviceimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/portal/errx"
)

const (
	defaultZhihuChatURL   = "https://developer.zhihu.com/v1/chat/completions"
	defaultZhihuChatModel = "zhida-fast-1p5"
	defaultZhihuTimeout   = 45 * time.Second
)

type Handler struct {
	petSvc service.PetStateService
	client *http.Client
}

func New() *Handler {
	return &Handler{
		petSvc: serviceimpl.NewPetStateService(),
		client: &http.Client{Timeout: chatTimeout()},
	}
}

func (h *Handler) Routes(r chi.Router) {
	r.Post("/completions", h.completions)
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type completionRequest struct {
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

func (h *Handler) completions(w http.ResponseWriter, r *http.Request) {
	var req completionRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Messages) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, string(service.ErrBadRequest), "messages must not be empty", nil)
		return
	}
	if !validMessages(req.Messages) {
		httpx.WriteError(w, http.StatusBadRequest, string(service.ErrBadRequest), "messages contain invalid role or empty content", nil)
		return
	}

	userID := session.UserID(r.Context())
	pet, err := h.petSvc.Tick(r.Context(), userID)
	if err != nil {
		errx.WriteServiceError(w, err, nil)
		return
	}
	if pet.Spirit <= 0 {
		httpx.WriteError(w, http.StatusConflict, string(service.ErrPetActionNotAllowed), "看山现在没有精神聊天，先让它休息或补充精力吧。", map[string]any{"spirit": pet.Spirit})
		return
	}

	upstreamBody := map[string]any{
		"model":    envOr("ZHIHU_CHAT_MODEL", defaultZhihuChatModel),
		"stream":   req.Stream,
		"messages": normalizeMessagesForUpstream(req.Messages, mergeSystemToUser()),
	}
	payload, err := json.Marshal(upstreamBody)
	if err != nil {
		errx.WriteServiceError(w, service.ErrInternal, nil)
		return
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, envOr("ZHIHU_CHAT_COMPLETIONS_URL", defaultZhihuChatURL), bytes.NewReader(payload))
	if err != nil {
		errx.WriteServiceError(w, service.ErrInternal, nil)
		return
	}
	accessSecret := strings.TrimSpace(os.Getenv("ZHIHU_CHAT_ACCESS_SECRET"))
	if accessSecret == "" {
		httpx.WriteError(w, http.StatusInternalServerError, string(service.ErrInternal), "chat access secret is not configured", nil)
		return
	}
	upstreamReq.Header.Set("Content-Type", "application/json")
	upstreamReq.Header.Set("Authorization", "Bearer "+accessSecret)
	upstreamReq.Header.Set("X-Request-Timestamp", fmt.Sprintf("%d", time.Now().Unix()))

	res, err := h.client.Do(upstreamReq)
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, string(service.ErrInternal), "chat upstream request failed", map[string]any{"error": err.Error()})
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		httpx.WriteError(w, http.StatusBadGateway, string(service.ErrInternal), "chat upstream returned error", map[string]any{
			"upstream_status": res.StatusCode,
			"upstream_body":   strings.TrimSpace(string(body)),
		})
		return
	}

	for key, values := range res.Header {
		if !shouldForwardHeader(key) {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(res.StatusCode)
	if err := copyAndFlush(w, res.Body); err != nil {
		return
	}
}

func copyAndFlush(w http.ResponseWriter, r io.Reader) error {
	flusher, _ := w.(http.Flusher)
	buffer := make([]byte, 4096)
	for {
		n, readErr := r.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}

func validMessages(messages []chatMessage) bool {
	for _, message := range messages {
		switch message.Role {
		case "system", "user", "assistant":
		default:
			return false
		}
		if strings.TrimSpace(message.Content) == "" {
			return false
		}
	}
	return true
}

func normalizeMessagesForUpstream(messages []chatMessage, mergeSystem bool) []chatMessage {
	if !mergeSystem {
		return messages
	}

	systemPrompts := make([]string, 0, 1)
	out := make([]chatMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role == "system" {
			systemPrompts = append(systemPrompts, strings.TrimSpace(message.Content))
			continue
		}
		out = append(out, message)
	}
	if len(systemPrompts) == 0 || len(out) == 0 {
		return out
	}

	prefix := "系统要求：\n" + strings.Join(systemPrompts, "\n\n") + "\n\n用户消息：\n"
	for i, message := range out {
		if message.Role == "user" {
			out[i].Content = prefix + message.Content
			return out
		}
	}
	out[0].Content = prefix + out[0].Content
	return out
}

func shouldForwardHeader(key string) bool {
	switch strings.ToLower(key) {
	case "content-type", "cache-control", "x-request-id":
		return true
	default:
		return false
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func chatTimeout() time.Duration {
	value := strings.TrimSpace(os.Getenv("ZHIHU_CHAT_TIMEOUT_SEC"))
	if value == "" {
		return defaultZhihuTimeout
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return defaultZhihuTimeout
	}
	return time.Duration(seconds) * time.Second
}

func mergeSystemToUser() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ZHIHU_CHAT_MERGE_SYSTEM_TO_USER")))
	if value == "" {
		return true
	}
	return value == "1" || value == "true" || value == "yes" || value == "on" || value == "y"
}
