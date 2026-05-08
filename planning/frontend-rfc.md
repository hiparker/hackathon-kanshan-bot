# 刘看山陪伴 Bot 前端 RFC

本 RFC 描述刘看山陪伴 Bot 的客户端载体、角色渲染技术选型、前后端交互协议以及业务模块在前端侧的设计。它与 [`backend-rfc.md`](./backend-rfc.md) 配对，二者描述同一套业务在前后端两侧的具体落地。

产品目标和功能定义沿用 [`product-design.md`](./product-design.md)。Three.js 运行时分层沿用 [`game-runtime-plan.md`](./game-runtime-plan.md)。本文档不重复这两份文档的内容，只在涉及时引用。

## 1. 背景与目标

刘看山陪伴 Bot 是基于大模型的智能体，主场景是一只 3D 北极狐桌面宠物，需要在以下两类客户端载体上呈现：

- 桌面端：常驻屏幕的桌宠形态。
- 浏览器插件：跟随用户在知乎站内浏览行为做陪伴和提醒。

两端共享同一套核心：TypeScript + React + Three.js。差异只在外层壳与权限模型。

本 RFC 的目标：

- 锁定客户端载体方案。
- 锁定角色渲染技术栈。
- 锁定前后端交互协议与登录体系。
- 给出前端侧的道具、状态、任务、定时和统计模块设计，并和后端 RFC 接口口径对齐。

## 2. 技术栈与客户端载体

底层都是 **TypeScript + React + Three.js**。理论上可以做到跨平台，外部封装的壳不一样。

### 2.1 客户端（桌面端）

- 选型：**Rust + Tauri**，内部承载 TypeScript / React / Three.js。
- 选择理由：
  - 体积比 Electron 小一个量级。
  - Rust 侧可以直接调系统 API（窗口贴边、托盘、定时唤起、本地存储路径）。
  - 与 `services/kanshan-server` 的 Go 后端可以走本地 HTTP 或远端 HTTP，路径一致。
- 工程位置占位：`apps/desktop-tauri/`（本 RFC 阶段未启动，仅在 README 留占位）。

### 2.2 浏览器插件

- 选型：**WebExtension + Vite**，内部承载 TypeScript / React / Three.js。
- 选择理由：
  - WebExtension 是 Chrome / Edge / Firefox 通用规范，覆盖范围最大。
  - Vite 直接复用现有 monorepo 工具链（与 `apps/react-host` 一致），节省构建链路成本。
  - 插件可以拿到知乎站内的浏览/点赞/评论事件，是「浏览统计」与「任务」的天然事件源。
- 工程位置占位：`apps/extension/`（本 RFC 阶段未启动，仅在 README 留占位）。

### 2.3 Web 承载示例（已存在）

- 工程位置：[`apps/react-host`](../apps/react-host)。
- 用途：在浏览器里跑通 React UI ↔ Three.js 运行时桥接，作为黑客松 demo 的可演示载体，以及 Tauri / 插件接入前的开发参考。

## 3. 角色渲染技术调研

陪伴 Bot 主场景类似于 2D / 3D 游戏动画。可用技术栈如下：

| 方案 | 评价 | 结论 |
| --- | --- | --- |
| Cocos 骨骼动画 | Cocos 只授权游戏免费，其他非游戏商业场景需要购买授权。Cocos Creator 还需要额外学习成本。 | 不选。 |
| Unity 3D | 黑客松目标是快速开发，且 demo 主要是页面展示。C# 链路较重，与 Web 嵌入耦合成本高。 | 不选。 |
| WebGL（原生 GL） | 理论上可以直接读绑定骨骼动画的 GLB 文件，但浏览器对网络下载和渲染压力较大。原生 GL 开发周期长。 | 不选。 |
| **Three.js** | 近 10 年迭代，技术体系和渲染优化成熟。社区生态完整，GLB / 骨骼动画 / toon 材质 / 后期均可覆盖。 | **选用。** |

正式角色方案：**Three.js + 3D toon 北极狐**。运行时分层与挂点协议详见 [`game-runtime-plan.md`](./game-runtime-plan.md) 与 [`packages/kanshan-three-runtime`](../packages/kanshan-three-runtime)。

## 4. 前后端交互

### 4.1 协议选型

候选协议：RESTful、protobuf（WebSocket）、GraphQL。本项目按阶段切分：

