#!/bin/bash
# ============================================
# 刘看山服务停止脚本
# 功能：停止 kanshan 相关服务
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo -e "${YELLOW}🛑 刘看山服务停止脚本${NC}"
echo "============================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 停止 PID 文件中的服务
stop_by_pidfile() {
    local service_name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "  ${YELLOW}停止 $service_name (PID: $pid)...${NC}"
            kill "$pid" 2>/dev/null || true
            sleep 1
            # 强制杀掉还在运行的
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            echo -e "  ${GREEN}✅ $service_name 已停止${NC}"
        fi
        rm -f "$pid_file"
    fi
}

# 停止端口上的服务
stop_by_port() {
    local port=$1
    local service_name=$2
    
    local pids=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo -e "  ${YELLOW}停止端口 $port 上的 $service_name...${NC}"
        kill $pids 2>/dev/null || true
        sleep 1
        # 强制杀掉还在运行的
        pids=$(lsof -ti:$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            kill -9 $pids 2>/dev/null || true
        fi
        echo -e "  ${GREEN}✅ $service_name 已停止${NC}"
    fi
}

# 主停止流程
main() {
    echo -e "${YELLOW}🧹 停止服务...${NC}"
    echo ""
    
    # 通过 PID 文件停止
    stop_by_pidfile "后端" "$SCRIPT_DIR/backend.pid"
    stop_by_pidfile "前端" "$SCRIPT_DIR/frontend.pid"
    
    # 通过端口停止（兜底方案）
    stop_by_port 8000 "后端"
    stop_by_port 5174 "前端"
    
    echo ""
    echo "============================================"
    echo -e "${GREEN}✅ 所有服务已停止${NC}"
    echo "============================================"
}

# 运行主函数
main

