// Package impl is the service-impl layer. It depends on pkg/basic/dao for
// data and pkg/basic/util/session for token encoding. Each NewXxxService
// factory is parameterless: the service constructs its own dao via the
// dao/impl package-level singletons. It MUST NOT import database/sql.
package impl

import (
	"context"
	"strings"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type authService struct {
	userDao dao.UserDao
}

// NewAuthService returns a service.AuthService backed by the dao/impl
// singleton connection. cmd/server/main.go must have called daoimpl.Init
// first.
func NewAuthService() service.AuthService {
	return &authService{userDao: daoimpl.NewUserDao()}
}

// SignIn upserts the user keyed by code and mints an opaque session token.
// P0: code is treated as a mock zhihu user id. P3 will swap in a real OAuth2
// exchange.
func (s *authService) SignIn(ctx context.Context, code string) (service.AuthSession, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return service.AuthSession{}, service.ErrBadRequest
	}
	userID := "u_" + code
	now := time.Now().Unix()
	if _, err := s.userDao.Upsert(ctx, dao.User{
		ID:          userID,
		ZhihuUserID: code,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		return service.AuthSession{}, service.ErrInternal
	}
	return service.AuthSession{
		UserID:       userID,
		SessionToken: session.EncodeToken(userID),
		ExpiresAt:    now + 7*24*3600,
	}, nil
}
