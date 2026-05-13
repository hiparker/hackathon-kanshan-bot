"""Sidecar 模块：封装对 Node.js Claude Sidecar 的调用。"""
from .client import SidecarClient, SidecarError, get_client
from .supervisor import supervisor

__all__ = ["SidecarClient", "SidecarError", "get_client", "supervisor"]
