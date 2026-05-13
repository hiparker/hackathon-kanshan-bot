"""
天气技能模块：
- 使用 wttr.in 免费天气 API 服务
- 支持查询实时天气和明日预告
- 无需 API 密钥，可直接调用
"""
import re
import urllib.parse
import httpx
from typing import Tuple, Optional

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
    # 简单的模式：在 "在"、"去"、"北京"、"上海" 等词附近
    patterns = [
        r"在(.+?)[吗？?，。,\s]",
        r"去(.+?)[吗？?，。,\s]",
        r"(.+?)的天气",
        r"(.+?)[的天]",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, message)
        if match:
            location = match.group(1).strip()
            if len(location) > 0 and len(location) < 20:
                return location
    
    # 默认返回北京
    return "北京"

async def get_weather(location: str) -> Tuple[bool, str]:
    """获取天气信息
    
    Args:
        location: 位置（城市名或地址）
        
    Returns:
        (success, message): 是否成功，消息内容
    """
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
                
                return True, message
            else:
                return False, "抱歉，暂时无法获取天气信息，请稍后再试。"
    except Exception as e:
        return False, f"获取天气信息时出错：{str(e)}"

