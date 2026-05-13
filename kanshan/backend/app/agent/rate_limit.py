"""每日调用配额（(user_id, day, kind) 三元组）。"""
from __future__ import annotations

from .. import db
from ..config import settings


class QuotaExceeded(Exception):
    def __init__(self, kind: str, limit: int, used: int) -> None:
        super().__init__(f"{kind} 超出每日上限 {used}/{limit}")
        self.kind = kind
        self.limit = limit
        self.used = used


def get_today_usage(user_id: str, kind: str) -> int:
    row = db.query_one(
        "SELECT count FROM usage_counters WHERE user_id=? AND day=? AND kind=?",
        (user_id, db.today_str(), kind),
    )
    return int(row["count"]) if row else 0


def get_quota(user_id: str, kind: str) -> dict[str, int]:
    """获取配额信息。"""
    rule = settings.rate_rule(user_id)
    limit = int(rule["dailyChatLimit"] if kind == "chat" else rule["dailySkillLimit"])
    used = get_today_usage(user_id, kind)
    return {"limit": limit, "used": used, "remaining": limit - used}


def consume(user_id: str, kind: str) -> dict[str, int]:
    """原子扣减：达到上限抛 QuotaExceeded。"""
    rule = settings.rate_rule(user_id)
    limit = int(rule["dailyChatLimit"] if kind == "chat" else rule["dailySkillLimit"])
    day = db.today_str()

    conn = db.get_db()
    cur = conn.execute(
        """INSERT INTO usage_counters(user_id, day, kind, count) VALUES(?,?,?,0)
           ON CONFLICT(user_id, day, kind) DO NOTHING""",
        (user_id, day, kind),
    )
    row = conn.execute(
        "SELECT count FROM usage_counters WHERE user_id=? AND day=? AND kind=?",
        (user_id, day, kind),
    ).fetchone()
    used = int(row["count"]) if row else 0
    if used >= limit:
        raise QuotaExceeded(kind, limit, used)
    conn.execute(
        "UPDATE usage_counters SET count=count+1 WHERE user_id=? AND day=? AND kind=?",
        (user_id, day, kind),
    )
    return {"limit": limit, "used": used + 1, "remaining": limit - used - 1}
