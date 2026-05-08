// Package httpx provides shared helpers for JSON responses and the unified
// error envelope defined in planning/backend-rfc.md §8.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorBody is the canonical error envelope returned by every handler.
type ErrorBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type errorResponse struct {
	Error ErrorBody `json:"error"`
}

// WriteJSON writes v as JSON with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json failed", "err", err)
	}
}

// WriteError writes a structured error envelope.
func WriteError(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	WriteJSON(w, status, errorResponse{
		Error: ErrorBody{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}

// DecodeJSON decodes the request body into v. On failure it writes a
// BAD_REQUEST envelope and returns false.
func DecodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Body == nil {
		WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "empty body", nil)
		return false
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		WriteError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error(), nil)
		return false
	}
	return true
}
