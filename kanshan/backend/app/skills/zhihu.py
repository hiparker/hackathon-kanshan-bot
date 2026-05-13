"""
知乎热榜技能模块：
- 使用知乎开放平台 API 获取热榜
- 支持缓存热榜数据，每 4 小时刷新一次
- 智能推荐 3 条不重复的热榜
- 为每条热榜提供热门评论、刘看山评论、对立观点和其他层面观点
- 通过 Claude 生成真实的观点并存入数据库缓存
"""
import time
import json
import os
import httpx
from typing import Tuple, Optional, List, Dict
from datetime import datetime
from .. import db
from ..config import settings
from ..sidecar import get_client

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


def _get_cached_hotlist(max_age_hours: int = 4) -> Optional[List[Dict]]:
    """从缓存获取热榜（返回结构化数据）"""
    try:
        max_age_ms = max_age_hours * 60 * 60 * 1000
        now_ms = int(datetime.now().timestamp() * 1000)
        
        # 获取最新的条目
        items = db.query_all(
            "SELECT * FROM zhihu_hotlist_items WHERE fetched_at >= ? ORDER BY fetched_at DESC, rank ASC",
            (now_ms - max_age_ms,)
        )
        
        if items:
            return items
    except Exception as e:
        print(f"❌ 缓存读取异常: {e}")
    return None


