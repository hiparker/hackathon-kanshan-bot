#!/bin/bash
# ============================================
# 测试 API: POST /claude/sessions
# 功能描述: 创建新的会话
# 验证方式: 发送 POST 请求，检查是否返回有效的 sessionId
# ============================================

BASE_URL="http://localhost:8000"
USER_ID="demo"

echo "============================================"
echo "测试 API: POST /claude/sessions"
echo "============================================"

# 发送请求
RESPONSE=$(curl -s -X POST "$BASE_URL/claude/sessions" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\"}")

# 显示响应
echo "响应内容："
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# 检查响应
if echo "$RESPONSE" | grep -q '"sessionId"'; then
    SESSION_ID=$(echo "$RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(data.get("sessionId", ""))
' 2>/dev/null)
    if [ -z "$SESSION_ID" ]; then
        SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
    echo "✅ 测试通过！创建会话成功，sessionId: $SESSION_ID"
    exit 0
else
    echo "❌ 测试失败！会话创建失败"
    exit 1
fi

