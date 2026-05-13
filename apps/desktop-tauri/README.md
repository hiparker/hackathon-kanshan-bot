# Desktop Tauri

macOS / Windows 桌面端壳，复用 `apps/react-host` 的 React + Three.js 看山模型。

## 运行

先启动后端：

```bash
cd services/kanshan-server
make run
```

再启动桌面端：

```bash
pnpm --filter @kanshan/desktop-tauri dev
```

## 打包

```bash
pnpm --filter @kanshan/desktop-tauri build
```

打包时默认注入 `VITE_KANSHAN_AUTH_MODE=oauth` 和 `VITE_KANSHAN_API_BASE_URL=https://kanshan.bedebug.com`。开发命令仍走本地 dev 配置。

构建产物默认在 `<cargo target>/release/bundle/macos/刘看山.app`，仓库脚本会同步拷贝到 `apps/desktop-tauri/dist/刘看山.app`，双击即可运行。

> macOS 透明窗口依赖 `macos-private-api` 特性 + `app.macOSPrivateApi: true`，缺一会出现白底。

## 桌面行为

- 窗口尺寸 720×540，无标题栏、无阴影、置顶、不进 Dock / 任务栏。
- 启动即吸到屏幕最近边，拖动停顿 220ms 后自动重新吸边。
- 中心半径约 220px 是模型/菜单交互区，区外像素鼠标穿透到桌面下层（Rust 轮询 `cursor_position` + `set_ignore_cursor_events`）。
- 右上托盘 / macOS 菜单栏图标提供「显示/隐藏」「退出」。
