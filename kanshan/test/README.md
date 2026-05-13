# API 测试脚本

这个目录包含了用于测试 kanshan 后端 API 的 shell 脚本。

## 测试脚本列表

| 脚本名称 | 测试 API | 功能描述 |
|---------|---------|---------|
| `01_claude_health.sh` | `GET /claude/health` | 测试健康检查 API |
| `02_claude_sessions_list.sh` | `GET /claude/sessions` | 测试获取会话列表 API |
| `03_claude_sessions_create.sh` | `POST /claude/sessions` | 测试创建会话 API |
| `04_claude_sessions_messages.sh` | `GET /claude/sessions/{sessionId}/messages` | 测试获取干净消息 API |
| `05_claude_sessions_history.sh` | `GET /claude/sessions/{sessionId}/history` | 测试获取完整历史 API |

## 使用方法

### 运行单个测试

```bash
cd test
./01_claude_health.sh
```

### 运行所有测试

```bash
cd test
./run_all.sh
```

### 给脚本添加执行权限（如果需要）

```bash
cd test
chmod +x *.sh
```

## 前提条件

1. 后端服务必须运行在 `http://localhost:8000`（或根据脚本中的实际配置调整）
2. 需要有一个有效的用户 ID（默认为 `demo`）
3. 需要安装 `curl` 和 `python3`（用于 JSON 格式化）

## 注意事项

- 测试脚本会创建临时会话用于测试
- 所有测试都包含详细的输出说明
- 脚本会返回 0 表示通过，非 0 表示失败

## 测试输出示例

```
============================================
测试 API: GET /claude/health
============================================
响应内容：
{"ok":true,"runtime":"sdk",...}

✅ 测试通过！后端服务运行正常
```

