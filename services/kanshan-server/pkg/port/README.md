# port

针对公共库 / 外部依赖的二次封装层。

P0 阶段没有外部依赖封装需求，本目录留空作为占位。后续候选：

- `port/zhihuauth`：包公司 OAuth2 SDK。
- `port/llm`：包大模型 SDK（OpenAI 兼容协议、内网 doubao 等）。
- `port/observability`：包指标 / 日志 / trace 上报 SDK。
- `port/messagequeue`：包内部消息队列 SDK。

放进来的目的：让外部依赖的版本升级 / 替换不影响 `business` 与 `portal` 层。
