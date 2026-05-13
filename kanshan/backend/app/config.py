"""配置加载：.env + config.json（可热重载）。"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()


DEFAULT_CONFIG: dict[str, Any] = {
    "systemPrompt": "你是刘看山，一只住在用户电脑里的北极狐电子宠物。说话活泼、简短、温暖，偶尔俏皮。",
    "memory": {
        "shortTermTurns": 50,
        "summaryTriggerTurns": 50,
        "summaryKeepLatestTurns": 10,
    },
    "rateLimit": {
        "default": {"dailyChatLimit": 100, "dailySkillLimit": 100},
        "perUser": {},
    },
}


class Settings:
    _instance: "Settings | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._config: dict[str, Any] = {}
        self._load()

    def _load(self):
        config_path = os.getenv("CONFIG_PATH", "./config/config.json")
        config_path = Path(config_path)
        if config_path.exists():
            with config_path.open("r", encoding="utf-8") as f:
                self._config = json.load(f)
        else:
            self._config = DEFAULT_CONFIG.copy()
        # 合并默认配置
        for k, v in DEFAULT_CONFIG.items():
            if k not in self._config:
                self._config[k] = v
            elif isinstance(v, dict) and isinstance(self._config[k], dict):
                for sub_k, sub_v in v.items():
                    if sub_k not in self._config[k]:
                        self._config[k][sub_k] = sub_v
        # 加载 .env
        self.host = os.getenv("HOST", "0.0.0.0")
        self.port = int(os.getenv("PORT", "8000"))
        self.admin_token = os.getenv("ADMIN_TOKEN", "change-me-please")
        self.sidecar_base_url = os.getenv("SIDECAR_BASE_URL", "http://127.0.0.1:8788")
        self.sidecar_token = os.getenv("SIDECAR_TOKEN", "")
        self.db_path = os.getenv("DB_PATH", "./data/kanshan.db")
        self.ZHIHU_SECRET = os.getenv("ZHIHU_SECRET", "")

    def load(self) -> dict[str, Any]:
        return self._config.copy()

    def reload(self) -> dict[str, Any]:
        self._load()
        return self.load()

    def rate_rule(self, user_id: str) -> dict[str, int]:
        return self._config.get("rateLimit", {}).get("perUser", {}).get(user_id) or self._config.get("rateLimit", {}).get("default", {})


settings = Settings()
