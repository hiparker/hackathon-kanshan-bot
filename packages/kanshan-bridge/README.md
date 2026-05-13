# kanshan-bridge

`kanshan-bridge` 是 React UI 与 Three.js 角色运行时之间的通信协议包。React 只发送高层命令。Three.js runtime 负责骨骼、动画、材质、挂点和特效。

## 导出能力

- `PetCommand`、`PetRuntimeEvent`、`KanshanRuntimeBridge`：核心协议类型。
- `petActions`、`petMoods`、`petSlots`：动作、情绪和挂点常量。
- `normalizeYaw()`：把 yaw 角度归一到 0 到 360 区间。
- `validatePetCommand()`：返回结构化校验结果。
- `isPetCommand()`：类型守卫，内部使用结构化校验。
- `createMemoryBridge()`：内存 bridge，用于 React 示例和单元测试。
- `createPostMessageBridge()`：DOM `postMessage` bridge，用于 React 页面连接 iframe 或 WebView 中的运行时。

## 命令类型

- `setDirection`：设置角色 yaw 方向。0 为正面，90 为朝右，180 为背面，270 为朝左。
- `playAction`：播放动作，包括 `idle`、`walk`、`run`、`blink`、`happy`、`dragging`、`hungry`、`sleepy`、`sick`。
- `setMood`：设置情绪状态。
- `equipProp`：把道具挂到指定挂点。`propId` 为 `null` 表示卸下。
- `setPosition`：设置角色在容器中的位置。
- `showEffect`：在指定挂点展示特效。

## 事件类型

- `ready`：角色运行时初始化完成。
- `actionStart`：动作开始。
- `actionEnd`：动作结束。
- `directionChanged`：方向改变。
- `propEquipped`：道具挂载改变。
- `error`：运行时错误。

## 使用示例

```ts
import { createMemoryBridge } from '@kanshan/bridge';

const bridge = createMemoryBridge();
const off = bridge.onEvent((event) => console.log(event));

bridge.send({ type: 'setDirection', yaw: 45 });
bridge.send({ type: 'playAction', action: 'happy' });
bridge.send({ type: 'showEffect', effectId: 'heart', slot: 'emotion', durationMs: 1200 });

off();
bridge.destroy();
```
