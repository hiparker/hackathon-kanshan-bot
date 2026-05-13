#!/bin/bash
# ============================================
# 测试 API: GET /claude/health
# 功能描述: Sidecar 健康检查，验证后端服务状态
# 验证方式: 发送 GET 请求，检查响应中的 ok 字段为 true
# ============================================

BASE_URL="http://localhost:8000"

echo "============================================"
echo "测试 API: GET /claude/health"
echo "============================================"

# 发送请求
RESPONSE=$(curl -s "$BASE_URL/claude/health")

# 显示完整响应
echo "响应内容："
echo "$RESPONSE"
echo ""

# 检查响应
if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ 测试通过！后端服务运行正常"
    exit 0
else
    echo "❌ 测试失败！后端服务可能有问题"
    exit 1
fi

