-- ============================================================
--  刘看山（Kanshan）SQLite Schema  (Python 版)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  nickname      TEXT NOT NULL DEFAULT '主人',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  tool_call  TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS memory_summaries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  summary    TEXT NOT NULL,
  turn_from  INTEGER NOT NULL,
  turn_to    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON memory_summaries(session_id, created_at);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id   TEXT NOT NULL,
  day       TEXT NOT NULL,
  kind      TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  cron_expr  TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  task        TEXT,
  work_min    INTEGER NOT NULL DEFAULT 25,
  break_min   INTEGER NOT NULL DEFAULT 5,
  state       TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_user ON pomodoro_sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS contents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  url        TEXT NOT NULL UNIQUE,
  category   TEXT,
  tags       TEXT,
  weight     INTEGER NOT NULL DEFAULT 1,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contents_enabled ON contents(enabled);

CREATE TABLE IF NOT EXISTS push_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  pushed_at  INTEGER NOT NULL,
  clicked_at INTEGER,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_history_user ON push_history(user_id, pushed_at);

CREATE TABLE IF NOT EXISTS weather_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  location   TEXT NOT NULL,
  date       TEXT NOT NULL,
  weather    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(location, date)
);
CREATE INDEX IF NOT EXISTS idx_weather_location_date ON weather_cache(location, date);

CREATE TABLE IF NOT EXISTS zhihu_hotlist_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hotlist    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zhihu_hotlist_time ON zhihu_hotlist_cache(created_at DESC);

-- 知乎热榜条目表
CREATE TABLE IF NOT EXISTS zhihu_hotlist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  summary      TEXT,
  thumbnail    TEXT,
  hot_score    INTEGER,
  rank         INTEGER,
  created_at   INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zhihu_items_url ON zhihu_hotlist_items(url);
CREATE INDEX IF NOT EXISTS idx_zhihu_items_time ON zhihu_hotlist_items(fetched_at DESC);

-- 热榜评论表
CREATE TABLE IF NOT EXISTS zhihu_hotlist_comments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  hotlist_item_id    INTEGER NOT NULL,
  hot_comment        TEXT,  -- 热门评论
  liukanshan_comment TEXT,  -- 刘看山评论（根据历史使用）
  opposing_view      TEXT,  -- 对立观点
  other_perspective  TEXT,  -- 其他层面观点
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (hotlist_item_id) REFERENCES zhihu_hotlist_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_zhihu_comments_item ON zhihu_hotlist_comments(hotlist_item_id);

-- 用户热榜查看历史表
CREATE TABLE IF NOT EXISTS zhihu_user_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  hotlist_item_id  INTEGER NOT NULL,
  viewed_at        INTEGER NOT NULL,
  FOREIGN KEY (hotlist_item_id) REFERENCES zhihu_hotlist_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_zhihu_user_history ON zhihu_user_history(user_id, viewed_at DESC);
