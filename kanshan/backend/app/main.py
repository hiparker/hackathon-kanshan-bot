"""FastAPI 入口 - 精简版，仅保留 Claude 功能。"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .routes import claude
from .sidecar import supervisor


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：初始化 DB + 种子数据
    db.get_db()
    try:
        db.init_seed()
    except Exception as e:
        print(f"[seed] 失败: {e}")
    await supervisor.start()
    print("✨ 刘看山 Claude 后端启动完成")
    yield
    await supervisor.stop()
    print("👋 刘看山下班了")


app = FastAPI(
    title="Kanshan - Claude 对话 API",
    version="0.1.0",
    description="Claude 对话 API（含记忆+限流）",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["meta"])
async def index():
    return {
        "name": "kanshan-claude-server",
        "version": "0.1.0",
        "endpoints": [
            "GET  /claude/health",
            "GET  /claude/usage?userId=",
            "POST /claude/sessions",
            "GET  /claude/sessions?userId=",
            "GET  /claude/sessions/{id}",
            "DELETE /claude/sessions/{id}",
            "POST /claude/sessions/{id}/abort",
            "GET  /claude/sessions/{id}/history",
            "POST /claude/chat",
        ],
    }


@app.get("/health", tags=["meta"])
async def health():
    return {"ok": True}


app.include_router(claude.router)


def main():
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
