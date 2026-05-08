# 刘看山陪伴 Bot 后端 RFC

本 RFC 描述支撑刘看山陪伴 Bot 的后端服务设计。它与 [`frontend-rfc.md`](./frontend-rfc.md) 配对，针对前端 RFC 的业务模块给出数据模型、接口契约和关键算法。

业务规则（数值衰减、状态机阈值、道具效果、任务奖励等）以 [`product-design.md`](./product-design.md) 为权威，本 RFC 不重复定义，只在涉及时引用。

## 1. 范围与非目标

### 1.1 本期目标（黑客松阶段）

- 单服务、单库跑通桌宠主循环：登录 → 状态查询 → 道具消耗 → 任务进度 → 浏览统计回写。
- 不引入 AI 模型、匹配引擎、推荐算法、内容召回等业务能力（这些是其他独立服务的职责）。

### 1.2 非目标

- 不做高可用 / 集群 / 主从 / 分库分表。
- 不做 GraphQL、protobuf、RPC，**先 REST**。
- 不做完整 OAuth2 接入，先签发 mock session。
- 不做计费 / 商店 / 充值。

## 2. 技术栈与目录约定

| 维度 | 选型 | 备注 |
| --- | --- | --- |
| 语言 | Go 1.22+ | 静态二进制，跨平台编译方便。 |
| HTTP 框架 | `chi` | 轻量、stdlib 风格、middleware 链路干净。 |
| 数据库 | SQLite 3 | 文件型，零运维，黑客松首选。 |
| SQLite 驱动 | `modernc.org/sqlite` | 纯 Go，免 CGO，跨平台编译无障碍。 |
| 查询层 | `database/sql` + 手写 SQL | 表稳定后再视情况引入 `sqlx` 或 `sqlc`。 |
| 迁移 | `db/migrations/*.sql` | 自写顺序执行 runner，零额外依赖。 |
| 配置 | `os.Getenv` + `.env.example` | 不引入 viper。 |
| 日志 | `log/slog` | Go 1.21+ 内建结构化日志。 |

工程位置：[`services/kanshan-server/`](../services/kanshan-server/)。目录分层硬约束：

| 层 | 职责 | 是否可见 SQL | 子目录 |
| --- | --- | --- | --- |
| `cmd/server` | 进程入口：flag/env/log + `daoimpl.Init(path)` + `portal.New(logger)` | 否 | `main.go` |
| `db` | SQL 迁移文件 + `embed.FS` 暴露 | — | `migrations/`、`embed.go` |
| `pkg/portal` | 对外接口：HTTP 路由 + handler，每个子包**自己装配** service | 否 | `server.go` / `auth` / `inventory` / `state` / `task` / `stats` / `errx` |
| `pkg/basic/dao` | 数据访问**接口**（model + DAO interface） | **不允许 import `database/sql`** | `dao.go` |
| `pkg/basic/dao/impl` | 数据访问**实现**：包级单例连接 + `Init/Close/NewXxxDao()` | **唯一允许 import `database/sql` 与驱动** | `conn.go` / `db.go` / `migrate.go` / 各 entity impl |
| `pkg/basic/util` | 通用工具集合，按子包拆分（`httpx` 信封、`session` token middleware…） | 否 | `httpx/` / `session/` |
| `pkg/core/service` | 业务保障 + 数据二次加工**接口**（含 `service.Error` 错误码） | 否 | `service.go` |
| `pkg/core/service/impl` | service 实现：每个 `NewXxxService()` **自己** 调 `daoimpl.NewXxxDao()` | 否 | `auth.go` / `inventory.go` / ... |
| `pkg/business/kanshan-bot` | 刘看山陪伴 Bot 产品线**特殊业务** / 算法（如 decay） | 否 | `state` |
| `pkg/port` | 针对外部公共库的二次封装（OAuth、LLM、可观测） | 否 | P0 占位 |

依赖方向：`cmd → portal → core/service`；`core/service/impl → core/service` + `basic/dao` + `business/kanshan-bot`；`core/service/impl → basic/dao/impl`（**仅** 通过 `NewXxxDao()` 工厂）；`basic/dao/impl → db`（仅为读 `embed.FS`）。`basic/*` 不允许反向依赖 `core/*` 或 `business/*`。

### 装配风格：服务定位（self-wiring），不在 `main` 串依赖链

每一层只依赖**下一层暴露的工厂**，自己 `New` 出依赖。`cmd/server/main.go` 只做 3 件事：

1. 读 flag / env / 配 logger。
2. 调 `daoimpl.Init(dbPath)` —— 一次性把 SQLite 文件打开 + 跑迁移，存到 dao/impl 包级变量。
3. 调 `portal.New(logger)` —— 拿到 `http.Handler`，启 server。

