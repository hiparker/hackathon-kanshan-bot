-- 0001_init.sql
-- 初始化刘看山陪伴 Bot 后端 P0 数据模型 + items_catalog / tasks_catalog 种子数据。
-- 表语义详见 planning/backend-rfc.md §5。

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    zhihu_user_id   TEXT UNIQUE,
    name            TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS items_catalog (
    item_id         TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    rarity          TEXT NOT NULL,
    cooldown_sec    INTEGER NOT NULL DEFAULT 0,
    effect_json     TEXT NOT NULL,
    precondition    TEXT,
    action_hint     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_items (
    user_id            TEXT NOT NULL,
    item_id            TEXT NOT NULL,
    qty                INTEGER NOT NULL DEFAULT 0,
    last_obtained_at   INTEGER,
    expire_at          INTEGER,
    last_used_at       INTEGER,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES items_catalog(item_id)
);

CREATE TABLE IF NOT EXISTS inventory_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_log_user
    ON inventory_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS pet_state (
    user_id              TEXT PRIMARY KEY,
    hunger               INTEGER NOT NULL DEFAULT 100,
    happiness            INTEGER NOT NULL DEFAULT 100,
    energy               INTEGER NOT NULL DEFAULT 100,
    health               INTEGER NOT NULL DEFAULT 100,
    growth               INTEGER NOT NULL DEFAULT 0,
    mood                 TEXT NOT NULL DEFAULT 'normal',
    lifecycle            TEXT NOT NULL DEFAULT 'normal',
    last_tick_at         INTEGER NOT NULL,
    sick_started_at      INTEGER,
    runaway_started_at   INTEGER,
    updated_at           INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tasks_catalog (
    task_id         TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    name            TEXT NOT NULL,
    target_count    INTEGER NOT NULL DEFAULT 1,
    reward_json     TEXT NOT NULL,
    trigger_event   TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_catalog_type
    ON tasks_catalog(type);

CREATE INDEX IF NOT EXISTS idx_tasks_catalog_trigger
    ON tasks_catalog(trigger_event);

CREATE TABLE IF NOT EXISTS user_tasks (
    user_id      TEXT NOT NULL,
    task_id      TEXT NOT NULL,
    period_key   TEXT NOT NULL,
    done_count   INTEGER NOT NULL DEFAULT 0,
    done_at      INTEGER,
    rewarded     INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, task_id, period_key)
);

CREATE TABLE IF NOT EXISTS daily_stats (
    user_id              TEXT NOT NULL,
    date                 TEXT NOT NULL,
    posts_viewed         INTEGER NOT NULL DEFAULT 0,
    likes_received       INTEGER NOT NULL DEFAULT 0,
    comments_published   INTEGER NOT NULL DEFAULT 0,
    longest_post_id      TEXT,
    longest_dwell_sec    INTEGER NOT NULL DEFAULT 0,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS stats_event_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT,
    occurred_at INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stats_event_log_user
    ON stats_event_log(user_id, created_at);

-- ===== 种子数据：items_catalog =====
INSERT INTO items_catalog(item_id, name, rarity, cooldown_sec, effect_json, precondition, action_hint, sort_order, created_at, updated_at) VALUES
    ('fish-jerky',     '小鱼干',     'common',   0, '{"hunger":25}',                    NULL,    'happy-temporary',     1, strftime('%s','now'), strftime('%s','now')),
    ('nutrition-can',  '营养罐头',   'rare',     0, '{"hunger":50,"health":10}',        NULL,    'happy-temporary',     2, strftime('%s','now'), strftime('%s','now')),
    ('yarn-ball',      '毛线球',     'common',   0, '{"happiness":15,"energy":10}',     NULL,    'happy-temporary',     3, strftime('%s','now'), strftime('%s','now')),
    ('cat-baton',      '指挥猫棒',   'common',   0, '{"happiness":30}',                 NULL,    'happy-temporary',     4, strftime('%s','now'), strftime('%s','now')),
    ('cold-medicine',  '感冒药',     'rare',     0, '{"health":40}',                    'sick',  'recover',             5, strftime('%s','now'), strftime('%s','now')),
    ('revive-feather', '复活羽毛',   'precious', 0, '{"lifecycle":"normal"}',           'dead',  'revive',              6, strftime('%s','now'), strftime('%s','now')),
    ('energy-drink',   '能量饮料',   'common',   0, '{"energy":40}',                    NULL,    'exercise-temporary',  7, strftime('%s','now'), strftime('%s','now'));

-- ===== 种子数据：tasks_catalog =====
INSERT INTO tasks_catalog(task_id, type, name, target_count, reward_json, trigger_event, sort_order, created_at, updated_at) VALUES
    ('browse-3-posts',       'daily',     '浏览 3 篇帖子',           3,   '[{"kind":"item","item_id":"fish-jerky","qty":1}]',          'post_view',  1, strftime('%s','now'), strftime('%s','now')),
    ('feed-2-times',         'daily',     '喂食 2 次',                2,   '[{"kind":"growth","qty":5}]',                                NULL,         2, strftime('%s','now'), strftime('%s','now')),
    ('weekly-browse-50',     'weekly',    '本周累计浏览 50 篇帖子',   50,  '[{"kind":"item","item_id":"nutrition-can","qty":1}]',        'post_view',  1, strftime('%s','now'), strftime('%s','now')),
    ('story-first-rescue',   'story',     '第一次救治看山',           1,   '[{"kind":"item","item_id":"revive-feather","qty":1}]',       NULL,         1, strftime('%s','now'), strftime('%s','now')),
    ('challenge-growth-100', 'challenge', '成长值达到 100',           100, '[{"kind":"skin","item_id":"kanshan-doctor","qty":1}]',       NULL,         1, strftime('%s','now'), strftime('%s','now'));

-- ===== 种子数据：默认给所有新用户初始道具，由 dao impl 在用户首次登录时复制 =====
-- 这里不做触发器，复制逻辑放到 service 层。
