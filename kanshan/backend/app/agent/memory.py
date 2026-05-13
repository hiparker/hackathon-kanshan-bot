"""对话短期记忆 + 长期摘要上下文拼装。"""
from __future__ import annotations

from typing import Any

from .. import db


def ensure_user(user_id: str) -> None:
    row = db.query_one("SELECT id FROM users WHERE id=?", (user_id,))
    if not row:
        db.execute(
            "INSERT INTO users(id, nickname, created_at, last_seen_at) VALUES(?,?,?,?)",
            (user_id, "主人", db.now_ms(), db.now_ms()),
        )
    else:
        db.execute("UPDATE users SET last_seen_at=? WHERE id=?", (db.now_ms(), user_id))


def ensure_session(session_id: str, user_id: str, title: str | None = None) -> None:
    row = db.query_one("SELECT id FROM sessions WHERE id=?", (session_id,))
    if not row:
        db.execute(
            "INSERT INTO sessions(id, user_id, title, created_at, updated_at) VALUES(?,?,?,?,?)",
            (session_id, user_id, title, db.now_ms(), db.now_ms()),
        )
    else:
        db.execute("UPDATE sessions SET updated_at=? WHERE id=?", (db.now_ms(), session_id))


def append_message(session_id: str, role: str, content: str, tool_call: str | None = None) -> None:
    db.execute(
        "INSERT INTO messages(session_id, role, content, tool_call, created_at) VALUES(?,?,?,?,?)",
        (session_id, role, content, tool_call, db.now_ms()),
    )


def recent_messages(session_id: str, limit_turns: int) -> list[dict[str, Any]]:
    """取最近 N 个消息（user/assistant/tool 混合）。"""
    rows = db.query_all(
        """SELECT role, content, tool_call FROM messages
           WHERE session_id=? ORDER BY id DESC LIMIT ?""",
        (session_id, limit_turns * 3),
    )
    rows = list(reversed(rows))
    out: list[dict[str, Any]] = []
    for r in rows:
        msg: dict[str, Any] = {"role": r["role"], "content": r["content"]}
        if r["tool_call"]:
            import json as _json
            try:
                msg.update(_json.loads(r["tool_call"]))
            except Exception:
                pass
        out.append(msg)
    return out


def latest_summary(session_id: str) -> str | None:
    row = db.query_one(
        "SELECT summary FROM memory_summaries WHERE session_id=? ORDER BY id DESC LIMIT 1",
        (session_id,),
    )
    return row["summary"] if row else None


def build_context(session_id: str, system_prompt: str, short_turns: int) -> list[dict[str, Any]]:
    msgs: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    summ = latest_summary(session_id)
    if summ:
        msgs.append({"role": "system", "content": f"[长期记忆摘要]\n{summ}"})
    msgs.extend(recent_messages(session_id, short_turns))
    return msgs