```text
main.go             → daoimpl.Init(path)  → portal.New(logger)
portal/server.go    → auth.New() / inventory.New() / state.New() / task.New() / stats.New()
portal/<biz>/h.go   → serviceimpl.NewXxxService()
serviceimpl/*.go    → daoimpl.NewXxxDao()
daoimpl/*.go        → 共享包级 *sql.DB（由 Init 装好）
```

main.go **不导入** `core/service` / `core/service/impl`，**不持有任何 service / dao 实例**。新增一个业务模块只需要：在 dao 加接口 + impl，在 core/service 加接口 + impl 工厂，在 portal 加子包 + 在 `portal/server.go` 挂一行 `r.Route(...)`，**main.go 不动**。

> **不可逾越的边界**：除 `pkg/basic/dao/impl/` 外，任何 Go 文件 `import "database/sql"` 或 SQLite 驱动均视为破坏分层；`*sql.DB` 类型不允许出现在 `pkg/basic/dao/impl/` 之外的任何函数签名 / 结构体字段中。CI 应在后续加入 grep 校验。

## 3. 认证

### 3.1 黑客松阶段（P0）

- 接口：`POST /api/auth/zhihu`
- 入参：`{ "code": "<oauth_code or mock>" }`
- 出参：`{ "user_id": "u_xxx", "session_token": "s_xxx", "expires_at": 1700000000 }`
- 实现：固定返回一个 mock 用户。如果传入的 `code` 之前没见过，自动 upsert 一条 `users` 记录。
- session 校验：通过 HTTP Header `X-Session-Token` 透传，由 `auth.middleware` 解析为 `user_id` 注入 context。

### 3.2 后续阶段（P1+）

- 接 OAuth2，向公司认证服务换取 access_token，再换取 user info。
- 引入 JWT 或带签名 session，避免内存表带来的重启失忆问题。

## 4. REST 接口

所有写接口（POST）都需要 `X-Session-Token`。所有 JSON 字段命名采用 `snake_case`。

### 4.1 健康检查

- `GET /healthz` → `{ "ok": true, "version": "..." }`

### 4.2 道具

- `GET /api/inventory`
  - 返回：`{ "items": [{ "item_id": "fish-jerky", "name": "小鱼干", "qty": 3, "rarity": "common", "cooldown_remaining_sec": 0, "expire_at": null }] }`
- `POST /api/inventory/use`
  - 入参：`{ "item_id": "fish-jerky" }`
  - 后端处理：检查持有数量、检查冷却、检查前置状态（如「感冒药仅在生病时可用」）→ 扣库存 → 写 `pet_state` 数值 → 写一条 `inventory_log` → 返回新的 `pet_state`。
  - 出参：`{ "ok": true, "new_state": { ... }, "action_hint": "happy-temporary" }`
  - `action_hint` 用于前端选择动画，对齐 [`frontend-rfc.md`](./frontend-rfc.md) §5.1 表格。

### 4.3 状态

- `GET /api/pet/state`
  - 返回：完整 pet_state（含 hunger、happiness、energy、health、growth、mood、lifecycle、last_tick_at）。
  - 调用时若 `last_tick_at` 距今 > 1 分钟，先跑一次离线回溯（见 §6），再返回最新值。
- `POST /api/pet/state/tick`
  - 入参：`{}`（可选 `{ "now": 1700000000 }`，用于测试注入时间）。
  - 强制触发一次离线回溯结算，主要用于客户端从后台切回前台时刷新。
  - 出参：同 `GET /api/pet/state`。

### 4.4 任务

- `GET /api/tasks?period=daily|weekly|story|challenge`
  - 返回：`{ "tasks": [{ "task_id": "browse-3-posts", "name": "浏览 3 篇帖子", "type": "daily", "target_count": 3, "done_count": 1, "rewards": [{ "kind": "item", "item_id": "fish-jerky", "qty": 1 }] }] }`
- `POST /api/tasks/progress`
  - 入参：`{ "task_id": "browse-3-posts", "delta": 1 }`
  - 后端：累加 `user_tasks.done_count`，到达 `target_count` 时入库奖励（写 `user_items` 或 `pet_state.growth`），并标记 `done_at`。
  - 出参：`{ "ok": true, "task": { ... }, "rewards_granted": [...] }`

### 4.5 统计

- `POST /api/stats/event`
  - 入参：`{ "type": "post_view" | "like" | "comment" | "reminder" | "long_stay", "payload": { ... }, "ts": 1700000000 }`
  - 后端：写 `daily_stats`（按 type 累加对应字段），需要时联动 `user_tasks.done_count`（例如 `post_view` 同步推进「浏览 3 篇帖子」任务）。
  - 出参：`{ "ok": true }`

