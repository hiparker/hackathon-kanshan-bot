package portal

import (
	"net/http"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/httpx"
)

// Version is overwritten via -ldflags '-X .../portal.Version=...' at build time.
var Version = "dev"

type healthResponse struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
}

func health(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, healthResponse{OK: true, Version: Version})
}
