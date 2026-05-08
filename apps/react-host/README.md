# React Host

本应用是 React 侧承载示例。它直接嵌入 `@kanshan/three-runtime`，不依赖 Cocos Creator、Cocos Web build 或 iframe。

## 运行

```bash
pnpm --filter @kanshan/react-host dev
```

## 更换 GLB 模型

当前预览只加载一个 GLB 模型。模型入口集中在 `src/kanshanModelConfig.ts`。

```ts
import kanshanModelUrl from '../../../assets/model/kanshan-model-v4.glb?url';

export const kanshanModelConfig = {
  id: 'kanshan-model-v4',
  fileName: 'kanshan-model-v4.glb',
  url: kanshanModelUrl,
} as const;
```

后续迭代时，把新 `.glb` 放到 `assets/model`，然后只改这个文件里的 import、id 和 fileName。

## 更换动作映射

GLB 动画片段映射集中在 `src/kanshanActionConfig.ts`。每个动作可以配置一个或多个 clip 名称。运行时播放该动作时，会在配置的 clip 中随机选择一个存在于 GLB 内的片段。

```ts
{
  action: 'happy',
  label: '高兴',
  duration: 'temporary',
  clips: ['Hip_Hop_Dance', 'Joyful_Dance_with_Hand_Sway', 'penguin_walk'],
  loop: false,
}
```

死亡类动作可以通过 `terminal` 和 `onlyWhenDead` 描述前置状态。预览页会在死亡后禁用其他动作，只保留复活。

## 职责

- 渲染 Three.js canvas。
- 创建 `KanshanThreeRuntime` 实例。
- 发送动作、方向、道具和特效命令。
- 展示 Three.js 运行时事件日志。

## 当前限制

当前运行时支持通过配置加载单个 `.glb` 模型。它用于跑通真实浏览器 3D 渲染、动作状态、挂点、特效和桥接协议。


## 对话调试

开发环境已经支持直接走 OpenAI 兼容协议流式接口。

在 `apps/react-host/.env.local` 里配置：

```bash
VITE_OPENAI_BASE_URL=https://model.in.zhihu.com/v1
VITE_OPENAI_API_KEY=你的 key
VITE_OPENAI_MODEL=doubao-seed-2-0-lite-260428
```

前端会请求本地 `/proxy-openai/chat/completions`，再由 Vite dev server 代理到内网模型地址。
