"""
知乎热榜技能模块：
- 使用知乎开放平台 API 获取热榜
- 支持缓存热榜数据，每 4 小时刷新一次
- 返回格式化的热榜内容
"""
import time
import json
import os
import httpx
from typing import Tuple, Optional
from datetime import datetime
from .. import db

# 检测是否是热榜相关问题的关键词
HOTLIST_KEYWORDS = [
    "热榜", "热搜", "知乎热榜", "知乎热搜",
    "热点", "热门", "今天热榜", "最近热榜"
]

def is_hotlist_question(message: str) -> bool:
    """检测问题是否与热榜相关"""
    message_lower = message.lower()
    for keyword in HOTLIST_KEYWORDS:
        if keyword.lower() in message_lower:
            return True
    return False

def _get_cached_hotlist(max_age_hours: int = 4) -> Optional[str]:
    """从缓存获取热榜
    
    Args:
        max_age_hours: 缓存最大有效期（小时）
        
    Returns:
        热榜内容，无缓存或过期返回 None
    """
    try:
        max_age_ms = max_age_hours * 60 * 60 * 1000
        now_ms = int(datetime.now().timestamp() * 1000)
        
        print(f"📋 调试 _get_cached_hotlist: max_age_ms={max_age_ms}, now_ms={now_ms}")
        
        # 获取最新的缓存
        row = db.query_one(
            "SELECT hotlist, created_at FROM zhihu_hotlist_cache ORDER BY created_at DESC LIMIT 1"
        )
        
        print(f"📋 调试 查询结果: {row}")
        
        if row and (now_ms - row["created_at"]) <= max_age_ms:
            print(f"📋 调试 返回缓存")
            return row["hotlist"]
        else:
            print(f"📋 调试 无缓存或过期")
    except Exception as e:
        print(f"❌ 调试 缓存读取异常: {e}")
        import traceback
        traceback.print_exc()
    return None

def _save_cached_hotlist(hotlist: str) -> None:
    """保存热榜到缓存"""
    try:
        now_ms = int(datetime.now().timestamp() * 1000)
        db.execute(
            "INSERT INTO zhihu_hotlist_cache (hotlist, created_at) VALUES (?, ?)",
            (hotlist, now_ms)
        )
        
        # 清理旧缓存，只保留最近的 10 条
        db.execute(
            """
            DELETE FROM zhihu_hotlist_cache 
            WHERE id NOT IN (SELECT id FROM zhihu_hotlist_cache ORDER BY created_at DESC LIMIT 10)
            """
        )
    except Exception:
        pass

def _format_hotlist(data: dict) -> str:
    """格式化热榜数据为易读的文本"""
    if not data or "Data" not in data or "Items" not in data["Data"]:
        return "抱歉，热榜数据格式异常"
    
    items = data["Data"]["Items"]
    if not items:
        return "暂无热榜内容"
    
    lines = []
    lines.append("🔥 知乎热榜\n")
    
    for idx, item in enumerate(items[:10], 1):  # 只显示前 10 条
        title = item.get("Title", "")
        url = item.get("Url", "")
        summary = item.get("Summary", "")
        
        lines.append(f"{idx}. {title}")
        if url:
            lines.append(f"   链接: {url}")
        if summary:
            lines.append(f"   摘要: {summary}")
        lines.append("")
    
    return "\n".join(lines)

async def get_zhihu_hotlist() -> Tuple[bool, str]:
    """获取知乎热榜
    
    Returns:
        (success, message): 是否成功，消息内容
    """
    # 先检查缓存
    cached_hotlist = _get_cached_hotlist(4)
    if cached_hotlist:
        return True, cached_hotlist
    
    try:
        zhihu_secret = os.getenv("ZHIHU_SECRET", "")
        if not zhihu_secret:
            return False, "抱歉，知乎 API 密钥未配置"
        
        timestamp = int(time.time())
        headers = {
            "Authorization": f"Bearer {zhihu_secret}",
            "X-Request-Timestamp": str(timestamp),
            "Content-Type": "application/json"
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://developer.zhihu.com/api/v1/content/hot_list?Limit=20",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("Code") == 0:
                    # 格式化热榜
                    formatted = _format_hotlist(data)
                    # 保存到缓存
                    _save_cached_hotlist(formatted)
                    return True, formatted
                else:
                    error_msg = data.get("Message", "未知错误")
                    return False, f"获取热榜失败：{error_msg}"
            else:
                return False, f"获取热榜失败，HTTP {response.status_code}"
    except Exception as e:
        return False, f"获取热榜时出错：{str(e)}"
