"""SQLite 连接封装（线程安全的单连接 + 行工厂）。"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .config import settings

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _init_schema(conn: sqlite3.Connection) -> None:
    app_dir = Path(__file__).parent
    schema = (app_dir / "schema.sql").read_text(encoding="utf-8")
    conn.executescript(schema)


def get_db() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _lock:
        if _conn is not None:
            return _conn
        path = Path(settings.db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _init_schema(conn)
        _conn = conn
        return _conn


def init_seed() -> None:
    """首次部署写入示例内容。"""
    conn = get_db()
    app_dir = Path(__file__).parent
    seed = (app_dir / "seed.sql").read_text(encoding="utf-8")
    conn.executescript(seed)
    print(f"[db] 初始化完成: {settings.db_path}")


def now_ms() -> int:
    return int(datetime.now().timestamp() * 1000)


def today_str(tz: str = "Asia/Shanghai") -> str:
    return datetime.now(ZoneInfo(tz)).strftime("%Y-%m-%d")


def query_one(sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return get_db().execute(sql, params).fetchone()


def query_all(sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return list(get_db().execute(sql, params).fetchall())


def execute(sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Cursor:
    with _lock:
        return get_db().execute(sql, params)
