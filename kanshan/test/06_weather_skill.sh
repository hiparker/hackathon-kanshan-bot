#!/bin/bash
# ============================================
# 测试 API: POST /claude/chat (天气技能)
# 功能描述：测试天气技能是否正常工作
# 验证方式：发送天气相关问题，检查是否返回天气信息
# ============================================

BASE_URL="http://localhost:8000"
USER_ID="demo"

echo "============================================"
echo "测试天气技能 API"
echo "============================================"
echo ""

# 测试1: 基本天气查询
echo "测试1: 查询北京天气..."
RESPONSE=$(curl -s -X POST "$BASE_URL/claude/chat" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"北京今天天气怎么样？\", \"stream\": false}")

echo "响应内容："
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""
if echo "$RESPONSE" | grep -q "北京\|天气\|🌤️\|°C"; then
    echo "✅ 测试1通过！"
else
    echo "⚠️ 测试1可能有问题"
fi

echo ""

# 测试2: 其他城市
echo "测试2: 查询上海天气..."
RESPONSE=$(curl -s -X POST "$BASE_URL/claude/chat" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$USER_ID\", \"message\": \"上海的天气\", \"stream\": false}")

echo "响应内容："
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""
if echo "$RESPONSE" | grep -q "上海\|天气\|🌤️\|°C"; then
    echo "✅ 测试2通过！"
else
    echo "⚠️ 测试2可能有问题"
fi

echo ""
echo "============================================"
echo "天气技能测试完成"
echo "============================================"

