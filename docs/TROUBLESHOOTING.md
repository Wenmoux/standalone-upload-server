# 排障手册

先收集以下信息：

```bash
docker ps
docker logs --tail 300 po18-app
docker exec po18-app node docker/status-check.js local
docker exec po18-app tail -n 300 /config/runtime.log
```

分享日志前删除数据库 URL、Token、Cookie、账号密码和加密密钥。Setup/Admin 的诊断导出会自动脱敏，优先使用该入口。

## `PO18_METRICS_TOKEN must be configured`

典型日志：

```text
unsafe production configuration: PO18_METRICS_TOKEN must be configured when the server binds beyond localhost
```

原因：生产环境默认绑定 `0.0.0.0`，代码不允许公开无鉴权的 `/metrics`。

处理：

1. 在 Setup 中生成并保存 Metrics Token；或在 `.env` / `/config/app.env` 设置至少 16 字符的随机值。
2. Compose 用户确认 `PO18_METRICS_TOKEN` 已传给 `server-pg`。
3. 重启后用 Bearer Token 访问 `/metrics`。

不要用 `PO18_ALLOW_INSECURE_DEFAULTS=1` 作为长期修复。

## `database migrations are running in another instance`

这是 advisory lock 的保护信息：另一个 server 实例正在迁移。新实例每 5 秒重试，不会同时修改 schema。

常见于：

- 更新时旧、新容器短暂重叠。
- 平台滚动部署保留旧副本。
- 手动启动了第二个 server。

随后出现以下日志表示当前实例已经取得锁：

```text
[pg-migrate] applying 020_taxonomy_and_quality_semantics (timeout 600000ms)
```

保持单实例并等待，不要反复重启。

## `020_taxonomy_and_quality_semantics` 很久没有完成

020 会添加生成列、回填标准化 taxonomy 并创建索引，大库可能运行数分钟。新版本迁移默认允许 10 分钟，而普通查询仍为 30 秒。

正常完成日志：

```text
[pg-migrate] applied 020_taxonomy_and_quality_semantics
[pg-migrate] applying 021_book_manifest_checksums ...
```

异常判断：

- 超过 `PO18_PG_MIGRATION_TIMEOUT_MS` 后出现 timeout/rollback。
- server 持续重启，始终没有 `applied 020`。
- PostgreSQL 磁盘不足、连接中断或锁长期不释放。

出现异常时先停止重复副本、检查数据库磁盘/活动连接并备份，再提供从 `applying 020` 开始的完整错误段。

## Bot `startup failed: fetch failed`

Bot 启动早于 server 就绪时可能先失败，后续看到：

```text
[telegram-bot] @... connected to http://127.0.0.1:3100
```

表示已自动恢复，无需处理。

如果一直失败：

1. 检查 `PO18_SERVER_URL`；单容器为 `http://127.0.0.1:3100`，Compose 为 `http://server-pg:3100`。
2. 检查 server `/health/ready`。
3. 确认 `PO18_BOT_API_TOKEN` 两端一致。
4. 检查 Telegram API 网络、DNS 和 `TELEGRAM_API_BASE`。

若日志是 `缺少 TELEGRAM_BOT_TOKEN` 而你本来就不使用 Bot，Compose 应只启动 `postgres server-pg reader`；空 Token 的 Bot 进程会退出，restart policy 会让容器持续重启。

## Bot 反应慢

先区分 server 慢还是 Telegram 慢：

- 日志有 `Query read timeout`：检查迁移是否完成、数据库 Pool 等待、慢查询和磁盘。
- 搜索稳定需要十几秒：查看 `/metrics` 的查询 p95 与 `PO18_SEARCH_SLOW_QUERY_MS` 日志。
- Telegram 429：降低并发/频率，检查 polling 与 cooldown。
- 导出大书慢：导出会分页读取、排队、校验额度并生成文件，使用 `/tasks` 查看后台任务，而不是重复点击。

## 频道同步消息仍然被置顶

自动取消置顶只处理带 PO18 内部标记的频道自动转发副本，人工消息不会进入该分支。若系统推送仍停留在关联讨论群顶部：

