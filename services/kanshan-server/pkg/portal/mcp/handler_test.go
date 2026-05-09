package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/distill"
)

func TestMCP_initialize(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	req.Header.Set("Content-Type", "application/json")
	New().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var res jsonRPCRes
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Error != nil {
		t.Fatalf("rpc error: %+v", res.Error)
	}
	m, ok := res.Result.(map[string]any)
	if !ok {
		t.Fatalf("result type %T", res.Result)
	}
	if m["protocolVersion"] != "2024-11-05" {
		t.Fatalf("protocolVersion got %#v", m["protocolVersion"])
	}
}

func TestMCP_toolsListContainsDistill(t *testing.T) {
	rec := httptest.NewRecorder()
	body := `{"jsonrpc":"2.0","id":"x","method":"tools/list"}`
	req := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	New().ServeHTTP(rec, req)
	var res struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	names := map[string]bool{}
	for _, tool := range res.Result.Tools {
		names[tool.Name] = true
	}
	for _, want := range []string{"distill_mock_corpus", "distill_profile", "distill_snippets", "secondme_user_info"} {
		if !names[want] {
			t.Fatalf("missing tool %q", want)
		}
	}
}

func TestMCP_distillProfile(t *testing.T) {
	items := []distill.CorpusItem{
		{ID: "1", Topic: "t", Title: "x", Excerpt: "e", Body: "首先 其次"},
	}
	call := map[string]any{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/call",
		"params": map[string]any{
			"name": "distill_profile",
			"arguments": map[string]any{
				"items": items,
			},
		},
	}
	raw, _ := json.Marshal(call)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/mcp", bytes.NewReader(raw))
	New().ServeHTTP(rec, req)
	var outer struct {
		Result map[string]any `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &outer); err != nil {
		t.Fatal(err)
	}
	content := outer.Result["content"].([]any)
	text := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "topic_clusters") || !strings.Contains(text, `"brief"`) {
		t.Fatalf("unexpected body: %s", text)
	}
}
