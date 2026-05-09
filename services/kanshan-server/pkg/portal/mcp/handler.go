// Package mcp implements JSON-RPC 2.0 MCP（Model Context Protocol）入口，对标兰亭序 lantingxu 的 POST /api/mcp：
// initialize、tools/list、tools/call。蒸馏工具直接调用 pkg/business/distill；secondme_user_info 转发 SecondMe Lab。
package mcp

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/business/distill"
)

const defaultSecondMeLabBase = "https://api.mindverse.com/gate/lab"

type jsonRPCReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonRPCRes struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      json.RawMessage  `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *jsonRPCErrorObj `json:"error,omitempty"`
}

type jsonRPCErrorObj struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpTool struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	InputSchema inputSchema `json:"inputSchema"`
}

type inputSchema struct {
	Type       string                 `json:"type"`
	Properties map[string]any         `json:"properties"`
	Required   []string               `json:"required,omitempty"`
}

var mcpTools = []mcpTool{
	{
		Name:        "secondme_user_info",
		Description: "OpenClaw/SecondMe：用请求头 Authorization Bearer 或 arguments.accessToken 查询 SecondMe 用户信息；稳定标识为 data.userId。需应用 scope user.info",
		InputSchema: inputSchema{
			Type: "object",
			Properties: map[string]any{
				"accessToken": map[string]string{"type": "string", "description": "可选；默认使用请求头 Authorization Bearer"},
			},
		},
	},
	{
		Name:        "distill_mock_corpus",
		Description: "返回演示用语料 JSON（与 GET /api/distill/mock-corpus 同源），用于蒸馏侧写前的素材占位",
		InputSchema: inputSchema{
			Type:       "object",
			Properties: map[string]any{},
		},
	},
	{
		Name:        "distill_profile",
		Description: "输入用户写作样本 items[]，输出话题聚类、风格提示、价值倾向等侧写 profile 与 brief 文本",
		InputSchema: inputSchema{
			Type: "object",
			Properties: map[string]any{
				"items": map[string]any{
					"type":        "array",
					"description": "CorpusItem：id, topic, title, excerpt, body",
					"items":       map[string]string{"type": "object"},
				},
			},
			Required: []string{"items"},
		},
	},
	{
		Name:        "distill_snippets",
		Description: "根据 question 从 items[] 中按字与二字片段重合度召回相关片段，用于分身对话上下文",
		InputSchema: inputSchema{
			Type: "object",
			Properties: map[string]any{
				"question": map[string]string{"type": "string", "description": "用户提问"},
				"items": map[string]any{
					"type":  "array",
					"items": map[string]string{"type": "object"},
				},
				"max_snippets": map[string]string{"type": "integer", "description": "最多片段数，默认 4"},
				"max_chars":    map[string]string{"type": "integer", "description": "每片段最大字数，默认 450"},
			},
			Required: []string{"question", "items"},
		},
	},
}

// Handler serves POST /api/mcp.
type Handler struct{}

// New builds an MCP handler.
func New() *Handler { return &Handler{} }

// ServeHTTP implements JSON-RPC MCP（仅 POST）。
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 405, "message": "Method Not Allowed"})
		return
	}

	var req jsonRPCReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRPCError(w, nil, -32700, "Parse error")
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		writeRPCError(w, req.ID, -32600, "Invalid Request")
		return
	}

	var result any
	switch req.Method {
	case "initialize":
		result = map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":  map[string]any{"tools": map[string]any{}},
			"serverInfo": map[string]any{
				"name":    "kanshan-distill",
				"version": "1.0.0",
			},
		}
	case "tools/list":
		result = map[string]any{"tools": mcpTools}
	case "tools/call":
		result = handleToolsCall(r, req.Params)
	default:
		writeRPCError(w, req.ID, -32601, "Method not found")
		return
	}

	_ = json.NewEncoder(w).Encode(jsonRPCRes{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  result,
	})
}

func writeRPCError(w http.ResponseWriter, id json.RawMessage, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(jsonRPCRes{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &jsonRPCErrorObj{Code: code, Message: msg},
	})
}

func handleToolsCall(r *http.Request, params json.RawMessage) any {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil || p.Name == "" {
		return mcpTextResult(`{"code":400,"message":"invalid tools/call params"}`, true)
	}

	token := bearerToken(r, p.Arguments)

	switch p.Name {
	case "secondme_user_info":
		if token == "" {
			return mcpTextResult(`{"code":400,"message":"missing bearer: set Authorization or arguments.accessToken"}`, true)
		}
		base := strings.TrimSuffix(os.Getenv("SECONDME_LAB_BASE_URL"), "/")
		if base == "" {
			base = defaultSecondMeLabBase
		}
		reqInfo, err := http.NewRequest(http.MethodGet, base+"/api/secondme/user/info", nil)
		if err != nil {
			return mcpTextResult(err.Error(), true)
		}
		reqInfo.Header.Set("Authorization", "Bearer "+token)
		resInfo, err := http.DefaultClient.Do(reqInfo)
		if err != nil {
			return mcpTextResult(err.Error(), true)
		}
		defer resInfo.Body.Close()
		body, _ := io.ReadAll(resInfo.Body)
		return mcpTextResult(string(body), resInfo.StatusCode >= 400)

	case "distill_mock_corpus":
		return mcpTextResult(string(distill.MockCorpusJSON), false)

	case "distill_profile":
		var args struct {
			Items []distill.CorpusItem `json:"items"`
		}
		if err := json.Unmarshal(p.Arguments, &args); err != nil || len(args.Items) == 0 {
			return mcpTextResult(`{"code":400,"message":"items must be a non-empty array"}`, true)
		}
		pr := distill.ExtractProfile(args.Items)
		out := map[string]any{
			"profile": pr,
			"brief":   distill.ProfileBrief(pr),
		}
		b, err := json.Marshal(out)
		if err != nil {
			return mcpTextResult(err.Error(), true)
		}
		return mcpTextResult(string(b), false)

	case "distill_snippets":
		var args struct {
			Question    string               `json:"question"`
			Items       []distill.CorpusItem `json:"items"`
			MaxSnippets int                  `json:"max_snippets"`
			MaxChars    int                  `json:"max_chars"`
		}
		if err := json.Unmarshal(p.Arguments, &args); err != nil {
			return mcpTextResult(`{"code":400,"message":"invalid arguments"}`, true)
		}
		if args.Question == "" || len(args.Items) == 0 {
			return mcpTextResult(`{"code":400,"message":"question and items are required"}`, true)
		}
		ms := args.MaxSnippets
		if ms <= 0 {
			ms = 4
		}
		mc := args.MaxChars
		if mc <= 0 {
			mc = 450
		}
		snippets := distill.PickSnippets(args.Question, args.Items, ms, mc)
		out := map[string]any{"snippets": snippets}
		b, err := json.Marshal(out)
		if err != nil {
			return mcpTextResult(err.Error(), true)
		}
		return mcpTextResult(string(b), false)

	default:
		b, _ := json.Marshal(map[string]any{"code": 400, "message": "unknown tool: " + p.Name})
		return mcpTextResult(string(b), true)
	}
}

func bearerToken(r *http.Request, arguments json.RawMessage) string {
	var a struct {
		AccessToken string `json:"accessToken"`
	}
	if len(arguments) > 0 {
		_ = json.Unmarshal(arguments, &a)
	}
	if a.AccessToken != "" {
		return a.AccessToken
	}
	if s := r.Header.Get("Authorization"); strings.HasPrefix(s, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(s, "Bearer "))
	}
	return ""
}

func mcpTextResult(text string, isError bool) any {
	return map[string]any{
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
		"isError": isError,
	}
}
