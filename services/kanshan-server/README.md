# kanshan-server

刘看山陪伴 Bot 后端服务。技术栈与接口定义见 [`planning/backend-rfc.md`](../../planning/backend-rfc.md)。

## 跑起来

```bash
cd services/kanshan-server
cp .env.example .env.local
go mod tidy
make run
```

启动时会自动按 `db/migrations/*.sql` 顺序执行迁移，并在 `DB_PATH`（默认 `./kanshan.db`）创建库文件。迁移会种子化 `items_catalog` 与 `tasks_catalog`。

健康检查：

```bash
curl http://localhost:8787/healthz
```

WebSocket 行情流：

```bash
wscat -c ws://localhost:8787/ws/market
```

连接建立后会先收到一帧快照，之后按固定间隔持续推送天气、黄金价格、BTC、ETH、上证指数、深证成指、NASDAQ Composite、HANG SENG INDEX，以及腾讯新闻 / 东方财富快讯。

## 目录约定

```
services/kanshan-server/
├── cmd/server/main.go            进程入口：flag/env/log + daoimpl.Init + portal.New
├── db/                           SQL 资源（与 cmd 平级）
│   ├── embed.go                  暴露 embed.FS
│   └── migrations/               *.sql
└── pkg/
    ├── portal/                   对外接口：HTTP 路由 + 各模块 handler（自装配 service）
    │   ├── server.go             chi.Router + middleware；按业务挂 r.Route(...)
    │   ├── health.go
    │   ├── auth/handler.go       POST /api/auth/zhihu
    │   ├── inventory/handler.go  GET/POST /api/inventory*
    │   ├── state/handler.go      GET/POST /api/pet/state*
    │   ├── task/handler.go       GET/POST /api/tasks*
    │   ├── stats/handler.go      POST /api/stats/event
    │   └── errx/                 service.Error → HTTP 错误信封映射
    ├── basic/                    基础组件
    │   ├── util/                 通用工具集合
    │   │   ├── httpx/            JSON / 错误信封
    │   │   └── session/          X-Session-Token middleware + 编解码
    │   └── dao/                  数据访问接口（不 import database/sql）
    │       ├── dao.go            UserDao / ItemDao / PetStateDao / TaskDao / StatsDao
    │       └── impl/             【唯一允许 import database/sql 的目录】
    │           ├── conn.go       Init(path) / Close / NewXxxDao()  ← 包级单例
    │           ├── db.go         open（含 modernc.org/sqlite 驱动）
    │           ├── migrate.go    扫 db.Migrations 顺序执行
    │           ├── user.go       userDao（小写）
    │           ├── item.go       itemDao（catalog ⨝ user_items）
    │           ├── petstate.go
    │           ├── task.go       taskDao（catalog ⨝ user_tasks）
    │           └── stats.go
    ├── core/                     核心层
    │   └── service/              业务保障 + 数据二次加工
    │       ├── service.go        AuthService / InventoryService / PetStateService / TaskService / StatsService + service.Error
    │       └── impl/             实现层；NewXxxService() 自调 daoimpl.NewXxxDao()
    │           ├── auth.go
    │           ├── inventory.go  Use 时校验 qty / precondition / 调 PetState
    │           ├── petstate.go   首次访问自动建档；Tick 调 business decay 后 Save
    │           ├── task.go       period_key 推导 / reward 解码 / 一次发奖
    │           └── stats.go      事件类型白名单 + 序列化 payload
    ├── business/
    │   └── kanshan-bot/          产品线特殊业务
    │       └── state/            decay 算法 + 默认初值（与 product-design.md 1.2 节绑定）
    └── port/                     公共库二次封装（占位）
```

### 装配风格：服务定位（self-wiring）

每一层只调下一层的工厂：

```text
main.go             → daoimpl.Init(path)  → portal.New(logger)
portal/server.go    → auth.New() / inventory.New() / state.New() / task.New() / stats.New()
portal/<biz>/h.go   → serviceimpl.NewXxxService()
serviceimpl/*.go    → daoimpl.NewXxxDao()
daoimpl/*.go        → 共享包级 *sql.DB（由 Init 装好）
```

`main.go` 不导入 `core/service` / `core/service/impl`，不持有任何 service / dao 实例。新增业务模块只需要：在 `dao` 加接口 + `impl`，在 `core/service` 加接口 + `impl` 工厂，在 `portal` 加子包 + 在 `portal/server.go` 挂一行 `r.Route(...)`。

### 不可逾越的边界

- **`database/sql`、SQLite 驱动等 SQL 操作只允许出现在 `pkg/basic/dao/impl/`**。其他任何目录里写 `import "database/sql"` 都视为破坏分层。
- **`*sql.DB` 不允许出现在 `pkg/basic/dao/impl/` 之外的任何函数签名 / 结构体字段中**。dao 实例通过 `daoimpl.NewXxxDao()` 工厂返回 `dao.XxxDao` 接口，连接对象由 dao/impl 包级 singleton 持有。
- **`pkg/basic/dao/dao.go` 是契约层**，不允许 import 任何驱动 / `database/sql`。
- **`pkg/basic/*` 不允许反向 import `pkg/core/*` 或 `pkg/business/*`**：basic 是底，core / business 在上。
- **`pkg/portal/` 只调 service 接口 + serviceimpl 工厂**，不知道 dao 的存在，也不知道 SQLite 的存在。

依赖方向：

```
cmd → portal → core/service
              ↘ basic/util/{httpx,session}
core/service/impl → basic/dao + business/kanshan-bot
                  ↘ basic/dao/impl（仅为调 NewXxxDao 工厂）
basic/dao/impl    → db（仅为读 embed.FS）
```

