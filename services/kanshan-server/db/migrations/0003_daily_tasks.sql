-- 0003_daily_tasks.sql
-- Replaces demo task seeds with daily task loop and adds per-day interaction limits.

DELETE FROM tasks_catalog
WHERE task_id IN (
    'browse-3-posts',
    'weekly-browse-50',
    'story-first-rescue',
    'challenge-growth-100'
);

INSERT INTO tasks_catalog(task_id, type, name, target_count, reward_json, trigger_event, sort_order, created_at, updated_at) VALUES
    ('browse-5-posts', 'daily', '浏览 5 篇帖子',     5, '[]', 'post_view',  1, strftime('%s','now'), strftime('%s','now')),
    ('feed-2-times',   'daily', '喂食 2 次',        2, '[]', NULL,         2, strftime('%s','now'), strftime('%s','now')),
    ('comment-3-times','daily', '评论 3 次',        3, '[]', 'comment',    3, strftime('%s','now'), strftime('%s','now')),
    ('exercise-2-times','daily','运动 2 次',        2, '[]', NULL,         4, strftime('%s','now'), strftime('%s','now')),
    ('chat-1-time',    'daily', '与看山对话 1 次',  1, '[]', NULL,         5, strftime('%s','now'), strftime('%s','now'))
ON CONFLICT(task_id) DO UPDATE SET
    type = excluded.type,
    name = excluded.name,
    target_count = excluded.target_count,
    reward_json = excluded.reward_json,
    trigger_event = excluded.trigger_event,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS user_interaction_counts (
    user_id     TEXT NOT NULL,
    action      TEXT NOT NULL,
    period_key  TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, action, period_key)
);