def _save_hotlist_items(items: List[Dict]) -> None:
    """保存热榜条目到数据库"""
    now_ms = int(datetime.now().timestamp() * 1000)
    
    for idx, item in enumerate(items):
        try:
            # 转换为字典，确保能使用 .get()
            item_dict = dict(item) if hasattr(item, 'keys') else item
            
            # 检查是否已存在 - 注意 API 返回的字段是大写开头
            url = item_dict.get("Url", "")
            if not url:
                continue
                
            title = item_dict.get("Title", "")
            summary = item_dict.get("Summary", "")
            thumbnail = item_dict.get("ThumbnailUrl", "")
            
            existing = db.query_one(
                "SELECT id FROM zhihu_hotlist_items WHERE url = ?",
                (url,)
            )
            
            if existing:
                db.execute(
                    """
                    UPDATE zhihu_hotlist_items 
                    SET title = ?, summary = ?, thumbnail = ?, rank = ?, fetched_at = ?
                    WHERE url = ?
                    """,
                    (
                        title,
                        summary,
                        thumbnail,
                        idx + 1,
                        now_ms,
                        url
                    )
                )
            else:
                db.execute(
                    """
                    INSERT INTO zhihu_hotlist_items 
                    (title, url, summary, thumbnail, rank, created_at, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        title,
                        url,
                        summary,
                        thumbnail,
                        idx + 1,
                        now_ms,
                        now_ms
                    )
                )
        except Exception as e:
            print(f"❌ 保存热榜条目失败: {e}")


def _get_user_viewed_items(user_id: str) -> List[int]:
    """获取用户已查看的热榜条目 ID"""
    try:
        rows = db.query_all(
            "SELECT hotlist_item_id FROM zhihu_user_history WHERE user_id = ? ORDER BY viewed_at DESC",
            (user_id,)
        )
        return [row["hotlist_item_id"] for row in rows]
    except Exception as e:
        print(f"❌ 获取用户查看历史失败: {e}")
        return []


def _record_user_view(user_id: str, item_id: int) -> None:
    """记录用户查看了某条热榜"""
    try:
        now_ms = int(datetime.now().timestamp() * 1000)
        db.execute(
            "INSERT INTO zhihu_user_history (user_id, hotlist_item_id, viewed_at) VALUES (?, ?, ?)",
            (user_id, item_id, now_ms)
        )
    except Exception as e:
        print(f"❌ 记录用户查看失败: {e}")


async def _generate_comments_with_claude(item: Dict) -> Optional[Dict]:
    """通过 Claude 为热榜条目生成观点"""
    try:
        title = item.get("title", "")
        summary = item.get("summary", "")
        
        # 构建 Claude 的系统提示和用户问题
        system_prompt = """你是知乎热榜观点分析助手。请以 JSON 格式返回观点，包含以下字段：
- hot_comment：1-2 句热门评论模拟
- liukanshan_comment：以刘看山（北极狐）的语气发表 2-3 句观点
- opposing_view：对立观点，2-3 句话
- other_perspective：其他层面视角，2-3 句话

直接返回 JSON，不要其他内容！"""
        
        user_message = f"""请分析这个知乎热榜问题：
标题：{title}
摘要：{summary}

返回 JSON 格式，确保可被直接解析。"""
        
        # 调用 Sidecar (Claude)
        client = get_client()
        
        options = {
            "systemPrompt": system_prompt
        }
        
        response = await client.chat(user_message, options=options)
        
        reply = response.get("reply", "")
        
        # 尝试解析 JSON
        try:
            # 清理回复内容，提取 JSON 部分
            json_str = reply
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0].strip()
            elif "```" in json_str:
                json_str = json_str.split("```")[1].strip()
            
            result = json.loads(json_str)
            
            # 确保所有字段都存在
            comments = {
                "hot_comment": result.get("hot_comment", "大家都在讨论这个话题！"),
                "liukanshan_comment": result.get("liukanshan_comment", "作为一只北极狐，我觉得这个话题很有意思！"),
                "opposing_view": result.get("opposing_view", "不过从另一个角度来看，这个问题也有不同的看法..."),
                "other_perspective": result.get("other_perspective", "除了这些，我们还可以从经济、文化等多个维度来分析...")
            }
            
            return comments
        except Exception as e:
            print(f"❌ 解析 Claude 回复失败: {e}")
            print(f"Claude 回复内容: {reply}")
            
            # 如果解析失败，返回一个默认结构
            return {
                "hot_comment": "大家都在讨论这个话题！",
                "liukanshan_comment": "作为一只北极狐，我觉得这个话题很有意思！",
                "opposing_view": "不过从另一个角度来看，这个问题也有不同的看法...",
                "other_perspective": "除了这些，我们还可以从经济、文化等多个维度来分析..."
            }
    except Exception as e:
        print(f"❌ 调用 Claude 生成观点失败: {e}")
        import traceback
        traceback.print_exc()
        return None


async def _get_or_create_comments(item_id: int, item: Dict) -> Optional[Dict]:
    """获取或创建热榜条目评论（如果没有，调用 Claude 生成）"""
    try:
        # 先检查是否已有评论
        row = db.query_one(
            "SELECT * FROM zhihu_hotlist_comments WHERE hotlist_item_id = ?",
            (item_id,)
        )
        
        if row:
            return {
                "hot_comment": row["hot_comment"],
                "liukanshan_comment": row["liukanshan_comment"],
                "opposing_view": row["opposing_view"],
                "other_perspective": row["other_perspective"]
            }
        
        # 如果没有评论，生成并保存
        item_dict = dict(item) if hasattr(item, 'keys') else item
        
        print(f"📋 为热榜条目生成观点：{item_dict.get('title', '')[:50]}...")
        
        # 调用 Claude 生成观点
        comments = await _generate_comments_with_claude(item_dict)
        
        if not comments:
            comments = {
                "hot_comment": "大家都在讨论这个话题！",
                "liukanshan_comment": "作为一只北极狐，我觉得这个话题很有意思！",
                "opposing_view": "不过从另一个角度来看，这个问题也有不同的看法...",
                "other_perspective": "除了这些，我们还可以从经济、文化等多个维度来分析..."
            }
        
        # 保存到数据库
        now_ms = int(datetime.now().timestamp() * 1000)
        db.execute(
            """
            INSERT INTO zhihu_hotlist_comments 
            (hotlist_item_id, hot_comment, liukanshan_comment, opposing_view, other_perspective, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                comments["hot_comment"],
                comments["liukanshan_comment"],
                comments["opposing_view"],
                comments["other_perspective"],
                now_ms
            )
        )
        
        return comments
    except Exception as e:
        print(f"❌ 获取/创建评论失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def _format_recommended_hotlist(items: List[Dict], user_id: str) -> str:
    """格式化推荐的热榜"""
    lines = []
    lines.append("来啦！🦊 根据你的兴趣，为你推荐 3 条知乎热榜：")
    lines.append("")
    
    for idx, item in enumerate(items, 1):
        lines.append(f"🔥 {idx}. {item['title']}")
        lines.append(f"🔗 链接：{item['url']}")
        
        if item.get("comments"):
            comments = item["comments"]
            lines.append(f"💬 热门评论：{comments['hot_comment']}")
            lines.append(f"🦊 刘看山观点：{comments['liukanshan_comment']}")
            lines.append(f"🤔 对立观点：{comments['opposing_view']}")
            lines.append(f"🌐 其他视角：{comments['other_perspective']}")
        
        lines.append("")
    
    return "\n".join(lines)


async def get_zhihu_hotlist(user_id: Optional[str] = None) -> Tuple[bool, str]:
    """获取知乎热榜并智能推荐
    
    Args:
        user_id: 用户 ID，用于个性化推荐
        
    Returns:
        (success, message): 是否成功，消息内容
    """
    # 先检查缓存
    cached_items = _get_cached_hotlist(4)
    
    if not cached_items:
        try:
            zhihu_secret = settings.ZHIHU_SECRET
            
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
                    "https://developer.zhihu.com/api/v1/content/hot_list?Limit=30",
                    headers=headers
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    if data.get("Code") == 0:
                        items = data.get("Data", {}).get("Items", [])
                        # 保存到数据库
                        _save_hotlist_items(items)
                        cached_items = _get_cached_hotlist(4)
                    else:
                        error_msg = data.get("Message", "未知错误")
                        return False, f"获取热榜失败：{error_msg}"
                else:
                    return False, f"获取热榜失败，HTTP {response.status_code}"
        except Exception as e:
            print(f"❌ 获取热榜异常: {e}")
            return False, f"获取热榜时出错：{str(e)}"
    
    if not cached_items:
        return False, "暂无热榜内容"
    
    # 选择 3 条推荐内容（排除已查看的）
    viewed_ids = _get_user_viewed_items(user_id) if user_id else []
    
    recommended_items = []
    for item in cached_items:
        item_dict = dict(item)
        if item_dict["id"] not in viewed_ids and len(recommended_items) < 3:
            # 获取评论（可能需要调用 Claude 生成）
            comments = await _get_or_create_comments(item_dict["id"], item_dict)
            item_with_comments = dict(item_dict)
            item_with_comments["comments"] = comments
            recommended_items.append(item_with_comments)
            
            # 记录查看
            if user_id:
                _record_user_view(user_id, item_dict["id"])
    
    # 如果不够 3 条，用已查看的补充
    if len(recommended_items) < 3 and viewed_ids:
        for item in cached_items:
            if len(recommended_items) >= 3:
                break
            item_dict = dict(item)
            if item_dict["id"] in viewed_ids:
                comments = await _get_or_create_comments(item_dict["id"], item_dict)
                item_with_comments = dict(item_dict)
                item_with_comments["comments"] = comments
                recommended_items.append(item_with_comments)
    
    # 格式化输出
    result = _format_recommended_hotlist(recommended_items, user_id)
    
    return True, result
