# 刘看山陪伴 Bot 文档入口

本目录存放产品方案、前后端 RFC、运行时路线和后续任务规划。工程入口在根目录 `README.md`，资产规范入口在 `assets/README.md`。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| `product-design.md` | 说明参赛作品、核心模块、功能设计、组件建议和事件建议（业务规则权威）。 |
| `frontend-rfc.md` | 客户端载体（Tauri / WebExtension / Web Host）、Three.js 渲染选型、前后端协议、业务模块在前端侧的设计。 |
| `backend-rfc.md` | Go + SQLite 后端服务的技术栈、数据模型、REST 接口、离线回溯算法和落地阶段。 |
| `game-runtime-plan.md` | 说明 Three.js 游戏化运行时的技术分层、边界、资产流程和阶段路线。 |
| `stage-two-three-runtime.md` | 记录第二阶段美术返工与 GLB 接入路径。 |
| `kanshan-art-direction.md` | 按全部 source-image 样图拆解刘看山美术结构。 |

## 阅读顺序

1. 先读根目录 `README.md`，理解工程状态、命令和目录。
2. 再读 `product-design.md`，理解产品目标、功能范围与数值规则。
3. 再读 `frontend-rfc.md` 和 `backend-rfc.md`，理解前后端如何接口联调。
4. 再读 `game-runtime-plan.md`，理解 Three.js 与 React 的分工。
5. 最后读 `assets/README.md`，进入三视图、建模、Three.js 和运行时清单规范。

## 维护规则

- 产品目标、用户价值和业务功能放在 `planning/product-design.md`。
- 前端选型与协议放在 `planning/frontend-rfc.md`，后端选型与接口放在 `planning/backend-rfc.md`，两者交叉点用章节链接互相引用。
- 客户端运行时路线和阶段拆分放在 `planning/game-runtime-plan.md`。
- 工程运行命令、目录说明和当前状态放在根目录 `README.md`。
- 资产生产规范放在 `assets` 目录。
