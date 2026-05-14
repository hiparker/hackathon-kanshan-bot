package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type fakePetStateService struct {
	pet service.PetSnapshot
	err error
}

type fakeChatHistoryDao struct {
	turns    []dao.ChatTurn
	appended []dao.ChatTurn
}

func (d *fakeChatHistoryDao) ListRecent(context.Context, string, int) ([]dao.ChatTurn, error) {
	return d.turns, nil
}

func (d *fakeChatHistoryDao) Append(_ context.Context, userID, query, answer string, _ int) (dao.ChatTurn, error) {
	turn := dao.ChatTurn{ID: int64(len(d.appended) + 1), UserID: userID, Query: query, Answer: answer}
	d.appended = append(d.appended, turn)
	return turn, nil
}

func TestNormalizeMessagesCanKeepSystemRole(t *testing.T) {
	messages := []chatMessage{
		{Role: "system", Content: "short"},
		{Role: "user", Content: "hi"},
	}

	got := normalizeMessagesForUpstream(messages, false)

	if len(got) != 2 || got[0].Role != "system" || got[1].Role != "user" {
		t.Fatalf("unexpected messages: %+v", got)
	}
}

func (s fakePetStateService) Get(context.Context, string) (service.PetSnapshot, error) {
	return s.pet, s.err
}

func (s fakePetStateService) Tick(context.Context, string) (service.PetSnapshot, error) {
	return s.pet, s.err
}

func (s fakePetStateService) Interact(context.Context, string, string) (service.PetInteractionResult, error) {
	return service.PetInteractionResult{}, service.ErrBadRequest
}

func (s fakePetStateService) ApplyTaskEffect(context.Context, string, string) (service.PetInteractionResult, error) {
	return service.PetInteractionResult{}, service.ErrBadRequest
}

func (s fakePetStateService) DebugSetState(context.Context, string, service.PetDebugStateInput) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, service.ErrBadRequest
}

func (s fakePetStateService) CompleteItemUse(context.Context, string, *string, string, func() error) (service.PetSnapshot, error) {
	return service.PetSnapshot{}, service.ErrBadRequest
}

func TestCompletionsRejectsZeroSpirit(t *testing.T) {
	t.Setenv("ZHIHU_CHAT_ACCESS_SECRET", "test-secret")
	h := &Handler{history: &fakeChatHistoryDao{}, petSvc: fakePetStateService{pet: service.PetSnapshot{UserID: "u1", Spirit: 0}}, client: http.DefaultClient}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/completions", strings.NewReader(`{"stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")

	h.completions(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
}

func TestCompletionsForwardsAuthHeaders(t *testing.T) {
	var gotAuth string
	var gotTimestamp string
	var gotBody completionRequest
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotTimestamp = r.Header.Get("X-Request-Timestamp")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"))
	}))
	defer upstream.Close()

	t.Setenv("ZHIHU_CHAT_COMPLETIONS_URL", upstream.URL)
	t.Setenv("ZHIHU_CHAT_ACCESS_SECRET", "test-secret")
	history := &fakeChatHistoryDao{turns: []dao.ChatTurn{{Query: "old q", Answer: "old a"}}}
	h := &Handler{history: history, petSvc: fakePetStateService{pet: service.PetSnapshot{UserID: "u1", Spirit: 1}}, client: upstream.Client()}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/chat/completions", strings.NewReader(`{"stream":true,"messages":[{"role":"system","content":"short"},{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")

	h.completions(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if gotAuth != "Bearer test-secret" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if gotTimestamp == "" {
		t.Fatal("X-Request-Timestamp is empty")
	}
	if len(gotBody.Messages) != 3 || gotBody.Messages[0].Role != "user" || gotBody.Messages[1].Role != "assistant" || gotBody.Messages[2].Role != "user" {
		t.Fatalf("unexpected upstream messages: %+v", gotBody.Messages)
	}
	if !strings.Contains(gotBody.Messages[0].Content, "short") || !strings.Contains(gotBody.Messages[0].Content, "old q") || !strings.Contains(gotBody.Messages[2].Content, "hi") {
		t.Fatalf("unexpected upstream content: %+v", gotBody.Messages)
	}
	if len(history.appended) != 1 || history.appended[0].Query != "hi" || history.appended[0].Answer != "hi" {
		t.Fatalf("unexpected appended history: %+v", history.appended)
	}
}

func TestRouterRequiresSession(t *testing.T) {
	t.Setenv("ZHIHU_CHAT_ACCESS_SECRET", "test-secret")
	r := chi.NewRouter()
	r.Use(session.Required)
	(&Handler{history: &fakeChatHistoryDao{}, petSvc: fakePetStateService{pet: service.PetSnapshot{UserID: "u1", Spirit: 1}}, client: http.DefaultClient}).Routes(r)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/completions", strings.NewReader(`{"stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}
