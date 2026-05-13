# 刘看山素材目录

本目录存放素材规范、参考素材和后续运行时资产。正式方向是 `Three.js + 3D toon 北极狐`。手写 SVG 不再作为刘看山正式角色本体。

`source-image` 中的图片只作为风格参考，不进入运行时打包。正式角色资产应从概念规范、3D 模型、Three.js runtime 资源和运行时清单逐步落地。

## 目录说明

| 目录 | 说明 |
| --- | --- |
| `concept` | 北极狐三视图、比例、动作、骨骼和挂点规范。 |
| `model` | Blender 源文件位置、`manifest.json` 模型清单与 Three.js 接入要求。GLB 通过 `pnpm assets:fetch` 从 CDN 拉取，不进 git。 |
| `runtime` | 动作、情绪、挂点、道具和特效的机器可读清单。 |
| `props` | 后续道具资源目录。正式道具应做成 Three.js 挂点资源、3D 模型或适合 Three.js 运行时加载的 2D 资源。 |
| `effects` | 后续特效资源目录。正式特效应做成 Three.js 粒子、sprite、材质动画或 mesh 特效。 |

## 使用原则

- 正式角色本体使用 Three.js 承载。
- 正式角色模型通过 Blender 制作，并以 glTF/FBX 接入。
- React 只通过 `packages/kanshan-bridge` 控制角色。
- 道具挂点必须遵循 `assets/runtime/pet-manifest.json` 和 `@kanshan/bridge` 的挂点协议。
- 特效只能通过 `showEffect` 命令触发，React 不直接控制特效节点。
- 不再使用手写 SVG 作为刘看山正式角色本体。

## 关键规范

| 文档 | 用途 |
| --- | --- |
| `concept/kanshan-arctic-fox-spec.md` | 角色形体、三视图、比例、骨骼、动作和挂点要求。 |
| `concept/three-view-brief.md` | 三视图制作 brief 和图像生成提示词。 |
| `concept/modeling-checklist.md` | 3D 建模验收清单。 |
| `model/README.md` | 模型资产目录、导出要求和 Three.js 接入要求。 |
| `runtime/pet-manifest.json` | 动作、情绪、挂点、道具和特效的机器可读清单。 |

## 运行时清单规则

`runtime/pet-manifest.json` 是机器可读的角色运行时清单。它把动作、情绪、挂点、道具和特效名称固定下来，供 React、Three.js 和测试共同校验。

- `actions` 必须与 `@kanshan/bridge` 的 `petActions` 一致。
- `moods` 必须与 `@kanshan/bridge` 的 `petMoods` 一致。
- `slots` 必须与 `@kanshan/bridge` 的 `petSlots` 一致。
- `props` 和 `effects` 当前是占位清单，不代表已存在正式 Three.js 挂点资源。

## 原始参考图索引

| 源文件 | 参考用途 |
| --- | --- |
| `source-image/QQ20260430-183921.png` | 靶子道具、侧脸站姿、手部悬挂动作。 |
| `source-image/QQ20260430-184020.png` | 口水、疲惫或饥饿状态参考。 |
| `source-image/QQ20260430-184043.png` | 圣诞帽、木头坐姿和节日道具参考。 |
| `source-image/QQ20260430-184151.png` | 比心动作和爱心特效参考。 |
| `source-image/QQ20260430-184158.png` | 开心行走、阳光场景和尾巴动作参考。 |
| `source-image/QQ20260430-184206.png` | 音乐、闭眼、摇摆状态参考。 |
| `source-image/QQ20260430-184211.png` | 横躺、疲惫和低能量状态参考。 |
| `source-image/QQ20260430-184228.png` | 近景表情和害羞手势参考。 |
| `source-image/QQ20260430-184321.png` | 礼帽、领结、手杖和皮肤配饰参考。 |
| `source-image/QQ20260430-184328.png` | 书桌、写字、专注和阴云状态参考。 |
| `source-image/QQ20260430-184351.png` | 滑板、速度线和运动状态参考。 |
| `source-image/QQ20260430-184400.png` | 球类道具、跑跳动作参考。 |
