"""
/claude/* 路由：对接 Node.js Sidecar（Claude Agent SDK）。

设计：
  - 沿用 Python 现有的 (用户 / 限流 / 会话记忆) 体系
  - 真正的 Agent 推理、工具调用、MCP 都交给 sidecar 完成
  - Python 负责：限流、把历史摘要注入 sidecar 的 additionalSystem、落库
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..agent import memory
from ..agent.rate_limit import QuotaExceeded, consume, get_quota
from ..config import settings
from ..db import query_all
from ..skills import get_weather, is_weather_question, extract_location
from ..sidecar import SidecarError, get_client

router = APIRouter(prefix="/claude", tags=["claude"])


# ========== Schemas ==========
class ClaudeOptions(BaseModel):
    systemPrompt: str | None = None
    model: str | None = None
    allowedTools: list[str] | None = None
    disallowedTools: list[str] | None = None
    enabledMcpServers: list[str] | None = None
    permissionMode: str | None = None  # auto / plan / fullAgency / custom 或 SDK 原生模式
    cwd: str | None = None
    mcpServers: dict[str, Any] | None = None
    maxTurns: int | None = None


class ClaudeChatRequest(BaseModel):
    userId: str = Field(..., min_length=1)
    sessionId: str | None = None
    message: str = Field(..., min_length=1)
    stream: bool = False
    options: ClaudeOptions | None = None


class ClaudeCreateSessionRequest(BaseModel):
    userId: str = Field(..., min_length=1)
    options: ClaudeOptions | None = None


# ========== 工具 ==========
@router.get("/health")
async def health():
    try:
        return await get_client().health()
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_UNREACHABLE", "message": str(e)})


@router.get("/usage")
async def get_user_usage(userId: str = Query(...), kind: str = Query("chat")):
    """获取用户配额使用情况。"""
    return get_quota(userId, kind)


@router.get("/tools")
async def list_tools():
    try:
        return await get_client().tools()
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_UNREACHABLE", "message": str(e)})


@router.post("/reload-config")
async def reload_config():
    try:
        return await get_client().reload_config()
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_UNREACHABLE", "message": str(e)})


# ========== 会话管理 ==========
@router.post("/sessions", status_code=201)
async def create_session(req: ClaudeCreateSessionRequest):
    memory.ensure_user(req.userId)
    opts = _build_sidecar_options(req.userId, None, req.options)
    try:
        meta = await get_client().create_session(opts)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})
    # 在 Python 侧也建一份 session（复用 memory 表），便于拉历史
    memory.ensure_session(meta["sessionId"], req.userId, title="claude")
    return meta


@router.get("/sessions")
async def list_sessions(userId: str = Query(...)):
    try:
        return await get_client().list_sessions(userId)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    try:
        return await get_client().get_session(session_id)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    try:
        return await get_client().delete_session(session_id)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})


@router.post("/sessions/{session_id}/abort")
async def abort_session(session_id: str):
    try:
        return await get_client().abort_session(session_id)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})


@router.get("/sessions/{session_id}/history")
async def get_history(session_id: str, limit: int = 200, offset: int = 0):
    """读取会话的 JSONL 持久化历史。"""
    try:
        return await get_client().get_history(session_id, limit=limit, offset=offset)
    except SidecarError as e:
        raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, limit: int = 200):
    """从 Python 数据库获取干净的会话消息（仅 user/assistant 消息）。"""
    try:
        rows = query_all(
            """SELECT role, content FROM messages
               WHERE session_id=? ORDER BY id ASC LIMIT ?""",
            (session_id, limit),
        )
        return [{"role": r["role"], "content": r["content"]} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "DATABASE_ERROR", "message": str(e)})


# ========== 对话 ==========
@router.post("/chat")
async def chat(req: ClaudeChatRequest):
    # 1. 检测是否是天气相关问题
    if is_weather_question(req.message):
        location = extract_location(req.message)
        success, weather_message = await get_weather(location)
        
        if success:
            # 天气问题，直接返回
            # 1. 限流（Claude 也走 chat 桶）
            try:
                quota = consume(req.userId, "chat")
            except QuotaExceeded as e:
                raise HTTPException(status_code=429, detail={"error": "RATE_LIMIT", "kind": e.kind, "limit": e.limit, "used": e.used})
            
            # 2. 会话
            session_id = req.sessionId or f"sc_{uuid.uuid4().hex[:12]}"
            memory.ensure_user(req.userId)
            memory.ensure_session(session_id, req.userId, title="claude")
            memory.append_message(session_id, "user", req.message)
            memory.append_message(session_id, "assistant", weather_message)
            
            return {
                "sessionId": session_id,
                "reply": weather_message,
                "quota": quota,
            }
    
    # 2. 限流（Claude 也走 chat 桶）
    try:
        quota = consume(req.userId, "chat")
    except QuotaExceeded as e:
        raise HTTPException(status_code=429, detail={"error": "RATE_LIMIT", "kind": e.kind, "limit": e.limit, "used": e.used})

    # 3. 会话
    session_id = req.sessionId or f"sc_{uuid.uuid4().hex[:12]}"
    memory.ensure_user(req.userId)
    memory.ensure_session(session_id, req.userId, title="claude")
    memory.append_message(session_id, "user", req.message)

    # 3. 记忆装配（摘要 + 近期对话作为 additionalSystem 注入 sidecar）
    options_dict = _build_sidecar_options(req.userId, session_id, req.options)
    cfg = settings.load()
    short_turns = int(cfg.get("memory", {}).get("shortTermTurns", 50))
    recent = memory.recent_messages(session_id, short_turns)
    summary = memory.latest_summary(session_id)
    context_parts: list[str] = []
    if summary:
        context_parts.append(f"[长期记忆摘要]\n{summary}")
    if recent:
        history_lines = []
        for m in recent:
            role_label = "用户" if m["role"] == "user" else "刘看山" if m["role"] == "assistant" else m["role"]
            history_lines.append(f"[{role_label}]\n{m['content']}")
        context_parts.append(f"[对话历史]\n" + "\n\n".join(history_lines))
    if context_parts:
        additional = "\n\n".join(context_parts)
        prev = options_dict.get("additionalSystem") or ""
        options_dict["additionalSystem"] = (prev + "\n\n" if prev else "") + additional

    client = get_client()

    if not req.stream:
        try:
            resp = await client.chat(req.message, session_id=req.sessionId, options=options_dict if not req.sessionId else None)
        except SidecarError as e:
            raise HTTPException(status_code=502, detail={"error": "SIDECAR_ERROR", "message": str(e)})
        reply = resp.get("reply") or ""
        if reply:
            memory.append_message(session_id, "assistant", reply)
        return {
            "sessionId": resp.get("sessionId", session_id),
            "sdkSessionId": resp.get("sdkSessionId"),
            "reply": reply,
            "usage": resp.get("usage"),
            "costUsd": resp.get("costUsd"),
            "durationMs": resp.get("durationMs"),
            "events": resp.get("events", []),
            "quota": quota,
        }

    # 流式：先检查是否是天气问题
    if is_weather_question(req.message):
        location = extract_location(req.message)
        success, weather_message = await get_weather(location)
        
        if success:
            memory.append_message(session_id, "assistant", weather_message)
            
            async def gen_weather():
                # 模拟流式输出天气信息
                import asyncio
                chunk_size = 5
                for i in range(0, len(weather_message), chunk_size):
                    chunk = weather_message[i:i+chunk_size]
                    yield f"event: text_delta\ndata: {{\"text\": \"{json.dumps(chunk)[1:-1]}\"}}\n\n".encode()
                    await asyncio.sleep(0.05)
                
                yield f"event: session_complete\ndata: {{\"result\": \"{json.dumps(weather_message)[1:-1]}\", \"subtype\": \"success\"}}\n\n".encode()
            
            headers = {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Quota-Remaining": str(quota.get("remaining", 0)),
            }
            return StreamingResponse(gen_weather(), media_type="text/event-stream", headers=headers)

    # 流式：透传 SSE，同时收集最终 assistant 文本写回 messages
    async def gen():
        buf_text: list[str] = []
        try:
            async for chunk in client.stream_chat(
                req.message,
                session_id=req.sessionId,
                options=options_dict if not req.sessionId else None,
            ):
                _maybe_capture_text(chunk, buf_text)
                yield chunk
        except SidecarError as e:
            err = json.dumps({"message": str(e)})
            yield f"event: error\ndata: {err}\n\n".encode()
        finally:
            text = "".join(buf_text).strip()
            if text:
                memory.append_message(session_id, "assistant", text)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Quota-Remaining": str(quota.get("remaining", 0)),
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


# ========== helpers ==========
def _build_sidecar_options(user_id: str, _session_id: str | None, opts: ClaudeOptions | None) -> dict[str, Any]:
    cfg = settings.load()
    sys_prompt = (opts.systemPrompt if opts and opts.systemPrompt else cfg.get("systemPrompt"))
    base: dict[str, Any] = {"userId": user_id}
    if sys_prompt:
        base["systemPrompt"] = sys_prompt
    if opts:
        for k in (
            "model",
            "allowedTools",
            "disallowedTools",
            "enabledMcpServers",
            "permissionMode",
            "cwd",
            "mcpServers",
            "maxTurns",
        ):
            v = getattr(opts, k, None)
            if v is not None:
                base[k] = v
    return base


def _maybe_capture_text(chunk: bytes, buf: list[str]) -> None:
    """从 SSE 字节里抓 chat:message-chunk / text_delta 事件的 text 字段。容错：失败就忽略。

    新 sidecar 发 chat:* 事件名，兼容旧 assistant_text / text_delta。
    """
    try:
        s = chunk.decode("utf-8", errors="ignore")
    except Exception:
        return
    event_name: str | None = None
    for line in s.splitlines():
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and event_name in (
            "chat:message-chunk",
            "assistant_text",
            "text_delta",
        ):
            payload = line.split(":", 1)[1].strip()
            try:
                obj = json.loads(payload)
                if isinstance(obj, dict) and isinstance(obj.get("text"), str):
                    buf.append(obj["text"])
            except Exception:
                pass
