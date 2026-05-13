# React Host

本应用是 React 侧承载示例。它直接嵌入 `@kanshan/three-runtime`，不依赖 Cocos Creator、Cocos Web build 或 iframe。

## 运行

```bash
cd services/kanshan-server
make run

pnpm --filter @kanshan/react-host dev
```

`dev` 当前等价于 `dev:vite`。后续如果新增其他 Web 版本，可以继续保留 `*:vite` 作为 Vite 版本入口。

React Host 主页面是 `http://localhost:5173/`。调试页面是 `http://localhost:5173/debug`。

前端会通过 Vite proxy 把本地 `/api/*` 请求转发到后端，默认地址是 `http://localhost:8787`。如需修改，在 `apps/react-host/.env.local` 里配置：

```bash
VITE_KANSHAN_API_BASE_URL=http://localhost:8787
VITE_KANSHAN_AUTH_CODE=local-dev
```

当前后端登录是 P0 mock：前端会自动把 `VITE_KANSHAN_AUTH_CODE` 当作知乎 code 调 `POST /api/auth/zhihu`，并把返回的 session token 存到 `localStorage`，后续库存、状态、任务接口都会带 `X-Session-Token`。

生产 Web 默认使用知乎 OAuth 登录。首次打开页面时，如果本地没有有效 session，会跳到 `GET /api/auth/zhihu/login`；登录成功后回到原页面，并同步刘看山状态、道具和任务。开发环境如需保持 mock 登录，可继续设置：

```bash
VITE_KANSHAN_AUTH_MODE=mock
```

## 静态启动

先构建静态产物：

```bash
pnpm --filter @kanshan/react-host build
```

本地预览构建后的静态产物：

```bash
pnpm --filter @kanshan/react-host preview
```

也可以用一条命令构建并启动静态预览：

```bash
pnpm --filter @kanshan/react-host start:static
```

上面三个命令当前分别等价于 `build:vite`、`preview:vite` 和 `start:static:vite`。如果需要明确启动 Vite 静态版本，可以直接运行：

```bash
pnpm --filter @kanshan/react-host start:static:vite
```

预览服务默认读取 `apps/react-host/dist`，页面地址通常是 `http://localhost:4173/`，调试页面是 `http://localhost:4173/debug`。生产静态包会直接请求 `VITE_KANSHAN_API_BASE_URL` 指向的后端，例如 `http://localhost:8787/api/*`。如果静态服务不支持单页应用回退，需要把 `/debug` 回退到 `index.html`。

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
VITE_OPENAI_BASE_URL=你的 OpenAI 兼容接口基地址
VITE_OPENAI_API_KEY=你的 key
VITE_OPENAI_MODEL=doubao-seed-2-0-lite-260428
```

前端会请求本地 `/proxy-openai/chat/completions`，再由 Vite dev server 代理到配置的模型接口地址。

### SecondMe Lab（思维分身流式对话）

与 [SecondMe API](https://develop-docs.second.me/) 一致：`POST /api/secondme/chat/stream` 使用 `Authorization: Bearer lba_at_...`（需应用开通 `chat` 等 scope），响应 SSE 与 OpenAI 流式类似（`data: {"choices":[{"delta":{"content":"..."}}]}`）。

本仓库在 **`VITE_SECONDME_CHAT=1`** 时会让 `chatService` 把 OpenAI 形态的 `messages[]` 转成 SecondMe 的 `message` + `systemPrompt`，并把 Vite 代理重写为 Lab 上的 **`/api/secondme/chat/stream`**（基地址默认 `https://api.mindverse.com/gate/lab`，也可显式设置 `VITE_OPENAI_BASE_URL`）。

```bash
VITE_SECONDME_CHAT=1
VITE_OPENAI_API_KEY=lba_at_你的_AccessToken
# 可选；不设则用文档默认模型
VITE_OPENAI_MODEL=anthropic/claude-sonnet-4-5
# 可选
VITE_SECONDME_APP_ID=general
VITE_SECONDME_MAX_TOKENS=2000
# VITE_SECONDME_WEB_SEARCH=1
```
