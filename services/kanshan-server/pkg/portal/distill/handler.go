// Package distill exposes /api/distill/* for 「蒸馏自己」侧写与片段召回（供 MCP 或其他客户端调用，非浏览器专属）。
package distill

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/distill"
)

// Handler hosts /api/distill routes (mounted under authenticated /api).
type Handler struct{}

// New builds a distill handler.
func New() *Handler { return &Handler{} }

// Routes mounts /api/distill.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/mock-corpus", h.mockCorpus)
	r.Post("/profile", h.profile)
	r.Post("/snippets", h.snippets)
}

func (h *Handler) mockCorpus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(distill.MockCorpusJSON)
}

type profileRequest struct {
	Items []distill.CorpusItem `json:"items"`
}

type profileResponse struct {
	Profile distill.Profile `json:"profile"`
	Brief   string            `json:"brief"`
}

func (h *Handler) profile(w http.ResponseWriter, r *http.Request) {
	var req profileRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Items) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "items must not be empty", nil)
		return
	}
	p := distill.ExtractProfile(req.Items)
	httpx.WriteJSON(w, http.StatusOK, profileResponse{
		Profile: p,
		Brief:   distill.ProfileBrief(p),
	})
}

type snippetsRequest struct {
	Question    string               `json:"question"`
	Items       []distill.CorpusItem `json:"items"`
	MaxSnippets int                  `json:"max_snippets"`
	MaxChars    int                  `json:"max_chars"`
}

type snippetsResponse struct {
	Snippets []distill.Snippet `json:"snippets"`
}

func (h *Handler) snippets(w http.ResponseWriter, r *http.Request) {
	var req snippetsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Question == "" {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "question is required", nil)
		return
	}
	if len(req.Items) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "items must not be empty", nil)
		return
	}
	ms := req.MaxSnippets
	if ms <= 0 {
		ms = 4
	}
	mc := req.MaxChars
	if mc <= 0 {
		mc = 450
	}
	s := distill.PickSnippets(req.Question, req.Items, ms, mc)
	httpx.WriteJSON(w, http.StatusOK, snippetsResponse{Snippets: s})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "empty body", nil)
		return false
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error(), nil)
		return false
	}
	return true
}
