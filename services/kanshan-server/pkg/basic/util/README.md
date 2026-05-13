# util

`pkg/basic/util/` 收纳所有"零业务、零产品线、被多处复用"的小工具，每个工具一个独立子包。

放进来的代码必须满足：

- 不引用 `database/sql`、不引用 `pkg/core/service`、不引用 `pkg/business/*`。
- 单一职责，无副作用，可独立单测。
- 和具体产品线无关；产品线特殊业务请放 `pkg/business/<product-line>/`。

## 已有子包

| 子包 | 作用 |
| --- | --- |
| `httpx` | 统一的 JSON 响应 / 错误信封写入，被 `portal/*` 与 `portal/errx` 复用 |
| `session` | `X-Session-Token` 头解析 + chi-middleware + token 编解码（P0 是 `s_<user_id>`，P1+ 切 JWT） |

## 后续候选

- 时间窗口 / 周次计算（剥离 task service 里 ISO week 的逻辑）。
- ID 编码工具。
- map / slice 上的小型函数式工具。
