// Package errx is the portal-side bridge between core/service.Error
// sentinels and the canonical HTTP error envelope from
// pkg/basic/util/httpx.
//
// It lives under pkg/portal (not pkg/basic) so that pkg/basic stays free
// of any dependency on pkg/core/service: the dependency direction is
// strictly portal → core/service → basic/dao.
package errx

import (
	"errors"
	"net/http"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

// WriteServiceError translates a service.Error sentinel into the canonical
// HTTP envelope defined in planning/backend-rfc.md §8. Non-service errors
// fall through as INTERNAL. Portal handlers can stay one-liners on the
// error path.
func WriteServiceError(w http.ResponseWriter, err error, details map[string]any) {
	var se service.Error
	if !errors.As(err, &se) {
		httpx.WriteError(w, http.StatusInternalServerError, string(service.ErrInternal), err.Error(), details)
		return
	}
	switch se {
	case service.ErrUnauthorized:
		httpx.WriteError(w, http.StatusUnauthorized, string(se), "missing or invalid session", details)
	case service.ErrBadRequest:
		httpx.WriteError(w, http.StatusBadRequest, string(se), "bad request", details)
	case service.ErrInventoryInsufficient:
		httpx.WriteError(w, http.StatusConflict, string(se), "inventory insufficient", details)
	case service.ErrInventoryPreconditionFail:
		httpx.WriteError(w, http.StatusConflict, string(se), "item precondition not met", details)
	case service.ErrInventoryCooldown:
		httpx.WriteError(w, http.StatusConflict, string(se), "item is cooling down", details)
	case service.ErrPetActionNotAllowed:
		httpx.WriteError(w, http.StatusConflict, string(se), "pet action not allowed", details)
	case service.ErrTaskNotFound:
		httpx.WriteError(w, http.StatusNotFound, string(se), "task not in catalog", details)
	default:
		httpx.WriteError(w, http.StatusInternalServerError, string(service.ErrInternal), string(se), details)
	}
}
