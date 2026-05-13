package impl

import (
	"context"
	"path/filepath"
	"testing"

	daoimpl "github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/dao/impl"
	"github.com/zhihu/hackathon-kanshan-bot/services/kanshan-server/pkg/basic/util/session"
)

func TestAuthServiceLocalSignInAndCurrentUser(t *testing.T) {
	t.Setenv("ZHIHU_OAUTH_CLIENT_ID", "")
	t.Setenv("ZHIHU_OAUTH_CLIENT_SECRET", "")
	t.Setenv("ZHIHU_OAUTH_REDIRECT_URI", "")

	dbPath := filepath.Join(t.TempDir(), "kanshan.db")
	if err := daoimpl.Init(dbPath); err != nil {
		t.Fatal(err)
	}
	defer daoimpl.Close()

	svc := NewAuthService()
	ctx := context.Background()
	sess, err := svc.SignIn(ctx, "local-dev")
	if err != nil {
		t.Fatal(err)
	}
	if sess.UserID != "u_local-dev" {
		t.Fatalf("UserID = %q", sess.UserID)
	}
	if sess.SessionToken != session.EncodeToken(sess.UserID) {
		t.Fatalf("unexpected session token %q", sess.SessionToken)
	}
	if sess.Name == "" {
		t.Fatal("expected display name")
	}

	user, err := svc.CurrentUser(ctx, sess.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if user.UserID != sess.UserID || user.ZhihuUserID != "local-dev" || user.Name == "" {
		t.Fatalf("unexpected user: %+v", user)
	}
}
