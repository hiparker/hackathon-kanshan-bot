#!/bin/bash
# ============================================
# 测试 API: GET /claude/sessions/{sessionId}/history
# 功能描述: 从 sidecar 获取会话的完整历史（包含所有事件）
# 验证方式: 先获取一个会话，然后查询该会话的完整历史
# ============================================

BASE_URL="http://localhost:8000"
USER_ID="demo"

echo "============================================"
echo "测试 API: GET /claude/sessions/{sessionId}/history"
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

# 第二步：查询该会话的完整历史
HISTORY_RESPONSE=$(curl -s "$BASE_URL/claude/sessions/$SESSION_ID/history")

echo "响应内容（前500字符）："
echo "${HISTORY_RESPONSE:0:500}"
echo "..."
echo ""

# 检查响应
if echo "$HISTORY_RESPONSE" | grep -q '\['; then
    EVENT_COUNT=$(echo "$HISTORY_RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(len(data))
' 2>/dev/null)
    if [ -z "$EVENT_COUNT" ]; then
        EVENT_COUNT=$(echo "$HISTORY_RESPONSE" | grep -o '"role"' | wc -l)
    fi
    echo "✅ 测试通过！找到 $EVENT_COUNT 个事件"
    exit 0
else
    echo "❌ 测试失败！响应不是有效数组"
    exit 1
fi

