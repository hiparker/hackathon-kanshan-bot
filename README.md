# 刘看山陪伴 Bot 黑客松全栈仓库

知乎刘看山陪伴 Bot 的全栈代码仓库。它包含桌面端 / 浏览器插件双载体的客户端、Three.js 3D 北极狐角色运行时、React UI 与运行时之间的桥接协议，以及 Go + SQLite 后端服务（登录、道具、状态、任务、统计）。

仓库目标是用最小成本支撑黑客松 demo 的可演示闭环：用户登录 → 看到看山的状态 → 用道具影响数值 → 触发任务进度 → 浏览统计回写。

## 技术栈

| 层 | 技术 | 工程位置 |
| --- | --- | --- |
| 桌面端壳 | Rust + Tauri | [`apps/desktop-tauri`](./apps/desktop-tauri) |
| 浏览器插件壳 | WebExtension + Vite | `apps/extension/`（占位，未启动） |
| Web 承载示例 | React + Vite | [`apps/react-host`](./apps/react-host) |
| 角色运行时 | Three.js + 程序化低模 + toon 材质 | [`packages/kanshan-three-runtime`](./packages/kanshan-three-runtime) |
| 桥接协议 | TypeScript 命令 / 事件 | [`packages/kanshan-bridge`](./packages/kanshan-bridge) |
| 后端服务 | Go 1.22+ + chi + modernc.org/sqlite | [`services/kanshan-server`](./services/kanshan-server) |

技术选型理由、协议分阶段策略、客户端载体对比详见 [`planning/frontend-rfc.md`](./planning/frontend-rfc.md) 和 [`planning/backend-rfc.md`](./planning/backend-rfc.md)。

## 快速开始

前端工作区使用 `pnpm` 管理 TypeScript monorepo，包含 `apps/*` 与 `packages/*`。

```bash
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @kanshan/react-host dev
```

如本机 npm 镜像证书异常，可以显式使用官方 registry。`pnpm install` 完成后会通过 `postinstall` 自动从 CDN 拉取 `assets/model/manifest.json` 中列出的 GLB 模型；如需手动重跑：

```bash
pnpm assets:fetch          # 已存在则跳过
pnpm assets:fetch -- --force  # 强制重新下载
```

后端使用 Go + SQLite 单进程：

```bash
cd services/kanshan-server
cp .env.example .env
go mod tidy
make run             # 自动跑迁移并启动 HTTP 服务（默认 :8787）
curl http://localhost:8787/healthz
```

更多后端命令（`make build` / `make test` / `make migrate`）见 [`services/kanshan-server/README.md`](./services/kanshan-server/README.md)。

## 目录导航

| 路径 | 用途 |
| --- | --- |
| [`apps/react-host`](./apps/react-host) | React 承载示例，跑通 React UI ↔ Three.js 运行时桥接。 |
| `apps/desktop-tauri/` | Tauri 桌面端壳（占位，待 RFC 立项后启动）。 |
| `apps/extension/` | WebExtension 浏览器插件壳（占位，待 RFC 立项后启动）。 |
| [`packages/kanshan-three-runtime`](./packages/kanshan-three-runtime) | Three.js 角色运行时、程序化低模、动作状态、挂点、道具和特效。 |
| [`packages/kanshan-bridge`](./packages/kanshan-bridge) | React UI 与 Three.js 运行时的命令和事件协议。 |
| [`services/kanshan-server`](./services/kanshan-server) | Go + SQLite 后端服务（auth / inventory / state / task / stats）。 |
| [`planning/frontend-rfc.md`](./planning/frontend-rfc.md) | 前端 RFC：客户端载体、渲染选型、协议、业务模块。 |
| [`planning/backend-rfc.md`](./planning/backend-rfc.md) | 后端 RFC：技术栈、数据模型、REST 接口、离线回溯算法。 |
| [`planning/product-design.md`](./planning/product-design.md) | 产品方案、核心模块、功能设计与数值规则（业务权威）。 |
| [`planning/game-runtime-plan.md`](./planning/game-runtime-plan.md) | Three.js 游戏化运行时阶段路线。 |
| [`assets/README.md`](./assets/README.md) | 素材目录与资产生产入口。 |
| [`source-image/`](./source-image) | 原始参考图，仅用于人工风格对比，不进入运行时打包。 |

