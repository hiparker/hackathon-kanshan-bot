# Desktop release signing

GitHub Release 下载的 macOS DMG 需要 Apple Developer ID 签名和公证。否则 macOS Gatekeeper 可能提示 App 已损坏，无法打开。本地直接构建后能打开，不代表 Release 下载后能打开。

当前 GitHub Actions 会把 macOS 产物命名为 `Liu-Kanshan_<version>_macos_<arch>_signed.dmg` 或 `Liu-Kanshan_<version>_macos_<arch>_unsigned.dmg`。`signed` 表示 CI 已配置签名和公证所需密钥；发布前仍应检查 GitHub Actions 日志，确认签名和公证步骤成功。`unsigned` 表示没有 Apple Developer ID 签名和公证，只适合内部测试。Windows 产物当前命名为 `Liu-Kanshan_<version>_windows_x64_unsigned.exe`，表示没有代码签名证书。

## macOS 密钥来源

这些值来自 Apple Developer Program，不来自 GitHub，也不来自 Tauri。

1. 用付费 Apple Developer Program 账号登录 Apple Developer。
2. 在 Mac 的 Keychain Access 里创建 Certificate Signing Request，也就是 CSR。CSR 是“证书签名请求”文件，用来向 Apple 申请证书。
3. 在 Apple Developer 的 Certificates 页面创建 `Developer ID Application` 证书。这个证书用于 App Store 之外分发的 macOS 应用。
4. 下载证书并安装到 Keychain Access。
5. 从 Keychain Access 的 My Certificates 导出证书和私钥为 `.p12` 文件，并设置导出密码。
6. 把 `.p12` 转成 base64 文本。

```sh
base64 -i Certificates.p12 -o certificate-base64.txt
```

## GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 添加这些 Secrets：

| Secret | 值从哪里来 |
| --- | --- |
| `APPLE_CERTIFICATE` | `certificate-base64.txt` 的完整内容 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | Keychain 里的 Developer ID Application 身份名，可用 `security find-identity -v -p codesigning` 查看 |
| `APPLE_ID` | Apple Developer 账号邮箱 |
| `APPLE_PASSWORD` | Apple ID 的 app-specific password，不是登录密码 |
| `APPLE_TEAM_ID` | Apple Developer Membership 里的 Team ID |

## 不能用免费账号解决的问题

免费 Apple ID 不能创建用于公开分发的 `Developer ID Application` 证书。没有这个证书，GitHub 自动构建的 DMG 只能做未签名分发。用户下载后可能需要手动移除隔离属性，例如 `xattr -dr com.apple.quarantine /Applications/刘看山.app`。这个命令只适合内部测试，不适合正式发布。

没有 Apple Developer Program 账号时，比较稳妥的做法是把 Release 标记为内部测试版，并同时上传 `README-macos-unsigned-<arch>.txt`。测试用户先把 `刘看山.app` 拖到 `/Applications`，再执行：

```sh
xattr -dr com.apple.quarantine /Applications/刘看山.app
```

这只能绕过当前机器上的隔离属性。隔离属性是 macOS 给互联网下载文件添加的安全标记。这个方案不能替代签名和公证，也不适合面向公众发布。

## 本地 macOS 打包

本地只打 macOS 包时，执行：

```sh
pnpm build:desktop:macos
```

这个命令会依次生成 Apple Silicon 包和 Intel 包。Apple Silicon 是 Apple 自研芯片架构，也常写作 arm64。Intel 是旧款 Mac 使用的 x86_64 架构。产物目录分别是：

| 架构 | 产物目录 |
| --- | --- |
| Apple Silicon / arm64 | `apps/desktop-tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg` |
| Intel / x86_64 | `apps/desktop-tauri/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg` |

如果本机没有 Intel 编译目标，先执行：

```sh
rustup target add x86_64-apple-darwin
```

本地 macOS 打包不会触发 Windows EXE。Windows 仍只在 GitHub Actions 的 `build-windows` job 里构建，或者手动执行 `pnpm --filter @kanshan/desktop-tauri run build:windows-nsis` 时才构建。
