#!/bin/bash
# ============================================
# 测试 API: GET /claude/sessions?userId=demo
# 功能描述: 列出指定用户的历史会话
# 验证方式: 发送 GET 请求，检查返回结构是否包含 sessions 字段
# ============================================

BASE_URL="http://localhost:8000"
USER_ID="demo"

echo "============================================"
echo "测试 API: GET /claude/sessions?userId=$USER_ID"
echo "============================================"

# 发送请求
RESPONSE=$(curl -s "$BASE_URL/claude/sessions?userId=$USER_ID")

# 显示响应
echo "响应内容："
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# 检查响应
if echo "$RESPONSE" | grep -q '"sessions"'; then
    SESSION_COUNT=$(echo "$RESPONSE" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(len(data.get("sessions", [])))
' 2>/dev/null)
    if [ -z "$SESSION_COUNT" ]; then
        # 如果解析失败，尝试其他方式
        SESSION_COUNT=$(echo "$RESPONSE" | grep -o '"sessionId"' | wc -l)
    fi
    echo "✅ 测试通过！找到 $SESSION_COUNT 个会话"
    exit 0
else
    echo "❌ 测试失败！响应结构不正确"
    exit 1
fi

