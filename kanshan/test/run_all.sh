#!/bin/bash
# ============================================
# 综合测试脚本：运行所有 API 测试
# 功能描述: 顺序执行所有测试脚本，显示测试结果汇总
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "开始 API 测试"
echo "============================================"
echo ""

# 测试结果统计
PASSED=0
FAILED=0
TOTAL=0

# 逐个执行测试
for TEST_SCRIPT in $(ls -v 0*.sh 2>/dev/null); do
    if [ -f "$TEST_SCRIPT" ] && [ -x "$TEST_SCRIPT" ]; then
        TOTAL=$((TOTAL + 1))
        echo "--------------------------------------------"
        echo "正在运行: $TEST_SCRIPT"
        echo "--------------------------------------------"
        bash "$TEST_SCRIPT"
        RESULT=$?
        echo ""
        if [ $RESULT -eq 0 ]; then
            echo "✅ 测试通过: $TEST_SCRIPT"
            PASSED=$((PASSED + 1))
        else
            echo "❌ 测试失败: $TEST_SCRIPT"
            FAILED=$((FAILED + 1))
        fi
        echo ""
    fi
done

echo "============================================"
echo "测试结果汇总"
echo "============================================"
echo "总测试数: $TOTAL"
echo "✅ 通过: $PASSED"
echo "❌ 失败: $FAILED"
echo ""

if [ $FAILED -eq 0 ] && [ $TOTAL -gt 0 ]; then
    echo "🎉 所有测试通过！"
    exit 0
else
    echo "⚠️  有 $FAILED 个测试失败"
    exit 1
fi