## 5. 数据模型

所有表均加 `created_at`、`updated_at`（Unix 秒，整型）。索引仅列必要项。

```sql
-- users：用户主表
CREATE TABLE users (
  id              TEXT PRIMARY KEY,           -- u_<random>
  zhihu_user_id   TEXT UNIQUE,                -- 来自 OAuth2，黑客松阶段可空
  name            TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- items_catalog：道具元数据（可视为只读字典）
CREATE TABLE items_catalog (
  item_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  rarity          TEXT NOT NULL,              -- common / rare / precious
  cooldown_sec    INTEGER NOT NULL DEFAULT 0,
  effect_json     TEXT NOT NULL,              -- {"hunger":+25} 等
  precondition    TEXT,                       -- "sick" / "dead" / null
  action_hint     TEXT,                       -- 前端动画提示，对齐 frontend-rfc §5.1
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- user_items：用户道具持有
CREATE TABLE user_items (
  user_id            TEXT NOT NULL,
  item_id            TEXT NOT NULL,
  qty                INTEGER NOT NULL DEFAULT 0,
  last_obtained_at   INTEGER,
  expire_at          INTEGER,                 -- null 表示永久
  last_used_at       INTEGER,                 -- 用于冷却计算
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES items_catalog(item_id)
);

-- inventory_log：道具流水（用于审计与统计）
CREATE TABLE inventory_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  item_id          TEXT NOT NULL,
  delta            INTEGER NOT NULL,          -- 正：获得；负：消耗
  reason           TEXT NOT NULL,             -- "task_reward" / "use" / "daily_login"
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_inventory_log_user ON inventory_log(user_id, created_at);

-- pet_state：宠物长期状态
CREATE TABLE pet_state (
  user_id        TEXT PRIMARY KEY,
  hunger         INTEGER NOT NULL DEFAULT 100, -- 饱腹值
  happiness      INTEGER NOT NULL DEFAULT 100, -- 快乐度
  energy         INTEGER NOT NULL DEFAULT 100, -- 精力值
  health         INTEGER NOT NULL DEFAULT 100, -- 健康值
  growth         INTEGER NOT NULL DEFAULT 0,   -- 成长值
  mood           TEXT NOT NULL DEFAULT 'normal',
  lifecycle      TEXT NOT NULL DEFAULT 'normal', -- normal / hungry / sleepy / sick / dead / runaway
  last_tick_at   INTEGER NOT NULL,             -- 上次结算时间，离线回溯入口
  sick_started_at  INTEGER,                    -- 生病开始时间，用于 48h 阈值
  runaway_started_at INTEGER,                  -- 离家出走开始时间，用于召回
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- tasks_catalog：任务元数据
CREATE TABLE tasks_catalog (
  task_id         TEXT PRIMARY KEY,
  type            TEXT NOT NULL,             -- daily / weekly / story / challenge
  name            TEXT NOT NULL,
  target_count    INTEGER NOT NULL DEFAULT 1,
  reward_json     TEXT NOT NULL,             -- [{"kind":"item","item_id":"fish-jerky","qty":1}]
  trigger_event   TEXT,                      -- 关联的 stats event type，用于自动推进
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- user_tasks：任务进度
CREATE TABLE user_tasks (
  user_id        TEXT NOT NULL,
  task_id        TEXT NOT NULL,
  period_key     TEXT NOT NULL,             -- daily: '2026-05-08' / weekly: '2026-W19' / story+challenge: 'lifetime'
  done_count     INTEGER NOT NULL DEFAULT 0,
  done_at        INTEGER,                   -- 首次达成 target_count 的时间
  rewarded       INTEGER NOT NULL DEFAULT 0, -- 0/1
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id, period_key)
);

-- daily_stats：每日浏览统计
CREATE TABLE daily_stats (
  user_id              TEXT NOT NULL,
  date                 TEXT NOT NULL,        -- YYYY-MM-DD
  posts_viewed         INTEGER NOT NULL DEFAULT 0,
  likes_received       INTEGER NOT NULL DEFAULT 0,
  comments_published   INTEGER NOT NULL DEFAULT 0,
  longest_post_id      TEXT,
  longest_dwell_sec    INTEGER NOT NULL DEFAULT 0,
  updated_at           INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);
```

## 6. 离线回溯算法

`pet_state.last_tick_at` 是离线回溯的关键。每次 `GET /api/pet/state` 或 `POST /api/pet/state/tick` 命中时执行：

