CREATE TABLE IF NOT EXISTS chat_turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    query       TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_turns_user_created
    ON chat_turns(user_id, created_at DESC, id DESC);
