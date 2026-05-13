"""
可选：由 Python 进程守护 Node.js sidecar 子进程（启动/重启/关闭）。

默认行为受 SIDECAR_AUTOSPAWN=1 控制；若外部已独立部署 sidecar，则关闭此选项。
"""
from __future__ import annotations

import asyncio
import os
import shutil
import signal
from pathlib import Path


class SidecarSupervisor:
    def __init__(self) -> None:
        self.enabled = os.getenv("SIDECAR_AUTOSPAWN", "0") == "1"
        self.cwd = Path(os.getenv("SIDECAR_CWD", "../sidecar")).resolve()
        self.cmd = os.getenv("SIDECAR_CMD", "npm run dev")
        self.proc: asyncio.subprocess.Process | None = None

    async def start(self) -> None:
        if not self.enabled:
            return
        if self.proc and self.proc.returncode is None:
            return
        if not self.cwd.exists():
            print(f"[sidecar] 自拉起跳过：目录不存在 {self.cwd}")
            return
        if shutil.which("npm") is None and shutil.which("node") is None:
            print("[sidecar] 自拉起跳过：找不到 npm/node")
            return
        print(f"[sidecar] 启动子进程: {self.cmd} (cwd={self.cwd})")
        self.proc = await asyncio.create_subprocess_shell(
            self.cmd,
            cwd=str(self.cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        asyncio.create_task(self._pipe_logs())

    async def stop(self) -> None:
        if not self.proc or self.proc.returncode is not None:
            return
        try:
            self.proc.send_signal(signal.SIGINT)
            await asyncio.wait_for(self.proc.wait(), timeout=5)
        except (asyncio.TimeoutError, ProcessLookupError):
            try:
                self.proc.kill()
            except ProcessLookupError:
                pass

    async def _pipe_logs(self) -> None:
        assert self.proc and self.proc.stdout
        async for raw in self.proc.stdout:
            try:
                print(f"[sidecar] {raw.decode(errors='ignore').rstrip()}")
            except Exception:
                pass


supervisor = SidecarSupervisor()
