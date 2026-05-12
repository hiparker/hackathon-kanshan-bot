# Docker

这个目录只支持后端镜像。前端 React Host 继续使用 Vite 或静态文件方式启动。

## 启动后端

先确保宿主机 SQLite 数据目录存在：

```bash
sudo mkdir -p /data/kanshan-sql
```

构建并启动：

```bash
cd docker
docker compose up -d --build
```

后端地址是 `http://localhost:8787`。SQLite 文件写入宿主机 `/data/kanshan-sql/kanshan.db`，容器内路径是 `/data/kanshan-sql/kanshan.db`。

## 调试接口

调试接口默认关闭。关闭时，`POST /api/pet/debug/state` 和 `POST /api/inventory/restock` 会返回 `403 DEBUG_MODE_DISABLED`。

如需开启，在 `docker/docker-compose.yml` 中改：

```yaml
KANSHAN_DEBUG_MODE: "true"
```

然后重启：

```bash
docker compose up -d
```

## 常用命令

```bash
docker compose logs -f kanshan-server
docker compose ps
docker compose down
```
