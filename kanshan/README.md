# 刘看山（Kanshan）- Claude 对话 API

简洁的 Claude 对话 API，包含：
- 用户隔离的对话历史（50 轮记忆）
- 每日调用限额（100 次/用户）
- 流式 SSE 响应
- 毛玻璃风格的 React 前端
- 天气技能（自动查询天气）

## 项目结构

```
kanshan/
├── backend/          # Python FastAPI 后端
│   ├── app/
│   │   ├── agent/        # 记忆 + 限流
│   │   ├── routes/       # Claude API 路由
│   │   ├── sidecar/      # Node.js Sidecar 客户端
│   │   ├── skills/       # 技能模块（天气等）
│   │   ├── config.py     # 配置管理
│   │   ├── db.py         # SQLite 数据库
│   │   └── main.py       # FastAPI 入口
│   ├── config/           # JSON 配置文件
│   └── .env
├── sidecar/          # Node.js TypeScript Sidecar（Claude Agent）
│   └── src/
├── web/              # React 前端（毛玻璃风格）
│   └── src/
├── test/             # API 测试脚本
├── start.sh          # 服务启动脚本
└── stop.sh           # 服务停止脚本
```

## 快速启动（推荐）

使用提供的脚本一键启动所有服务：

```bash
cd kanshan/
./start.sh
```

脚本会自动：
- 检查依赖（Python、Node.js）
- 停止现有的服务
- 启动后端（端口 8000）
- 启动前端（端口 5174）
- 显示访问地址和管理命令

停止服务：

```bash
./stop.sh
```

## 手动启动

### 1. 后端

```bash
cd kanshan/backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Sidecar

```bash
cd kanshan/sidecar
npm run dev
```

### 3. 前端

```bash
cd kanshan/web
npm run dev
# 访问 http://localhost:5174
```

## 功能特性

### Claude 对话
- 支持流式和非流式响应
- 会话历史管理
- 记忆保存和加载

### 天气技能
- 自动检测天气相关问题
- 支持全球城市查询
- 使用 wttr.in 免费天气 API
- 示例问题："北京今天天气怎么样？"

### API 测试
- 完整的测试脚本
- 在 `test/` 目录下
- 运行 `cd test && ./run_all.sh` 执行所有测试

## API 接口

| 端点 | 说明 |
|------|------|
| `GET /` | API 信息 |
| `GET /claude/health` | 健康检查 |
| `GET /claude/usage?userId=` | 用户配额查询 |
| `POST /claude/sessions` | 创建会话 |
| `GET /claude/sessions?userId=` | 列出会话 |
| `GET /claude/sessions/{id}/messages` | 获取会话消息 |
| `POST /claude/chat` | 对话（流式/非流式） |

请求示例：
```json
{
  "userId": "demo",
  "message": "你好！",
  "stream": true
}
```

## 配置

编辑 `kanshan/backend/config/config.json`：
```json
{
  "rateLimit": {
    "default": {
      "dailyChatLimit": 100
    }
  }
}
```

## 服务管理

### 查看日志
```bash
# 后端日志
tail -f backend.log

# 前端日志
tail -f frontend.log
```

### 运行测试
```bash
cd test/
./run_all.sh
```

### 访问地址
- 前端界面：http://localhost:5174
- 后端 API：http://localhost:8000