- **P0：REST**。先以 REST 跑通登录、状态、道具、任务、统计五条主链路。前端通过轮询补足实时性。
- **P1：WebSocket**。当状态推送的实时性要求变明显（例如长期状态变化、定时任务唤起）时再补 WebSocket，承载服务端主动事件。
- **P2：protobuf / GraphQL**。本阶段不引入。GraphQL 收益主要在跨团队的前端聚合查询，本项目单端业务模型不需要；protobuf 在协议稳定后再考虑。

具体接口定义见 [`backend-rfc.md`](./backend-rfc.md) 第 4 节。

### 4.2 登录体系

- 默认进入只展示看山的基础交互动画。任何写操作都要求先登录。
- 登录方式：尝试接入公司 OAuth2，仅获取**用户唯一标识**和**对应的刘看山记录键**。
- 协议分支：
  - 如果使用 WebSocket 交互，channel 上绑定 user id，需要考虑断线重连。
  - 如果使用 REST / GraphQL 交互，需要做轮询状态机检查当前基础状态。
- 前端实现要求：
  - 登录态写入内存 + 持久化（Tauri 用本地存储路径，插件用 `chrome.storage.local`，Web Host 用 `localStorage`）。
  - 未登录态下，所有写接口禁用，UI 入口给出登录提示。

## 5. 业务模块（前端视角）

业务模型与数值规则统一以 [`product-design.md`](./product-design.md) 为权威。本节只描述前端需要触发的交互、需要调用的接口和需要覆盖的状态。

### 5.1 道具系统

