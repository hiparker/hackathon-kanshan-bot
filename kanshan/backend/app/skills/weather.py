"""
天气技能模块：
- 使用 wttr.in 免费天气 API 服务
- 支持查询实时天气和明日预告
- 无需 API 密钥，可直接调用
- 支持缓存天气数据到数据库
"""
import re
import urllib.parse
import httpx
from datetime import datetime
from typing import Tuple, Optional
from zoneinfo import ZoneInfo
from .. import db

# 检测是否是天气相关问题的关键词
WEATHER_KEYWORDS = [
    "天气", "气温", "温度", "晴天", "雨天", "雪天", "阴天", "多云",
    "刮风", "风力", "湿度", "紫外线", "日出", "日落", "降水",
    "weather", "temperature", "rain", "sunny", "cloudy", "snow", "wind",
    "明天", "后天", "预报", "预告",
]

# 常用城市别名映射
CITY_ALIASES = {
    "北京": "北京",
    "上海": "上海",
    "广州": "广州",
    "深圳": "深圳",
    "杭州": "杭州",
    "南京": "南京",
    "成都": "成都",
    "重庆": "重庆",
    "武汉": "武汉",
    "西安": "西安",
}

def is_weather_question(message: str) -> bool:
    """检测问题是否与天气相关"""
    message_lower = message.lower()
    for keyword in WEATHER_KEYWORDS:
        if keyword.lower() in message_lower:
            return True
    return False

def extract_location(message: str) -> Optional[str]:
    """从问题中提取位置信息"""
    # 先检查常见城市
    for city in CITY_ALIASES:
        if city in message:
            return CITY_ALIASES[city]
    
    # 尝试提取地点（正则匹配）
    patterns = [
        r"在(.+?)[吗？?，。,\s]",
        r"去(.+?)[吗？?，。,\s]",
        r"(.+?)的天气",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, message)
        if match:
            location = match.group(1).strip()
            if len(location) >= 2 and len(location) < 20:
                return location
    
    # 默认返回北京
    return "北京"

def _get_today_str() -> str:
    """获取今天的日期字符串（上海时区）"""
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")

def _get_cached_weather(location: str, date: str) -> Optional[str]:
    """从缓存获取天气信息"""
    try:
        row = db.query_one(
            "SELECT weather FROM weather_cache WHERE location = ? AND date = ?",
            (location, date)
        )
        if row:
            return row["weather"]
    except Exception:
        pass
    return None

def _save_cached_weather(location: str, date: str, weather: str) -> None:
    """保存天气信息到缓存"""
    try:
        now_ms = int(datetime.now().timestamp() * 1000)
        db.execute(
            """
            INSERT OR REPLACE INTO weather_cache (location, date, weather, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (location, date, weather, now_ms)
        )
    except Exception:
        pass

async def get_weather(location: str) -> Tuple[bool, str]:
    """获取天气信息
    
    Args:
        location: 位置（城市名或地址）
        
    Returns:
        (success, message): 是否成功，消息内容
    """
    today = _get_today_str()
    
    # 先检查缓存
    cached_weather = _get_cached_weather(location, today)
    if cached_weather:
        return True, cached_weather
    
    try:
        # URL 编码
        encoded_location = urllib.parse.quote(location)
        
        # 获取当前天气的简洁格式
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 简洁天气
            response = await client.get(
                f"https://wttr.in/{encoded_location}?format=%l:+%c+%t+(feels+like+%f),+%w+wind,+%h+humidity"
            )
            
            if response.status_code == 200:
                current_weather = response.text.strip()
                
                # 获取明日预告（更简洁的格式）
                forecast_response = await client.get(f"https://wttr.in/{encoded_location}?format=%l:+%c+%t+for+tomorrow")
                if forecast_response.status_code == 200:
                    forecast = forecast_response.text.strip()
                    message = f"🌤️ 当前天气：{current_weather}\n\n📅 明日预告：{forecast}"
                else:
                    message = f"🌤️ 当前天气：{current_weather}"
                
                # 保存到缓存
                _save_cached_weather(location, today, message)
                
                return True, message
            else:
                return False, "抱歉，暂时无法获取天气信息，请稍后再试。"
    except Exception as e:
        return False, f"获取天气信息时出错：{str(e)}"