1. 计算 `delta_hours = floor((now - last_tick_at) / 3600)`。
2. 若 `delta_hours <= 0`，跳过。
3. 按 [`product-design.md`](./product-design.md) 1.2 节的衰减规则批量结算：
   - `health -= 5 * delta_hours`（生病期间 `health -= 10 * delta_hours`，需要参考 `lifecycle == 'sick'`）。
   - `happiness -= rand(1..3) * delta_hours`（被忽视超过 24h 后改为 5）。这里黑客松阶段简化为均值 2，不引入随机。
   - `hunger -= rand(1..3) * delta_hours`（同上简化为 2）。
   - `energy -= rand(1..3) * delta_hours`（同上简化为 2）。
4. 边界事件触发：
   - `hunger <= 0` → `lifecycle = 'hungry'`，并以 `health -= 10 * delta_hours` 为后续步长。
   - `health <= 0` 且 `lifecycle != 'sick'` → 设 `lifecycle = 'sick'`，写 `sick_started_at = now`。
   - `lifecycle == 'sick'` 且 `now - sick_started_at >= 48*3600` → `lifecycle = 'dead'`。
   - 连续无互动 `now - max(updated_at, last_login_at) >= 72*3600` → 概率检查（黑客松简化为直接进入），`lifecycle = 'runaway'`，写 `runaway_started_at`。
5. 所有数值 clamp 到 `[0, 100]`，`growth` 不衰减只增长。
6. `last_tick_at = now`，写回。

实现时把单步衰减抽到 `internal/state/decay.go`，方便单测。

## 7. 任务推进路径

任务推进有两类入口：

- **显式上报**：前端调 `POST /api/tasks/progress { task_id, delta }`，后端按 `task_id` 找 `tasks_catalog`，累加 `user_tasks.done_count`，到 `target_count` 时入库奖励。
- **隐式推进**：前端调 `POST /api/stats/event { type: "post_view" }`。后端在 `stats.handler` 内部查 `tasks_catalog` 中所有 `trigger_event = "post_view"` 的任务，对当前用户推进 `done_count += 1`（按各任务自身 `target_count` 收敛）。

period_key 算法：

| 任务类型 | period_key |
| --- | --- |
| daily | `YYYY-MM-DD`（用户本地时区，黑客松统一 UTC+8） |
| weekly | `YYYY-Www`（ISO 周） |
| story | `lifetime` |
| challenge | `lifetime` |

每天 0 点不跑批，靠首次访问触发的 `period_key` 切换实现「重置」。

## 8. 错误约定

所有非 200 响应统一格式：

```json
{
  "error": {
    "code": "INVENTORY_INSUFFICIENT",
    "message": "道具数量不足",
    "details": { "item_id": "fish-jerky", "qty": 0 }
  }
}
```

P0 错误码白名单：

- `UNAUTHORIZED`：缺少 / 无效 session。
- `BAD_REQUEST`：参数错误。
- `INVENTORY_INSUFFICIENT`：道具数量不足。
- `INVENTORY_PRECONDITION_FAILED`：当前状态不允许使用该道具。
- `INVENTORY_COOLDOWN`：冷却中。
- `TASK_NOT_FOUND`：任务不存在。
- `INTERNAL`：兜底。

## 9. 落地分阶段

| 阶段 | 范围 | 验收 |
| --- | --- | --- |
| **P0** | auth + state + inventory + 0001_init.sql + 离线回溯 | 桌宠主循环跑通：登录→看到 state→喂小鱼干→state 变化。 |
| **P1** | tasks + stats + tasks_catalog 数据 + 隐式推进 | 浏览事件能驱动任务进度；任务完成自动发奖。 |
| **P2** | WebSocket 推送 | 前端去掉 state 轮询，由后端推送状态变化。 |
| **P3** | 真实 OAuth2 + 多设备 session | 接公司 OAuth2，多端登录。 |

## 10. 与前端 RFC 的对应

| 后端章节 | 前端章节 |
| --- | --- |
| §3 认证 | [`frontend-rfc.md`](./frontend-rfc.md) §4.2 登录体系 |
| §4.2 道具接口 | [`frontend-rfc.md`](./frontend-rfc.md) §5.1 道具系统 |
| §4.3 状态接口 + §6 离线回溯 | [`frontend-rfc.md`](./frontend-rfc.md) §5.2 状态系统 |
| §4.4 任务接口 + §7 任务推进 | [`frontend-rfc.md`](./frontend-rfc.md) §5.3 任务系统 |
| §4.5 统计接口 | [`frontend-rfc.md`](./frontend-rfc.md) §5.5 浏览统计 |
