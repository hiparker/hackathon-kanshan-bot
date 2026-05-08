# 第二阶段 Three.js 美术返工记录

第二阶段的结论是：刘看山不能先按 3D 玩偶建模。早期的程序化几何拼装与手绘 SVG 描摹方案都已废弃。当前正式方案是 Blender 精模导出 GLB，由 Three.js 通过 `GLTFLoader` 加载，`AnimationMixer` 驱动骨骼动画。

## 失败稿问题

- 球形头和胶囊身体让角色胖成几何拼图。
- 侧面时仍按正面方式挂手脚，导致手脚不在身体结构上。
- 圆柱和胶囊四肢与样图中的黑色线条冲突。
- 尾巴独立漂浮，没有和身体轮廓连接。
- 硬做 3D 转向导致鼻吻、头部和身体关系变形。
- 中间一版改用手绘 SVG 描摹做静态验收稿，仅作短期参考，不进入运行时。

## 当前实现

- 角色本体由 `assets/model/kanshan-model-v5.glb` 提供，统一通过 `assets/model/manifest.json` 中的 CDN 拉取。
- `@kanshan/three-runtime` 只负责 GLB 加载、材质归一化、`AnimationMixer` 播放、yaw 朝向、道具/特效挂点和事件回传。
- 语义动作 → GLB clip 的映射集中在 `apps/react-host/src/kanshanActionConfig.ts`，运行时通过 `playAction` / `playClip` 命令触发。
- React 仅通过 `@kanshan/bridge` 发送命令，不直接操作 Three.js scene。

## 验收顺序

1. 拉取 GLB 后，浏览器首屏能看到刘看山角色，能切换语义动作。
2. 道具（帽子、滑板、手杖）和特效（爱心、汗滴、音符）通过 `equipProp` / `showEffect` 挂载到对应 slot 上。
3. 后续新增动作或修正映射，只调整 `kanshanActionConfig.ts` 与 `assets/runtime/pet-manifest.json`，不重写 runtime。