## 开发命令

| 命令 | 范围 | 说明 |
| --- | --- | --- |
| `pnpm typecheck` | 前端 | 检查所有工作区 TypeScript 类型。 |
| `pnpm test` | 前端 | 运行 bridge 和运行时清单测试。 |
| `pnpm build` | 前端 | 构建 bridge、React 示例和 Three.js runtime。 |
| `pnpm --filter @kanshan/react-host dev` | 前端 | 启动 React 示例应用。 |
| `pnpm --filter @kanshan/desktop-tauri dev` | 桌面端 | 启动透明桌宠窗口和系统托盘。 |
| `pnpm --filter @kanshan/desktop-tauri build` | 桌面端 | 打包 macOS / Windows 桌面应用。 |
| `pnpm release desktop -- --bump patch --push` | 发布 | 升级桌面包版本、提交、打 tag 并触发 GitHub Release 打包。 |
| `cd services/kanshan-server && make run` | 后端 | 跑迁移并启动 HTTP 服务。 |
| `cd services/kanshan-server && make migrate` | 后端 | 仅跑迁移后退出。 |
| `cd services/kanshan-server && make test` | 后端 | 运行 Go 单元测试（含状态衰减算法）。 |

## 发布流程

统一使用 [`scripts/release.mjs`](./scripts/release.mjs) 管理客户端发布，避免手动改版本、提交和打 tag。

```bash
pnpm release desktop -- --dry-run              # 预览下一次 patch 版本
pnpm release desktop -- --bump patch --push    # 例如 1.0.2 -> 1.0.3，并推 tag 触发 CI
pnpm release desktop -- --version 1.1.0 --push # 指定版本发布
```

当前桌面端只把 `apps/desktop-tauri/src-tauri/tauri.conf.json` 作为打包版本源；根目录和工作区 `package.json` 不随桌面包版本变化。后续新增浏览器插件时，在 `scripts/release.mjs` 的 `targets` 中加入插件的 manifest/package 版本文件即可复用同一条发布命令。

## 当前阶段

| 模块 | 当前状态 |
| --- | --- |
| `apps/react-host` | 已有 mock bridge 示例，用于验证 UI 到运行时的数据流。 |
| `apps/desktop-tauri` | 已有 P0 Tauri 壳：透明无标题栏窗口、托盘显示隐藏、托盘退出。 |
| `apps/extension` | 占位。待 frontend-rfc 立项后启动。 |
| `packages/kanshan-three-runtime` | 已有浏览器内 Three.js 低模角色、toon 材质、动作状态、挂点、道具和特效。 |
| `packages/kanshan-bridge` | 已有命令类型、事件类型、命令校验、内存 bridge 和 `postMessage` bridge。 |
| `services/kanshan-server` | P0 骨架已就绪：auth / inventory / state / task / stats 五个模块占位接口可联调；离线回溯算法 + 单测已通过。后续按 backend-rfc.md §9 推进。 |
| 资产规范 | 已有北极狐形体、三视图、建模、材质、骨骼和 Three.js 接入规范。 |

## 边界说明

- **Tauri 桌面端 / 浏览器插件 / React Host** 是承载壳，三端共享 TypeScript + React + Three.js 内核，差异只在外层壳与权限模型。
- **Three.js 运行时** 负责角色渲染、动作状态机、方向旋转、道具挂点和特效。React 通过 [`@kanshan/bridge`](./packages/kanshan-bridge) 发送高层命令，不直接操作 Three.js scene、几何体、材质或动画帧。
- **Go 后端** 负责持久化和业务逻辑（用户、道具、状态、任务、统计）。前端任何写操作都通过 REST 接口与后端协作，不在前端单独维护游戏存档。
- `source-image` 中的图片只作为风格参考，不进入运行时打包。正式角色本体应通过 `assets/concept`、`assets/model` 和 `packages/kanshan-three-runtime` 中定义的流程制作。