- 后端服务需要根据道具规范完成当前用户道具列表入库（参考 [道具表 KDocs](https://www.kdocs.cn/l/cuMqEOQUbFl0?linkname=D9FdQC7bJY)）。
- 前端在鼠标悬停后加载当前用户的可用道具列表（`GET /api/inventory`），点击道具触发 `POST /api/inventory/use`。前端做对应 action，后端扣库存并增加对应状态值（饱腹值、快乐值、精神值）。
- 不同道具触发不同 action：

| 道具 | 前置状态 | 前端 action |
| --- | --- | --- |
| 小鱼干、营养罐头 | 看山饥饿且非满状态 | 使用完后随机表现一种**临时高兴状态**（跳舞、室内奔跑等）。 |
| 毛线球 | 任意（当作可消耗道具） | 同食物，触发**临时高兴状态**。 |
| 指挥猫棒 | 任意 | 当作道具消耗，触发**临时高兴状态**（注意：当前 manifest 未覆盖该 action，需要在 [`assets/runtime/pet-manifest.json`](../assets/runtime/pet-manifest.json) 补全）。 |
| 感冒药 | 仅在生病状态下可用 | 使用后恢复状态为普通（行走、打坐等）。 |
| 复活羽毛 | 仅在死亡状态下可用 | 使用后从死亡 → 普通（行走、打坐等）。 |
| 寻山启事 | 仅在离家出走状态下可用 | 当前可能不太好做，需要考虑展示框隐藏唤起和其他状态冲突等问题。**P1 暂不实现，留协议位**。 |
| 能量饮料 | 任意 | 使用后随机表现一种**临时运动状态**（俯卧撑、仰卧起坐、跑步等）。 |

前端需要在道具栏组件 `PetInventory` 上做：

- 道具卡片悬停展开。
- 不可用道具置灰并提示前置状态（例如「需要看山生病时使用」）。
- 使用后立即播放 action，不等接口返回（接口失败时回滚 UI）。

### 5.2 状态系统

后端需要提供长期状态查询接口 `GET /api/pet/state`。该接口由后端自行维护当前用户下看山的饱腹值、精神值、快乐值，给出最终的长期状态。

#### 5.2.1 长期状态

| 状态 | 表现动画 |
| --- | --- |
| 基础 | 原地走路、左右环顾、打坐、思考走路、站立开心摇摆 |
| 饥饿 | 抱腹打滚（目前同生病） |
| 犯困 | 打盹 |
| 生病 | 抱腹打滚（目前同生病） |
| 死亡 | 睡觉姿态 |

#### 5.2.2 临时状态

| 状态 | 表现动画 |
| --- | --- |
| 运动 | 俯卧撑、仰卧起坐 |
| 高兴（跳舞） | 江南 style、企鹅舞步、HipHop、霹雳舞、室内玩耍奔跑 |
| 死亡通知（用于触发死亡前置动作） | 勒住并向前倒下 |

#### 5.2.3 山言山语

TODO：不同 action 下要有不同的经典语录。占位条目：

- 打坐：……

后续在 [`assets/runtime/`](../assets/runtime/) 增加一份语录清单文件，前端按 action 随机抽取。

#### 5.2.4 前端实现要求

- 长期状态：进入应用后立即调一次 `GET /api/pet/state`；之后通过轮询（P0）或 WebSocket（P1）保持。
- 临时状态：由前端 action 触发后立即播放，不需要后端确认。播放完成后回到当前长期状态对应动画。
- 状态切换走 [`packages/kanshan-bridge`](../packages/kanshan-bridge) 的命令协议，不允许前端直接操作 Three.js scene。

### 5.3 任务系统

后端需要维护每个用户的日常任务、周常任务、剧情任务、养成挑战。前端调用 `GET /api/tasks?period=...` 获取当前任务（含任务 ID、任务名称、可完成次数、已完成次数等）。

实现要点：

- 如果任务包含「浏览」类指标，点击按钮直接跳转知乎首页推荐页。
- 黑客松阶段可能拿不到浏览、发布的真实交互数据。**简化策略：点击跳转即计数 +1**，前端调 `POST /api/tasks/progress` 上报。
- 任务完成后，需要通过接口协议额外透露任务完成交互数据，比如掉落道具、加经验值等。前端只做交互动画，**实际入库由后端在 `POST /api/tasks/progress` 内部完成**。

### 5.4 定时任务系统

定位：刘看山 Bot 可以做到吸边，定时任务唤起时弹出，给出一段语录。

- 定时项：喝水提醒、番茄工作法、护眼提醒、就寝提醒（详见 [`product-design.md`](./product-design.md) 1.6 节）。
- 当前阶段：**待调研**。需要确定定时调度放在客户端（Tauri / 插件本地定时器）还是后端（服务端定时推送）。
  - Tauri：用 `tauri-plugin-notification` 或 Rust 侧定时任务。
  - 插件：用 `chrome.alarms`。
  - Web Host：用 `setInterval` + 页面可见性 API。
- 接口占位：定时触发后端记录走 `POST /api/stats/event { type: "reminder", payload }`。

### 5.5 浏览统计

浏览统计指标见 [`product-design.md`](./product-design.md) 1.7 节。前端实现要点：

- 在浏览器插件场景下，从知乎站内 DOM 抓取浏览/点赞/评论事件，上报到 `POST /api/stats/event`。
- 在 Tauri 桌面场景下，没有页面级事件源，只能通过定时回调获取后端聚合数据展示。
- 主动服务触发规则（停留 5 分钟弹气泡总结、连续浏览同作者 3 篇推荐关注等）由插件端实现，不入后端。

## 6. 与 packages/kanshan-bridge 的对接点

[`packages/kanshan-bridge`](../packages/kanshan-bridge) 是 React UI 与 Three.js 运行时的命令/事件协议。本 RFC 涉及的所有「前端 action」最终都要通过 bridge 命令派发：

| 业务 | bridge 命令 | 说明 |
| --- | --- | --- |
| 道具消耗后表演 | `play-action` | 由 `PetInventory` 在道具点击成功后触发。 |
| 长期状态切换 | `set-mood` + `play-action` | 由轮询/推送回调在状态变化时触发。 |
| 临时状态结束回归 | `play-action`（默认 idle / walk） | 由动作播放完成事件触发。 |
| 道具挂点 | `attach-prop` / `detach-prop` | 用于复活羽毛、寻山启事等带视觉道具的 action。 |
| 特效 | `play-effect` | 用于比心、汗滴、音符等情绪表达。 |

bridge 协议的命令清单与事件清单沿用现有定义，不在本 RFC 中扩展。后续如需新增动作（例如指挥猫棒触发的舞蹈），先在 [`assets/runtime/pet-manifest.json`](../assets/runtime/pet-manifest.json) 注册，再在前端调用。

## 7. 与后端 RFC 的对应

本 RFC 的每个业务模块在后端都有对应的实现章节：

| 前端章节 | 后端章节 |
| --- | --- |
| 4.2 登录体系 | [`backend-rfc.md`](./backend-rfc.md) §3 认证 |
| 5.1 道具系统 | [`backend-rfc.md`](./backend-rfc.md) §4.2 道具接口 + §5 数据模型 inventory |
| 5.2 状态系统 | [`backend-rfc.md`](./backend-rfc.md) §4.3 状态接口 + §6 离线回溯算法 |
| 5.3 任务系统 | [`backend-rfc.md`](./backend-rfc.md) §4.4 任务接口 |
| 5.5 浏览统计 | [`backend-rfc.md`](./backend-rfc.md) §4.5 统计接口 |
