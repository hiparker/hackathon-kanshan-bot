# 刘看山（Kanshan）API 文档

> 版本：0.1.0 | 协议：HTTP + SSE | 数据格式：JSON

---

## 目录

1. [基础信息](#一基础信息)
2. [Agent 对话](#二agent-对话)
3. [Claude Sidecar 对话](#三claude-sidecar-对话)
4. [远程 Skills](#四远程-skills)
5. [定时提醒](#五定时提醒)
6. [番茄钟](#六番茄钟)
7. [内容推送](#七内容推送)
8. [实时事件流（SSE）](#八实时事件流sse)
9. [管理端](#九管理端)
10. [健康检查](#十健康检查)

---

## 一、基础信息

### 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| Python 后端 | `http://localhost:8787` | Agent 核心、记忆、限流、定时任务 |
| Node Sidecar | `http://localhost:8788` | Claude Agent SDK 推理引擎 |
| Web 调试台 | `http://localhost:5173` | 自动代理 `/api` → `:8787` |

### 通用约定

- 所有请求头需包含 `Content-Type: application/json`
- 时间字段使用毫秒时间戳（`db.now_ms()`）
- 用户标识 `userId` 用于限流和记忆隔离
- 管理端接口需携带 `X-Admin-Token` 请求头

### 通用错误响应格式

```json
{
  "detail": {
    "error": "ERROR_CODE",
    "message": "人类可读的错误描述"
  }
}
```

| 状态码 | 含义 |
|--------|------|
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 429 | 超出每日调用限额 |
| 502 | 上游服务（LLM / Sidecar）不可达 |

---

## 二、Agent 对话

### `POST /chat` — Agent 对话

使用 Kimi API（兼容 OpenAI 协议）驱动的 Agent，支持 50 轮短期记忆、长期记忆自动压缩、工具调用、每日限流。

#### 请求

```json
{
  "userId": "demo",
  "sessionId": "s_abc123def456",
  "message": "北京今天天气怎么样？"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | 是 | 用户标识，用于限流和记忆隔离 |
| `sessionId` | string | 否 | 会话 ID，留空自动生成 |
| `message` | string | 是 | 用户消息内容 |

#### 响应

```json
{
  "sessionId": "s_abc123def456",
  "reply": "北京今天晴，22°C，南风2级，适合出门走走！🦊",
  "toolCalls": [
    {
      "name": "get_weather",
      "arguments": {"city": "北京"},
      "result": {
        "city": "北京",
        "weather": "晴",
        "temperature": "22°C",
        "wind": "南风 2级",
        "humidity": "45%"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 450,
    "completion_tokens": 120,
    "total_tokens": 570
  },
  "memory": {
    "compressed": false,
    "shortTermCount": 3,
    "summaryCount": 0
  },
  "quota": {
    "limit": 200,
    "used": 5,
    "remaining": 195
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | 会话 ID（传入或自动生成） |
| `reply` | string | Agent 回复文本 |
| `toolCalls` | array | 本次调用的工具列表（含参数和结果） |
| `usage` | object | Token 用量统计 |
| `memory` | object | 记忆状态（是否压缩、短期条数、摘要条数） |
| `quota` | object | 当日配额使用情况 |

#### 错误示例

**429 限流：**
```json
{
  "detail": {
    "error": "RATE_LIMIT",
    "kind": "chat",
    "limit": 200,
    "used": 200
  }
}
```

**502 LLM 错误：**
```json
{
  "detail": {
    "error": "LLM_ERROR",
    "message": "API returned error: 401 invalid api key"
  }
}
```

#### 调用示例

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","message":"北京今天天气怎么样？"}'
```

#### 多轮对话示例

```bash
# 第一轮
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","message":"你好，我叫小明"}'

# 第二轮（传入上一轮的 sessionId）
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","sessionId":"s_abc123","message":"我叫什么名字？"}'

# 第三轮
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","sessionId":"s_abc123","message":"知乎热榜前5条是什么？"}'
```

---

## 三、Claude Sidecar 对话

### `GET /claude/health` — Sidecar 健康检查

```bash
curl http://localhost:8787/claude/health
```

**响应：**
```json
{
  "ok": true,
  "runtime": "sdk",
  "model": "kimi-for-coding",
  "hasApiKey": true,
  "sessions": {
    "total": 3,
    "running": 1
  },
  "mcpServers": []
}
```

### `GET /claude/tools` — 列出可用工具

```bash
curl http://localhost:8787/claude/tools
```

**响应：**
```json
{
  "tools": [
    {"name": "Bash", "description": "执行 shell 命令"},
    {"name": "Read", "description": "读取文件"},
    {"name": "Write", "description": "写入文件"},
    {"name": "Edit", "description": "编辑文件"}
  ]
}
```

### `POST /claude/sessions` — 创建会话

```json
{
  "userId": "demo",
  "options": {
    "systemPrompt": "你是一个友好的助手",
    "model": "kimi-for-coding",
    "allowedTools": ["Bash", "Read", "Write"],
    "permissionMode": "auto"
  }
}
```

**响应：**
```json
{
  "sessionId": "sc_abc123def456",
  "sdkSessionId": "sdk_xxx",
  "createdAt": 1715000000000
}
```

### `GET /claude/sessions?userId=demo` — 列出会话

```bash
curl "http://localhost:8787/claude/sessions?userId=demo"
```

### `DELETE /claude/sessions/{id}` — 删除会话

```bash
curl -X DELETE http://localhost:8787/claude/sessions/sc_abc123def456
```

### `POST /claude/sessions/{id}/abort` — 中止运行中的会话

```bash
curl -X POST http://localhost:8787/claude/sessions/sc_abc123def456/abort
```

### `GET /claude/sessions/{sessionId}/messages` — 获取干净的会话消息

从数据库获取指定会话的消息，只返回用户和助手的消息，过滤掉中间事件。

```bash
curl http://localhost:8787/claude/sessions/sc_abc123def456/messages
```

**响应：**
```json
[
  {
    "role": "user",
    "content": "你好，刘看山！"
  },
  {
    "role": "assistant",
    "content": "你好呀！我是住在你电脑里的刘看山，很高兴认识你！🦊"
  }
]
```

### `GET /claude/sessions/{sessionId}/history` — 获取完整会话历史

从 sidecar 获取会话的完整历史记录，包含所有事件（text_delta、usage、session_complete 等）。

```bash
curl http://localhost:8787/claude/sessions/sc_abc123def456/history
```

**响应：**
```json
{
  "messages": [
    {
      "id": "abc123",
      "sessionId": "sc_abc123def456",
      "role": "user",
      "content": "你好",
      "timestamp": 1715000000000
    },
    {
      "id": "def456",
      "sessionId": "sc_abc123def456",
      "role": "event",
      "content": "text_delta",
      "event": {
        "kind": "text_delta",
        "text": "你"
      },
      "timestamp": 1715000000001
    },
    {
      "id": "ghi789",
      "sessionId": "sc_abc123def456",
      "role": "assistant",
      "content": "你好呀！",
      "timestamp": 1715000000002
    }
  ]
}
```

### `POST /claude/chat` — Claude 对话

支持非流式和流式（SSE）两种模式。

#### 非流式请求

```json
{
  "userId": "demo",
  "sessionId": "sc_abc123def456",
  "message": "帮我写一个 Python 脚本",
  "stream": false,
  "options": {
    "permissionMode": "auto",
    "allowedTools": ["Bash", "Read", "Write", "Edit"]
  }
}
```

**响应：**
```json
{
  "sessionId": "sc_abc123def456",
  "sdkSessionId": "sdk_xxx",
  "reply": "好的，我来帮你写一个 Python 脚本...",
  "usage": {
    "inputTokens": 500,
    "outputTokens": 300
  },
  "costUsd": 0.002,
  "durationMs": 3500,
  "events": [
    {"type": "tool_use", "name": "Write", "input": {"path": "script.py"}}
  ],
  "quota": {
    "limit": 200,
    "used": 6,
    "remaining": 194
  }
}
```

#### 流式请求

```json
{
  "userId": "demo",
  "message": "帮我写一个 Python 脚本",
  "stream": true
}
```

流式响应通过 SSE 推送，每个事件格式：

```
event: {eventType}
data: {jsonData}

```

| 事件类型 | 说明 | data 字段 |
|----------|------|-----------|
| `chat:system-init` | 会话初始化 | `{sessionId, sdkSessionId}` |
| `chat:message-chunk` | 文本增量 | `{text: "..."}` |
| `chat:thinking-start` | 开始思考 | `{}` |
| `chat:thinking-chunk` | 思考过程增量 | `{thinking: "..."}` |
| `chat:tool-use-start` | 开始调用工具 | `{name, input}` |
| `chat:tool-result-complete` | 工具调用完成 | `{name, result}` |
| `chat:message-complete` | 消息完成 | `{sessionId, usage}` |
| `chat:message-error` | 消息错误 | `{message}` |
| `chat:status` | 状态变更 | `{status}` |

#### 流式调用示例

```bash
curl -N -X POST http://localhost:8787/claude/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","message":"写一个 hello world","stream":true}'
```

---

## 四、远程 Skills

### `GET /skills` — 列出所有 Skill

```bash
curl http://localhost:8787/skills
```

**响应：**
```json
{
  "skills": [
    {
      "name": "get_weather",
      "description": "查询指定城市的实时天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {"type": "string", "description": "城市名称"}
        },
        "required": ["city"]
      }
    },
    {
      "name": "get_zhihu_hot",
      "description": "获取知乎热榜",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {"type": "integer", "description": "返回条数，默认10"}
        }
      }
    }
  ]
}
```

### `POST /skills/invoke` — 直接调用 Skill

```json
{
  "userId": "demo",
  "name": "get_weather",
  "arguments": {"city": "北京"}
}
```

**响应：**
```json
{
  "name": "get_weather",
  "result": {
    "city": "北京",
    "weather": "晴",
    "temperature": "22°C",
    "wind": "南风 2级",
    "humidity": "45%",
    "source": "amap"
  }
}
```

#### 调用示例

```bash
# 查询天气
curl -X POST http://localhost:8787/skills/invoke \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","name":"get_weather","arguments":{"city":"上海"}}'

# 获取知乎热榜
curl -X POST http://localhost:8787/skills/invoke \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","name":"get_zhihu_hot","arguments":{"limit":5}}'
```

---

## 五、定时提醒

### `GET /reminders?userId=demo` — 列出提醒

```bash
curl "http://localhost:8787/reminders?userId=demo"
```

**响应：**
```json
{
  "items": [
    {
      "id": 1,
      "user_id": "demo",
      "kind": "drink_water",
      "title": "喝水时间",
      "message": "记得喝杯水哦～",
      "cron_expr": "*/30 9-18 * * *",
      "enabled": 1,
      "created_at": 1715000000000
    }
  ]
}
```

### `POST /reminders` — 创建提醒

```json
{
  "userId": "demo",
  "kind": "custom",
  "title": "站起来动动",
  "message": "已经专注很久啦，起身走两步～",
  "cronExpr": "*/30 9-18 * * *",
  "enabled": true
}
```

**响应：**
```json
{"id": 2}
```

### `PATCH /reminders/{id}?enabled=true` — 启用/禁用

```bash
curl -X PATCH "http://localhost:8787/reminders/1?enabled=false"
```

**响应：**
```json
{"id": 1, "enabled": false}
```

### `DELETE /reminders/{id}` — 删除提醒

```bash
curl -X DELETE http://localhost:8787/reminders/1
```

**响应：**
```json
{"ok": true}
```

### `POST /reminders/trigger` — 手动触发提醒

```json
{
  "userId": "demo",
  "kind": "drink_water"
}
```

**响应：**
```json
{
  "sent": 1,
  "payload": {
    "kind": "drink_water",
    "title": "喝水时间",
    "message": "记得喝杯水哦～",
    "source": "manual"
  }
}
```

#### 内置提醒类型

| kind | 说明 | 默认 cron |
|------|------|-----------|
| `drink_water` | 喝水提醒 | `*/30 9-18 * * *` |
| `stretch` | 伸展提醒 | `*/45 9-18 * * *` |
| `rest_eyes` | 护眼提醒 | `*/20 9-18 * * *` |

#### 调用示例

```bash
# 手动触发喝水提醒
curl -X POST http://localhost:8787/reminders/trigger \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","kind":"drink_water"}'
```

---

## 六、番茄钟

### `POST /pomodoro/start` — 开始番茄钟

```json
{
  "userId": "demo",
  "task": "写刘看山后端",
  "workMin": 25,
  "breakMin": 5
}
```

**响应：**
```json
{
  "id": 1,
  "state": "work",
  "task": "写刘看山后端",
  "work_min": 25,
  "break_min": 5,
  "ends_at": 1715001500000,
  "user_id": "demo"
}
```

### `POST /pomodoro/{id}/cancel` — 取消番茄钟

```bash
curl -X POST http://localhost:8787/pomodoro/1/cancel
```

**响应：**
```json
{"ok": true}
```

### `GET /pomodoro/active` — 进行中的番茄钟

```bash
curl http://localhost:8787/pomodoro/active
```

**响应：**
```json
{
  "items": [
    {
      "id": 1,
      "state": "work",
      "task": "写刘看山后端",
      "work_min": 25,
      "break_min": 5,
      "ends_at": 1715001500000,
      "user_id": "demo"
    }
  ]
}
```

#### 番茄钟状态事件

番茄钟状态变更通过 SSE `pomodoro` 事件推送：

| 事件 data.state | 说明 |
|----------------|------|
| `work_start` | 工作时段开始 |
| `work_end` | 工作时段结束（进入休息） |
| `break_end` | 休息时段结束 |
| `cancelled` | 番茄钟被取消 |

#### 调用示例

```bash
# 开始一个 25 分钟番茄钟
curl -X POST http://localhost:8787/pomodoro/start \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","task":"写代码","workMin":25,"breakMin":5}'

# 查看进行中的番茄钟
curl http://localhost:8787/pomodoro/active
```

---

## 七、内容推送

### `GET /content` — 内容库列表

```bash
curl http://localhost:8787/content
```

**响应：**
```json
{
  "items": [
    {
      "id": 1,
      "title": "刘看山的故事",
      "summary": "一只来自北极的狐狸...",
      "url": "https://example.com/story",
      "category": "story",
      "tags": "kanshan,fox",
      "weight": 5,
      "enabled": 1,
      "created_at": 1715000000000
    }
  ]
}
```

### `POST /content/pick` — 随机挑选内容（不推送）

```json
{"userId": "demo"}
```

**响应：**
```json
{
  "item": {
    "id": 1,
    "title": "刘看山的故事",
    "summary": "一只来自北极的狐狸...",
    "url": "https://example.com/story",
    "category": "story",
    "weight": 5
  }
}
```

### `POST /content/push` — 挑选并通过 SSE 推送

```json
{"userId": "demo"}
```

**响应：**
```json
{
  "item": {
    "id": 1,
    "title": "刘看山的故事",
    "summary": "一只来自北极的狐狸...",
    "url": "https://example.com/story",
    "category": "story",
    "weight": 5
  },
  "pushed": true
}
```

### `POST /content/click` — 点击回执

```json
{
  "userId": "demo",
  "contentId": 1
}
```

**响应：**
```json
{"ok": true}
```

### `GET /content/history?userId=demo&limit=20` — 推送历史

```bash
curl "http://localhost:8787/content/history?userId=demo&limit=20"
```

**响应：**
```json
{
  "items": [
    {
      "id": 1,
      "pushed_at": 1715000000000,
      "clicked_at": 1715000100000,
      "title": "刘看山的故事",
      "summary": "一只来自北极的狐狸...",
      "url": "https://example.com/story"
    }
  ]
}
```

#### 调用示例

```bash
# 随机挑选一条内容
curl -X POST http://localhost:8787/content/pick \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo"}'

# 挑选并通过 SSE 推送
curl -X POST http://localhost:8787/content/push \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo"}'

# 记录点击
curl -X POST http://localhost:8787/content/click \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","contentId":1}'
```

---

## 八、实时事件流（SSE）

### `GET /events?userId=demo` — SSE 订阅

使用 Server-Sent Events 协议，保持长连接接收实时推送。

```bash
curl -N "http://localhost:8787/events?userId=demo"
```

#### 事件类型

| 事件名 | 触发时机 | data 示例 |
|--------|----------|-----------|
| `hello` | 连接建立 | `{"userId":"demo","time":1715000000000}` |
| `reminder` | 定时提醒触发 | `{"kind":"drink_water","title":"喝水时间","message":"记得喝杯水哦～"}` |
| `pomodoro` | 番茄钟状态变更 | `{"id":1,"state":"work_start","task":"写代码"}` |
| `content_push` | 内容推送 | `{"id":1,"title":"刘看山的故事","summary":"...","url":"..."}` |

#### 心跳机制

每 25 秒发送一次 `: ping\n\n` 注释行保持连接。

#### 调用示例

```bash
# 监听事件流（终端保持打开）
curl -N "http://localhost:8787/events?userId=demo"

# 在另一个终端触发事件
curl -X POST http://localhost:8787/reminders/trigger \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo","kind":"drink_water"}'
```

---

## 九、管理端

所有管理端接口需要 `X-Admin-Token` 请求头（默认值在 `config.json` 中配置）。

### `POST /admin/reload-config` — 重载配置

```bash
curl -X POST http://localhost:8787/admin/reload-config \
  -H "X-Admin-Token: change-me-please"
```

**响应：**
```json
{
  "ok": true,
  "config": {
    "admin_token": "change-me-please",
    "rate_limit": {
      "chat": {"daily": 200},
      "skill": {"daily": 100}
    },
    "memory": {
      "shortTermTurns": 50,
      "summaryTriggerTurns": 50,
      "summaryKeepLatestTurns": 10
    }
  }
}
```

### `GET /admin/usage` — 查询用量

```bash
# 全部用量
curl "http://localhost:8787/admin/usage" -H "X-Admin-Token: change-me-please"

# 按用户查询
curl "http://localhost:8787/admin/usage?userId=demo" -H "X-Admin-Token: change-me-please"

# 按日期查询
curl "http://localhost:8787/admin/usage?day=2025-05-12" -H "X-Admin-Token: change-me-please"
```

**响应：**
```json
{
  "items": [
    {
      "user_id": "demo",
      "day": "2025-05-12",
      "kind": "chat",
      "count": 5
    }
  ]
}
```

### `GET /admin/online` — 在线用户

```bash
curl "http://localhost:8787/admin/online" -H "X-Admin-Token: change-me-please"
```

**响应：**
```json
{
  "users": ["demo", "test"]
}
```

### `POST /admin/contents` — 添加内容

```json
{
  "title": "刘看山的故事",
  "summary": "一只来自北极的狐狸的日常",
  "url": "https://example.com/story",
  "category": "story",
  "tags": "kanshan,fox",
  "weight": 5,
  "enabled": true
}
```

```bash
curl -X POST http://localhost:8787/admin/contents \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: change-me-please" \
  -d '{"title":"刘看山的故事","summary":"一只来自北极的狐狸","url":"https://example.com","category":"story","tags":"kanshan","weight":5,"enabled":true}'
```

**响应：**
```json
{"id": 1}
```

### `DELETE /admin/contents/{id}` — 删除内容

```bash
curl -X DELETE http://localhost:8787/admin/contents/1 \
  -H "X-Admin-Token: change-me-please"
```

**响应：**
```json
{"ok": true}
```

---

## 十、健康检查

### `GET /` — 根路径

```bash
curl http://localhost:8787/
```

**响应：**
```json
{
  "name": "kanshan-server",
  "version": "0.1.0",
  "endpoints": [
    "POST /chat",
    "GET  /skills",
    "POST /skills/invoke",
    "GET  /reminders?userId=",
    "POST /reminders",
    "PATCH /reminders/{id}",
    "DELETE /reminders/{id}",
    "POST /reminders/trigger",
    "POST /pomodoro/start",
    "POST /pomodoro/{id}/cancel",
    "GET  /pomodoro/active",
    "GET  /content",
    "POST /content/pick",
    "POST /content/push",
    "POST /content/click",
    "GET  /content/history",
    "GET  /events?userId=",
    "(admin) /admin/reload-config  /admin/usage  /admin/online  /admin/contents",
    "--- Claude Sidecar ---",
    "GET  /claude/health",
    "GET  /claude/tools",
    "POST /claude/reload-config",
    "POST /claude/sessions",
    "GET  /claude/sessions?userId=",
    "GET  /claude/sessions/{id}",
    "DELETE /claude/sessions/{id}",
    "POST /claude/sessions/{id}/abort",
    "POST /claude/chat"
  ]
}
```

### `GET /health` — 健康检查

```bash
curl http://localhost:8787/health
```

**响应：**
```json
{"ok": true}
```

---

## 附录

### A. 配置说明

配置文件位于 `kanshan/backend/config/config.json`：

```json
{
  "admin_token": "change-me-please",
  "rate_limit": {
    "chat": {"daily": 200},
    "skill": {"daily": 100}
  },
  "memory": {
    "shortTermTurns": 50,
    "summaryTriggerTurns": 50,
    "summaryKeepLatestTurns": 10
  }
}
```

环境变量位于 `kanshan/backend/.env`：

```env
LLM_BASE_URL=https://api.moonshot.cn/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=moonshot-v1-8k
```

### B. 数据库表结构

| 表名 | 说明 |
|------|------|
| `messages` | 对话消息记录 |
| `summaries` | 长期记忆摘要 |
| `usage_counters` | API 调用计数 |
| `reminders` | 用户自定义提醒 |
| `pomodoros` | 番茄钟记录 |
| `contents` | 内容库 |
| `push_history` | 推送历史 |

### C. 限流策略

- 每个用户每天独立计数
- `chat` 类型：默认 200 次/天
- `skill` 类型：默认 100 次/天
- 计数在每日 00:00 重置
- 可在 `config.json` 中按用户调整限额