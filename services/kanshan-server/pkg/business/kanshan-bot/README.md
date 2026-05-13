# business/kanshan-bot

刘看山陪伴 Bot 这条产品线的**特殊业务处理 / 业务逻辑**。这里不放：

- **SQL 操作**：放在 [`pkg/basic/dao/impl/`](../../basic/dao/impl/)。
- **通用业务保障 + 数据二次加工**（参数校验、错误码、事务、字段映射等）：放在 [`pkg/basic/service/impl/`](../../basic/service/impl/)。

本目录只放跨 service 的产品线编排、产品线特有的算法 / 规则。

| 子目录 | 责任 |
| --- | --- |
| `state/` | 长期状态数据结构 + 离线回溯衰减算法（与 [`planning/product-design.md`](../../../../../planning/product-design.md) 1.2 节定义的衰减率绑定）。`pkg/basic/service/impl/petstate.go` 的 `Apply` 调用就是从这里来的。 |

后续如果出现「道具消耗后要联动多个 service 才能完成」「特定剧情任务有专属脚本」之类的场景，再在本目录下加新包。普通 CRUD / 校验 / 通用 reward 计算都不属于这里。

如果一个进程要承载多条产品线（例如 `kanshan-debate`、`kanshan-distill`），就在 `pkg/business/` 下再开一个兄弟目录，互不交叉。
