#!/usr/bin/env python3
"""Test weather module"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.skills.weather import is_weather_question, extract_location, get_weather
import asyncio

async def test_weather():
    test_messages = [
        "今天天气怎么样",
        "北京的天气如何",
        "明天上海会下雨吗",
        "你好，我想聊聊天",
    ]
    
    for msg in test_messages:
        print(f"\n📝 测试消息: {msg}")
        print(f"   📊 是天气问题: {is_weather_question(msg)}")
        
        if is_weather_question(msg):
            loc = extract_location(msg)
            print(f"   📍 提取位置: {loc}")
            
            success, weather_msg = await get_weather(loc)
            print(f"   🎯 成功: {success}")
            if success:
                print(f"   🌤️ 天气信息:\n{weather_msg}")

if __name__ == "__main__":
    asyncio.run(test_weather())
