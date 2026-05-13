// Package chat hosts the authenticated LLM chat proxy.
package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
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
	history dao.ChatHistoryDao
	petSvc  service.PetStateService
	client  *http.Client
}

func New() *Handler {
	return &Handler{
		history: daoimpl.NewChatHistoryDao(),
		petSvc:  serviceimpl.NewPetStateService(),
		client:  &http.Client{Timeout: chatTimeout()},
	}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/history", h.historyList)
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

type chatTurnResponse struct {
	ID        int64  `json:"id"`
	Query     string `json:"query"`
	Answer    string `json:"answer"`
	CreatedAt int64  `json:"created_at"`
}

type historyResponse struct {
	Turns []chatTurnResponse `json:"turns"`
}

func (h *Handler) historyList(w http.ResponseWriter, r *http.Request) {
	userID := session.UserID(r.Context())
	turns, err := h.history.ListRecent(r.Context(), userID, chatHistoryLimit())
	if err != nil {
		errx.WriteServiceError(w, service.ErrInternal, nil)
		return
	}
	out := make([]chatTurnResponse, 0, len(turns))
	for _, turn := range turns {
		out = append(out, toChatTurnResponse(turn))
	}
	httpx.WriteJSON(w, http.StatusOK, historyResponse{Turns: out})
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

	userQuery := latestUserQuery(req.Messages)
	upstreamMessages, err := h.buildMessages(r.Context(), userID, req.Messages)
	if err != nil {
		errx.WriteServiceError(w, service.ErrInternal, nil)
		return
	}
	upstreamBody := map[string]any{
		"model":    envOr("ZHIHU_CHAT_MODEL", defaultZhihuChatModel),
		"stream":   req.Stream,
		"messages": normalizeMessagesForUpstream(upstreamMessages, mergeSystemToUser()),
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
	answer, err := copyAndFlush(w, res.Body)
	if err != nil {
		return
	}
	h.appendHistory(r.Context(), userID, userQuery, answer)
}

func (h *Handler) buildMessages(ctx context.Context, userID string, messages []chatMessage) ([]chatMessage, error) {
	turns, err := h.history.ListRecent(ctx, userID, chatHistoryLimit())
	if err != nil {
		return nil, err
	}
	out := make([]chatMessage, 0, len(messages)+len(turns)*2)
	inserted := false
	for _, message := range messages {
		out = append(out, message)
		if !inserted && message.Role == "system" {
			out = append(out, turnsToMessages(turns)...)
			inserted = true
		}
	}
	if !inserted {
		out = append(turnsToMessages(turns), out...)
	}
	return out, nil
}

func turnsToMessages(turns []dao.ChatTurn) []chatMessage {
	out := make([]chatMessage, 0, len(turns)*2)
	for _, turn := range turns {
		out = append(out,
			chatMessage{Role: "user", Content: turn.Query},
			chatMessage{Role: "assistant", Content: turn.Answer},
		)
	}
	return out
}

func (h *Handler) appendHistory(ctx context.Context, userID, query, answer string) {
	query = strings.TrimSpace(query)
	answer = strings.TrimSpace(answer)
	if query == "" || answer == "" {
		return
	}
	_, _ = h.history.Append(ctx, userID, query, answer, chatHistoryLimit())
}

func copyAndFlush(w http.ResponseWriter, r io.Reader) (string, error) {
	flusher, _ := w.(http.Flusher)
	buffer := make([]byte, 4096)
	var sseBuffer string
	var answer strings.Builder
	for {
		n, readErr := r.Read(buffer)
		if n > 0 {
			chunk := string(buffer[:n])
			sseBuffer = consumeSSEBuffer(sseBuffer+chunk, func(text string) {
				answer.WriteString(text)
			})
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return answer.String(), writeErr
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				if strings.TrimSpace(sseBuffer) != "" {
					consumeSSEBuffer(sseBuffer+"\n\n", func(text string) {
						answer.WriteString(text)
					})
				}
				return answer.String(), nil
			}
			return answer.String(), readErr
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

func latestUserQuery(messages []chatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func consumeSSEBuffer(buffer string, onText func(string)) string {
	parts := strings.Split(buffer, "\n\n")
	nextBuffer := parts[len(parts)-1]
	for _, part := range parts[:len(parts)-1] {
		payloadLines := make([]string, 0, 1)
		for _, line := range strings.Split(part, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "data:") {
				payloadLines = append(payloadLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		payload := strings.Join(payloadLines, "\n")
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk streamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if text := chunk.Choices[0].Delta.Content; text != "" {
			onText(text)
		}
	}
	return nextBuffer
}

func toChatTurnResponse(turn dao.ChatTurn) chatTurnResponse {
	return chatTurnResponse{
		ID:        turn.ID,
		Query:     turn.Query,
		Answer:    turn.Answer,
		CreatedAt: turn.CreatedAt,
	}
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

func chatHistoryLimit() int {
	value := strings.TrimSpace(os.Getenv("ZHIHU_CHAT_HISTORY_LIMIT"))
	if value == "" {
		return 10
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return 10
	}
	if limit > 50 {
		return 50
	}
	return limit
}
