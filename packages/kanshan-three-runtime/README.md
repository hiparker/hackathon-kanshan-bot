# kanshan-three-runtime

`kanshan-three-runtime` 是刘看山陪伴 Bot 的浏览器 Three.js 运行时。它通过 `GLTFLoader` 加载 Blender 导出的 GLB 模型，使用 `AnimationMixer` 播放骨骼动画 clip，并为道具与情绪特效提供 7 个挂点。

## 当前能力

- 通过 `modelUrl` 加载 GLB，自动归一化模型尺寸与朝向。
- 通过 `clipMap` 把语义 `PetAction` 映射到 GLB 内的真实 clip 名称（支持权重）。
- `playAction`：选中语义动作对应的 clip 播放，支持 loop 和 repetitions。
- `playClip`：直接按 clip 名称播放原始 GLB 动画。
- `setMood`：把情绪映射成对应动作循环播放。
- `setDirection`：按 yaw 旋转角色与挂点容器。
- `equipProp`：在 head / mouth / hand-left / hand-right / tail / feet / emotion 七个 slot 上挂载帽子、手杖、滑板等程序化道具。
- `showEffect`：在指定 slot 上播放爱心、汗滴或音符特效。
- 没有 GLB 时不渲染角色，只保留地面阴影和环境光。

## 边界

- 不再保留任何手绘 SVG 描摹或程序化贴纸 rig。新增美术表达必须先在 GLB 中产出 clip 或新道具/特效模型。
- React 只通过 `@kanshan/bridge` 发送高层命令，不直接操作 Three.js scene。
