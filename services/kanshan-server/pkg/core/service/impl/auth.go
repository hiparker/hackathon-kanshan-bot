// Package impl is the service-impl layer. It depends on pkg/basic/dao for
// data and pkg/basic/util/session for token encoding. Each NewXxxService
// factory is parameterless: the service constructs its own dao via the
// dao/impl package-level singletons. It MUST NOT import database/sql.
package impl

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao"
	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/core/service"
)

type authService struct {
	userDao    dao.UserDao
	httpClient *http.Client
}

// NewAuthService returns a service.AuthService backed by the dao/impl
// singleton connection. cmd/server/main.go must have called daoimpl.Init
// first.
func NewAuthService() service.AuthService {
	return &authService{
		userDao:    daoimpl.NewUserDao(),
		httpClient: &http.Client{Timeout: 8 * time.Second},
	}
}

// SignIn exchanges an OAuth code when Zhihu OAuth env vars are configured.
// Without OAuth config it falls back to the local mock code path used by dev.
func (s *authService) SignIn(ctx context.Context, code string) (service.AuthSession, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return service.AuthSession{}, service.ErrBadRequest
	}
	profile, err := s.resolveZhihuProfile(ctx, code)
	if err != nil {
		return service.AuthSession{}, err
	}
	userID := "u_" + profile.ZhihuUserID
	now := time.Now().Unix()
	if _, err := s.userDao.Upsert(ctx, dao.User{
		ID:          userID,
		ZhihuUserID: profile.ZhihuUserID,
		Name:        profile.Name,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		return service.AuthSession{}, service.ErrInternal
	}
	return service.AuthSession{
		UserID:       userID,
		ZhihuUserID:  profile.ZhihuUserID,
		Name:         profile.Name,
		SessionToken: session.EncodeToken(userID),
		ExpiresAt:    now + 7*24*3600,
	}, nil
}

func (s *authService) CurrentUser(ctx context.Context, userID string) (service.AuthUser, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return service.AuthUser{}, service.ErrUnauthorized
	}
	user, err := s.userDao.Get(ctx, userID)
	if err != nil {
		if err == dao.ErrNotFound {
			return service.AuthUser{}, service.ErrUnauthorized
		}
		return service.AuthUser{}, service.ErrInternal
	}
	return service.AuthUser{
		UserID:      user.ID,
		ZhihuUserID: user.ZhihuUserID,
		Name:        displayName(user.Name, user.ZhihuUserID),
	}, nil
}

type zhihuOAuthProfile struct {
	ZhihuUserID string
	Name        string
}

type zhihuTokenResponse struct {
	AccessToken string `json:"access_token"`
	OpenID      string `json:"openid"`
	UserID      string `json:"user_id"`
	ID          string `json:"id"`
}

type zhihuUserInfoResponse struct {
	ID          string `json:"id"`
	OpenID      string `json:"openid"`
	UserID      string `json:"user_id"`
	ZhihuUserID string `json:"zhihu_user_id"`
	Name        string `json:"name"`
	FullName    string `json:"fullname"`
	Nickname    string `json:"nickname"`
}

func (s *authService) resolveZhihuProfile(ctx context.Context, code string) (zhihuOAuthProfile, error) {
	cfg := loadOAuthConfig()
	if !cfg.enabled() {
		return zhihuOAuthProfile{ZhihuUserID: code, Name: displayName("", code)}, nil
	}

	token, err := s.exchangeCode(ctx, cfg, code)
	if err != nil {
		return zhihuOAuthProfile{}, err
	}
	info, err := s.fetchUserInfo(ctx, cfg, token.AccessToken)
	if err != nil {
		return zhihuOAuthProfile{}, err
	}
	zhihuID := firstNonEmpty(info.ZhihuUserID, info.UserID, info.OpenID, info.ID, token.UserID, token.OpenID, token.ID)
	if zhihuID == "" {
		return zhihuOAuthProfile{}, service.ErrInternal
	}
	name := firstNonEmpty(info.Name, info.Nickname, info.FullName, zhihuID)
	return zhihuOAuthProfile{ZhihuUserID: zhihuID, Name: name}, nil
}

type oauthConfig struct {
	clientID     string
	clientSecret string
	redirectURI  string
	tokenURL     string
	userInfoURL  string
}

func loadOAuthConfig() oauthConfig {
	return oauthConfig{
		clientID:     os.Getenv("ZHIHU_OAUTH_CLIENT_ID"),
		clientSecret: os.Getenv("ZHIHU_OAUTH_CLIENT_SECRET"),
		redirectURI:  os.Getenv("ZHIHU_OAUTH_REDIRECT_URI"),
		tokenURL:     envOr("ZHIHU_OAUTH_TOKEN_URL", "https://openapi.zhihu.com/access_token"),
		userInfoURL:  envOr("ZHIHU_OAUTH_USER_INFO_URL", "https://www.zhihu.com/oauth/userinfo"),
	}
}

func (c oauthConfig) enabled() bool {
	return c.clientID != "" && c.clientSecret != "" && c.redirectURI != "" && c.tokenURL != "" && c.userInfoURL != ""
}

func (s *authService) exchangeCode(ctx context.Context, cfg oauthConfig, code string) (zhihuTokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("app_id", cfg.clientID)
	form.Set("app_key", cfg.clientSecret)
	form.Set("redirect_uri", cfg.redirectURI)
	form.Set("code", code)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return zhihuTokenResponse{}, service.ErrInternal
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	var token zhihuTokenResponse
	if err := s.doJSON(req, &token); err != nil {
		return zhihuTokenResponse{}, err
	}
	if token.AccessToken == "" {
		return zhihuTokenResponse{}, service.ErrUnauthorized
	}
	return token, nil
}

func (s *authService) fetchUserInfo(ctx context.Context, cfg oauthConfig, accessToken string) (zhihuUserInfoResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.userInfoURL, nil)
	if err != nil {
		return zhihuUserInfoResponse{}, service.ErrInternal
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	var info zhihuUserInfoResponse
	if err := s.doJSON(req, &info); err != nil {
		return zhihuUserInfoResponse{}, err
	}
	return info, nil
}

func (s *authService) doJSON(req *http.Request, out any) error {
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return service.ErrUnauthorized
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return service.ErrUnauthorized
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return service.ErrInternal
	}
	return nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func displayName(name, fallbackID string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	if fallbackID == "" {
		return "知乎用户"
	}
	return fmt.Sprintf("知乎用户 %s", fallbackID)
}
