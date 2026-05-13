#!/bin/bash
# ============================================
# 刘看山服务启动脚本
# 功能：启动 kanshan 相关服务（后端 + 前端 + sidecar）
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "============================================"
echo -e "${BLUE}🦊 刘看山服务启动脚本${NC}"
echo "============================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}📋 检查依赖...${NC}"
    
    # 检查 Python
    if command -v python3 &> /dev/null; then
        echo -e "  ${GREEN}✅ Python3 已安装${NC}"
    else
        echo -e "  ${RED}❌ 未找到 Python3${NC}"
        return 1
    fi
    
    # 检查 Node.js
    if command -v node &> /dev/null; then
        echo -e "  ${GREEN}✅ Node.js 已安装${NC}"
    else
        echo -e "  ${RED}❌ 未找到 Node.js${NC}"
        return 1
    fi
    
    return 0
}

# 停止之前可能运行的服务
stop_existing_services() {
    echo ""
    echo -e "${YELLOW}🧹 清理现有服务...${NC}"
    
    # 停止端口上的服务
    for port in 8000 5174 8788; do
        pids=$(lsof -ti:$port 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo -e "  停止端口 $port 上的服务 (PID: $pids)"
            kill $pids 2>/dev/null || true
            sleep 1
            # 强制杀掉还在运行的
            pids=$(lsof -ti:$port 2>/dev/null || true)
            if [ -n "$pids" ]; then
                kill -9 $pids 2>/dev/null || true
            fi
        fi
    done
    
    echo -e "  ${GREEN}✅ 清理完成${NC}"
}

# 启动后端
start_backend() {
    echo ""
    echo -e "${YELLOW}🚀 启动后端服务...${NC}"
    cd "$SCRIPT_DIR/backend"
    
    # 检查虚拟环境
    if [ ! -d ".venv" ]; then
        echo -e "  ${YELLOW}📦 创建虚拟环境...${NC}"
        python3 -m venv .venv
    fi
    
    # 激活虚拟环境
    source .venv/bin/activate
    
    # 安装依赖（如果需要）
    if [ ! -f ".deps_installed" ] || [ "requirements.txt" -nt ".deps_installed" ]; then
        echo -e "  ${YELLOW}📦 安装 Python 依赖...${NC}"
        pip install -r requirements.txt
        touch .deps_installed
    fi
    
    # 启动后端
    echo -e "  ${GREEN}✅ 启动后端服务（端口 8000）${NC}"
    nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$SCRIPT_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "  后端 PID: $BACKEND_PID"
    echo $BACKEND_PID > "$SCRIPT_DIR/backend.pid"
    cd "$SCRIPT_DIR"
}

# 启动 sidecar
start_sidecar() {
    echo ""
    echo -e "${YELLOW}🚀 启动 Sidecar 服务...${NC}"
    cd "$SCRIPT_DIR/sidecar"
    
    # 安装依赖（如果需要）
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        echo -e "  ${YELLOW}📦 安装 Sidecar 依赖...${NC}"
        npm install
    fi
    
    # 启动 sidecar
    echo -e "  ${GREEN}✅ 启动 Sidecar 服务（端口 8788）${NC}"
    nohup npm run dev > "$SCRIPT_DIR/sidecar.log" 2>&1 &
    SIDECAR_PID=$!
    echo "  Sidecar PID: $SIDECAR_PID"
    echo $SIDECAR_PID > "$SCRIPT_DIR/sidecar.pid"
    cd "$SCRIPT_DIR"
}

# 启动前端
start_frontend() {
    echo ""
    echo -e "${YELLOW}🚀 启动前端服务...${NC}"
    cd "$SCRIPT_DIR/web"
    
    # 安装依赖（如果需要）
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        echo -e "  ${YELLOW}📦 安装前端依赖...${NC}"
        npm install
    fi
    
    # 启动前端
    echo -e "  ${GREEN}✅ 启动前端服务（端口 5174）${NC}"
    nohup npm run dev > "$SCRIPT_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    echo "  前端 PID: $FRONTEND_PID"
    echo $FRONTEND_PID > "$SCRIPT_DIR/frontend.pid"
    cd "$SCRIPT_DIR"
}

# 等待服务启动
wait_for_services() {
    echo ""
    echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
    
    # 等待 sidecar
    echo -n "  等待 Sidecar（端口 8788）"
    for i in {1..30}; do
        if curl -s "http://localhost:8788/health" > /dev/null 2>&1; then
            echo -e " ${GREEN}✅${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done
    
    # 等待后端
    echo -n "  等待后端（端口 8000）"
    for i in {1..20}; do
        if curl -s "http://localhost:8000/claude/health" > /dev/null 2>&1; then
            echo -e " ${GREEN}✅${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done
    
    # 等待前端
    echo -n "  等待前端（端口 5174）"
    for i in {1..20}; do
        if curl -s "http://localhost:5174" > /dev/null 2>&1; then
            echo -e " ${GREEN}✅${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done
}

# 显示服务信息
show_info() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}🎉 服务启动完成！${NC}"
    echo "============================================"
    echo ""
    echo -e "${BLUE}📱 访问地址：${NC}"
    echo -e "  前端界面:  ${GREEN}http://localhost:5174${NC}"
    echo -e "  后端 API:  ${GREEN}http://localhost:8000${NC}"
    echo -e "  Sidecar:   ${GREEN}http://localhost:8788${NC}"
    echo ""
    echo -e "${BLUE}📋 管理命令：${NC}"
    echo -e "  查看日志: tail -f backend.log / tail -f frontend.log / tail -f sidecar.log"
    echo -e "  停止服务: ./stop.sh"
    echo -e "  运行测试: cd test && ./run_all.sh"
    echo ""
    echo "============================================"
}

# 主函数
main() {
    # 检查依赖
    if ! check_dependencies; then
        echo -e "${RED}❌ 依赖检查失败，请先安装所需依赖${NC}"
        exit 1
    fi
    
    # 停止现有服务
    stop_existing_services
    
    # 启动各服务
    start_sidecar
    start_backend
    start_frontend
    
    # 等待服务启动
    wait_for_services
    
    # 显示信息
    show_info
}

# 运行主函数
main