1. 确认 Bot 已加入关联讨论群，而不只是加入频道。
2. 给 Bot 管理员的 `can_pin_messages` 权限。
3. 查看 Bot 日志是否出现 `automatic push unpin failed`；该错误不会阻断推送。
4. 确认运行的是包含 `telegram-push-contract.js` 的同一版本 server 与 Bot 镜像；混用旧 server 或旧 Bot 时无法识别跨进程标记。

实现始终向 `unpinChatMessage` 传入目标副本的精确 `message_id`，不会用“取消最近置顶”代替，因此人工置顶不会被连带取消。

## Reader 打开但接口失败

Reader server 只代理 `/reader-auth` 和 `/reader-api`：

1. 单容器确认 `PO18_API_BASE=http://127.0.0.1:3100`。
2. Compose 确认 `PO18_API_BASE=http://server-pg:3100`。
3. 检查 `http://server-pg:3100/health/ready`。
4. 上传 API、Bot API 和 Admin API 必须直接访问 `3100`，不能发往 `3200`。

## Bot 共享上传失败

`PO18_SHARE_API_URL` 是 Upload API 地址，不是 Reader 页面地址：

- 单容器：留空，让它回退到 `PO18_SERVER_URL`；或使用 `http://127.0.0.1:3100`。
- Compose：`http://server-pg:3100`。

指向 `3200` 会得到 404 或代理失败，因为 Reader 不代理 `/api/metadata` 和 `/api/parse`。

## 容器显示 unhealthy

按顺序检查：

```bash
curl http://127.0.0.1:3100/health/live
curl http://127.0.0.1:3100/health/ready
curl http://127.0.0.1:3100/health/deep
curl http://127.0.0.1:3200/health/ready
```

- `live` 成功、`ready` 失败：通常是数据库、迁移或 schema。
- server ready、Reader 失败：检查 Reader 构建文件和代理地址。
- deep 只有 Bot/Telegram optional 失败：不一定影响 server ready。

## Setup Token 找不到或地址反复要求登录

- 用 `docker logs po18-app` 查首次生成的 Token。
- 已有 `/config/app.env` 时，Token 保存在 `PO18_SETUP_TOKEN`。
- 首次用 query token 打开后，服务会设置 HttpOnly Cookie 并重定向到不带 token 的 URL。
- HTTPS 反代设置 `PO18_SETUP_COOKIE_SECURE=1`；HTTP 环境误设为 1 会导致浏览器不回传 Cookie。

## 镜像看起来没有更新

检查：

```bash
docker pull wenmoux/reader:v2.0
curl http://127.0.0.1:3100/health/version
```

`/health/version` 会返回 version、image、immutable image、revision 和 source hash。只执行 `docker pull` 不会替换正在运行的旧容器；Compose 需要再次 `up -d`，单容器需要按原挂载重建。

## 备份恢复失败

优先查看 Admin 任务详情和备份诊断：

- dump 必须是 PostgreSQL custom 格式并通过 `pg_restore --list`。
- 检查 checksum、客户端/服务端主版本、磁盘余量和活动连接。
- 加密远端备份必须使用原 `PO18_BACKUP_ENCRYPTION_KEY`。
- WebDAV/S3 列表没有“恢复”按钮是当前边界：远端实现只上传、维护索引和删除旧文件。先人工下载 `.enc`、用原密钥解密为 PostgreSQL custom dump，再通过 Admin 上传。
- 自动恢复演练提示 `permission denied to create database` / 无法终止连接或删除临时库时，说明数据库角色权限不足；关闭 `PO18_BACKUP_RESTORE_DRILL_ENABLED`，改在有相应权限的隔离环境演练。
- 定时演练显示 `no postgres backup` 不是创建失败：系统没有自动备份创建计划，需要先在 Admin 手动创建 PostgreSQL 备份。
- 恢复完成后应用会重启；不要在恢复期间启动第二个 server。

数据库手工命令和 rollback 见 [迁移手册](../db/MIGRATIONS.md)。