## 与 RFC 的对应

| HTTP 接口 | portal | service | dao | RFC 章节 |
| --- | --- | --- | --- | --- |
| `POST /api/auth/zhihu` | `portal/auth` | `AuthService` | `UserDao` | §3 / §4.1 |
| `GET  /api/inventory` | `portal/inventory` | `InventoryService.List` | `ItemDao.ListForUser` | §4.2 |
| `POST /api/inventory/use` | `portal/inventory` | `InventoryService.Use` | `ItemDao.GetForUser` + `AdjustQty` | §4.2 |
| `GET  /api/pet/state` | `portal/state` | `PetStateService.Get` | `PetStateDao.Get/Save` | §4.3 |
| `POST /api/pet/state/tick` | `portal/state` | `PetStateService.Tick` | `PetStateDao.Get/Save` + `business/.../state.Apply` | §4.3 + §6 |
| `GET  /api/tasks` | `portal/task` | `TaskService.List` | `TaskDao.ListForUser` | §4.4 |
| `POST /api/tasks/progress` | `portal/task` | `TaskService.Progress` | `TaskDao.GetForUser` + `UpsertProgress` | §4.4 + §7 |
| `POST /api/stats/event` | `portal/stats` | `StatsService.Event` | `StatsDao.Append` | §4.5 |
| `GET /ws/market` | `portal/ws` | `MarketService.Snapshot` | - | P0 websocket 行情推送 |

## 配置

通过环境变量加载，见 [`.env.example`](./.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 监听端口 |
| `DB_PATH` | `./kanshan.db` | SQLite 文件路径 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `KANSHAN_DEBUG_MODE` | `false` | 是否开启直写数据库的调试接口。开启后允许 `POST /api/pet/debug/state` 和 `POST /api/inventory/restock` |
| `ZHIHU_OAUTH_CLIENT_ID` |  | 知乎 OpenAPI `app_id` |
| `ZHIHU_OAUTH_CLIENT_SECRET` |  | 知乎 OpenAPI `app_key` |
| `MARKET_WS_PUSH_INTERVAL_SEC` | `60` | websocket 行情推送间隔（秒，最小 5） |
| `MARKET_WEATHER_CITY` | `Beijing` | 天气查询城市 |
| `MARKET_WEATHER_BASE_URL` | `https://wttr.in` | 可选覆盖天气公开源 |
| `MARKET_CRYPTO_URL` | `Binance 24hr ticker URL` | 可选覆盖 BTC/ETH 公开源 |
| `MARKET_GOLD_URL` | `https://api.gold-api.com/price/XAU` | 可选覆盖黄金公开源 |
| `MARKET_INDEX_URL` | `新浪指数行情 URL` | 可选覆盖上证/深证/NASDAQ/恒生公开源 |
| `MARKET_DAILY_NEWS_URL` | `https://orz.ai/api/v1/dailynews/?platform=tenxunwang` | 可选覆盖腾讯新闻源 |
| `MARKET_HOT_NEWS_URL` | `https://api.tcslw.cn/api/hotlist/eastmoney?type=102` | 可选覆盖东方财富快讯源 |
| `MARKET_ZHIHU_HOT_URL` | `https://openapi.zhihu.com/openapi/billboard/list` | 知乎社区真实讨论热榜接口完整 URL |
| `MARKET_ZHIHU_HOT_APP_KEY` |  | 知乎热榜接口 `X-App-Key`，填用户 token，勿提交真实值 |
| `MARKET_ZHIHU_HOT_APP_SECRET` |  | 知乎热榜接口签名密钥，勿提交真实值 |
| `MARKET_ZHIHU_HOT_EXTRA_INFO` |  | 可选：知乎热榜接口 `X-Extra-Info` |
| `MARKET_ZHIHU_HOT_TOP_CNT` | `50` | 知乎热榜拉取数量 |
| `MARKET_ZHIHU_HOT_PUBLISH_IN_HOURS` | `48` | 知乎热榜发布时间范围（小时） |
| `ZHIHU_OAUTH_*` |  | P0 不使用，P3 接入 OAuth2 时填 |
| `ZHIHU_CHAT_COMPLETIONS_URL` | `https://developer.zhihu.com/v1/chat/completions` | 知乎模型服务 Chat Completions 接口，可替换为其他兼容接口 |
| `ZHIHU_CHAT_MODEL` | `zhida-fast-1p5` | 后端代理调用的底层模型名 |
| `ZHIHU_CHAT_TIMEOUT_SEC` | `45` | 后端代理等待模型服务响应的超时时间，单位秒 |
| `ZHIHU_CHAT_MERGE_SYSTEM_TO_USER` | `true` | 是否把 `system` 消息合并进第一条 `user` 消息；用于兼容不稳定支持 `system` 的模型 |
| `ZHIHU_CHAT_HISTORY_LIMIT` | `10` | 每个用户保留的最近多轮对话轮数，每轮包含 query 和 answer |
| `ZHIHU_CHAT_ACCESS_SECRET` |  | 知乎模型服务 Access Secret，勿提交真实值 |

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `make run` | 跑迁移并启动 HTTP 服务（默认 `:8787`） |
| `make migrate` | 仅跑迁移后退出（`go run ./cmd/server -migrate-only`） |
| `make build` | 编译到 `bin/kanshan-server` |
| `make test` | 运行 Go 单元测试 |
| `make fmt` / `make vet` | 格式化 / 静态检查 |
| `make clean` | 清理 `bin/` 与本地 `*.db` |
