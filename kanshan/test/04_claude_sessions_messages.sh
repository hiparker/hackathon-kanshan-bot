#!/bin/bash
# ============================================
# 测试 API: GET /claude/sessions/{sessionId}/messages
# 功能描述: 从数据库获取指定会话的干净历史消息（只显示用户和助手的消息）
# 验证方式: 先获取一个会话，然后查询该会话的消息
# ============================================

BASE_URL="http://localhost:8000"
USER_ID="demo"

echo "============================================"
echo "测试 API: GET /claude/sessions/{sessionId}/messages"
echo "============================================"

# 第一步：获取一个有效的会话ID
SESSIONS_RESPONSE=$(curl -s "$BASE_URL/claude/sessions?userId=$USER_ID")
SESSION_ID=$(echo "$SESSIONS_RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
sessions = data.get("sessions", [])
if sessions:
    print(sessions[0].get("sessionId", ""))
' 2>/dev/null)

# 如果 Python 解析失败，尝试用 grep
if [ -z "$SESSION_ID" ]; then
    SESSION_ID=$(echo "$SESSIONS_RESPONSE" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [ -z "$SESSION_ID" ]; then
    echo "⚠️  没有找到会话，先创建一个新会话..."
    CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/claude/sessions" \
      -H "Content-Type: application/json" \
      -d "{\"userId\":\"$USER_ID\"}")
    SESSION_ID=$(echo "$CREATE_RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(data.get("sessionId", ""))
' 2>/dev/null)
    if [ -z "$SESSION_ID" ]; then
        SESSION_ID=$(echo "$CREATE_RESPONSE" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
fi

if [ -z "$SESSION_ID" ]; then
    echo "❌ 无法获取或创建会话ID"
    exit 1
fi

echo "使用会话ID: $SESSION_ID"
echo ""

# 第二步：查询该会话的消息
MESSAGES_RESPONSE=$(curl -s "$BASE_URL/claude/sessions/$SESSION_ID/messages")

echo "响应内容："
echo "$MESSAGES_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$MESSAGES_RESPONSE"
echo ""

# 检查响应
if echo "$MESSAGES_RESPONSE" | grep -q '\['; then
    MESSAGE_COUNT=$(echo "$MESSAGES_RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(len(data))
' 2>/dev/null)
    if [ -z "$MESSAGE_COUNT" ]; then
        MESSAGE_COUNT=$(echo "$MESSAGES_RESPONSE" | grep -o '"role"' | wc -l)
    fi
    echo "✅ 测试通过！找到 $MESSAGE_COUNT 条消息"
    exit 0
else
    echo "❌ 测试失败！响应不是有效数组"
    exit 1
fi

