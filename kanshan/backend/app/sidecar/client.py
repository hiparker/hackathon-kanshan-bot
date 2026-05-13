"""
Sidecar HTTP 客户端：调用 Node.js Claude Sidecar。

设计：
  - 非流式：代理到 POST /chat，返回聚合 JSON
  - 流式：代理到 POST /chat?stream=1，转发 SSE
  - 会话、工具、取消等管理接口透传
"""
from __future__ import annotations

import os
from typing import Any, AsyncIterator

import httpx


class SidecarError(RuntimeError):
    pass


class SidecarClient:
    """轻量 sidecar HTTP 客户端。"""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.base_url = (base_url or os.getenv("SIDECAR_BASE_URL") or "http://127.0.0.1:8788").rstrip("/")
        self.token = token if token is not None else os.getenv("SIDECAR_TOKEN", "")
        self.timeout = timeout

    # ---------- 公共 ----------
    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["X-Sidecar-Token"] = self.token
        return h

    async def health(self) -> dict[str, Any]:
        return await self._get("/health")

    async def tools(self) -> dict[str, Any]:
        return await self._get("/tools")

    async def reload_config(self) -> dict[str, Any]:
        return await self._post("/config/reload", {})

    # ---------- 会话 ----------
    async def create_session(self, options: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/sessions", options)

    async def list_sessions(self, user_id: str | None = None) -> dict[str, Any]:
        params = {"userId": user_id} if user_id else None
        return await self._get("/sessions", params=params)

    async def get_session(self, session_id: str) -> dict[str, Any]:
        return await self._get(f"/sessions/{session_id}")

    async def delete_session(self, session_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.delete(f"{self.base_url}/sessions/{session_id}", headers=self._headers())
            return _json_or_raise(r)

    async def abort_session(self, session_id: str) -> dict[str, Any]:
        return await self._post(f"/sessions/{session_id}/abort", {})

    async def get_history(
        self,
        session_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        """读取会话历史消息（JSONL 持久化）。"""
        return await self._get(
            f"/sessions/{session_id}/history",
            params={"limit": limit, "offset": offset},
        )

    # ---------- 对话 ----------
    async def chat(
        self,
        message: str,
        session_id: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"message": message, "stream": False}
        if session_id:
            payload["sessionId"] = session_id
        if options:
            payload["options"] = options
        return await self._post("/chat", payload)

    async def stream_chat(
        self,
        message: str,
        session_id: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> AsyncIterator[bytes]:
        """
        透传 SSE 字节流。调用方直接把每块写回 FastAPI 的 StreamingResponse。
        """
        payload: dict[str, Any] = {"message": message, "stream": True}
        if session_id:
            payload["sessionId"] = session_id
        if options:
            payload["options"] = options
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat",
                json=payload,
                headers=self._headers(),
            ) as r:
                if r.status_code >= 400:
                    body = await r.aread()
                    raise SidecarError(f"sidecar {r.status_code}: {body.decode(errors='ignore')}")
                async for chunk in r.aiter_raw():
                    if chunk:
                        yield chunk

    # ---------- 内部 ----------
    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}{path}", params=params, headers=self._headers())
            return _json_or_raise(r)

    async def _post(self, path: str, body: Any) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}{path}", json=body, headers=self._headers())
            return _json_or_raise(r)


def _json_or_raise(r: httpx.Response) -> dict[str, Any]:
    if r.status_code >= 400:
        try:
            detail: Any = r.json()
        except Exception:
            detail = r.text
        raise SidecarError(f"sidecar {r.status_code}: {detail}")
    if not r.content:
        return {}
    try:
        return r.json()
    except Exception as e:
        raise SidecarError(f"sidecar 返回非 JSON: {e}; body={r.text[:200]}")


# 单例（懒加载）
_client: SidecarClient | None = None


def get_client() -> SidecarClient:
    global _client
    if _client is None:
        _client = SidecarClient()
    return _client
