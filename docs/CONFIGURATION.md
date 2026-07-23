# 配置参考

## 配置来源与优先级

应用读取进程环境变量和 `PO18_CONFIG_FILE`（默认 `/config/app.env`）。运行时环境中已有的非空值优先，配置文件只填充缺失值。

推荐方式：

- 单容器首次部署：使用 Setup 向导生成 `/config/app.env`。
- Compose：复制 `.env.docker.example` 为 `.env`，替换全部示例值。
- 密钥轮换或高级配置：在受保护的 `/config/app.env` 中维护，并限制文件权限。

不要把 `.env` 或 `/config/app.env` 提交到 Git。

## 核心必填项

| 变量 | 何时必填 | 说明 |
| --- | --- | --- |
| `PO18_PG_URL` | 始终 | PostgreSQL URL；Compose host 为 `postgres` |
| `PO18_UPLOAD_ADMIN_USER` | 始终 | 初始 Admin，默认 `admin` |
| `PO18_UPLOAD_ADMIN_PASSWORD` | 生产 | 不得使用默认或空值 |
| `PO18_UPLOAD_SESSION_SECRET` | 生产 | Session 签名，建议随机 32 字节以上 |
| `PO18_UPLOAD_API_TOKEN` | 使用外部写 API | `X-Upload-Token` / `X-PO18-Upload-Token` |
| `PO18_BOT_API_TOKEN` | 使用 Bot | Bot 与 server 的 `X-Bot-Token` |
| `PO18_METRICS_TOKEN` | 生产且 server 绑定非 localhost | `/metrics` Bearer Token；默认 Docker 场景必填 |
| `TELEGRAM_BOT_TOKEN` | 使用 Bot | BotFather Token；留空时单容器跳过 Bot，Compose 必须同时不启动 `bot` 服务 |

`PO18_ALLOW_INSECURE_DEFAULTS=1` 只用于隔离环境中的紧急诊断，不应作为生产配置。

### Compose PostgreSQL 容器

| 变量 | 模板默认 | 说明 |
| --- | --- | --- |
| `POSTGRES_DB` | `po18` | PostgreSQL 容器创建的数据库名 |
| `POSTGRES_USER` | `po18` | PostgreSQL 容器角色；必须与 `PO18_PG_URL` 一致 |
| `POSTGRES_PASSWORD` | `change-this-postgres-password` | 必须替换，并同步写入 `PO18_PG_URL`；不要提交真实值 |

## 地址与端口

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PO18_UPLOAD_HOST` | `0.0.0.0` | server 监听地址 |
| `PO18_UPLOAD_PORT` | `3100` | Admin/API/Setup |
| `PO18_READER_HOST` | 源码默认 `127.0.0.1`；Docker 覆盖 `0.0.0.0` | Reader server 监听地址 |
| `PO18_READER_PORT` | `3200` | Reader 端口 |
| `BOT_HEALTH_HOST` | 源码默认 `127.0.0.1`；Docker 覆盖 `0.0.0.0` | Bot 健康监听地址 |
| `BOT_HEALTH_PORT` | `3300` | 不应公开到公网 |
| `PO18_API_BASE` | 单容器 `http://127.0.0.1:3100` | Reader 代理目标 |
| `PO18_SERVER_URL` | 单容器 `http://127.0.0.1:3100` | Bot 主 API 地址 |
| `PO18_SHARE_API_URL` | 回退到 `PO18_SERVER_URL` | Bot 共享写 API；Compose 应为 `http://server-pg:3100` |
| `PO18_READER_PUBLIC_URL` | 空 | `/reader` 跳转和对外链接使用的 Reader 地址 |

## HTTP 与代理安全

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PO18_CORS_ORIGINS` | 空 | 生产应列出允许的完整 Origin，逗号/空格分隔 |
| `PO18_TRUST_PROXY` | `false`；Compose 模板为 `0` | 可信反向代理层数或 Express 设置；仅在确认代理拓扑后开启 |
| `PO18_CSRF_ALLOW_MISSING_ORIGIN` | `0` | 不建议在生产放宽 |
| `PO18_SETUP_COOKIE_SECURE` | `0` | HTTPS Setup 建议设为 `1` |
| `PO18_TTS_PROXY_ALLOWED_HOSTS` | 空 | 云 TTS 目标域名白名单，支持 `*.example.com` |
| `PO18_TTS_PROXY_MAX_RESPONSE_BYTES` | `10485760` | TTS 最大响应，最高限制 50 MiB |

生产 CORS 使用 `*` 时还必须显式设置 `PO18_ALLOW_INSECURE_CORS=1`；这通常不是推荐方案。

### Token Scope、来源 IP 与限流

| 变量 | 默认/模板 | 说明 |
| --- | --- | --- |
| `PO18_BOT_API_SCOPES` | `bot:read,bot:user,bot:export,bot:po18` | Bot Token 权限；管理员发币等操作需额外 `bot:admin`，不应默认授予 |
| `PO18_BOT_API_ALLOWED_IPS` | 空 | Bot Token 允许的来源 IP/CIDR；空表示只按 Token/Scope 判定 |
| `PO18_UPLOAD_API_ALLOWED_IPS` | 空 | Upload Token 允许的来源 IP/CIDR |
| `PO18_AUTH_RATE_MAX` / `PO18_AUTH_RATE_WINDOW_MS` | `20` / `900000` | 登录注册类请求窗口 |
| `PO18_PUBLIC_LOOKUP_RATE_MAX` / `PO18_PUBLIC_LOOKUP_RATE_WINDOW_MS` | `120` / `60000` | 公共搜索/查询窗口 |
| `PO18_TTS_RATE_MAX` / `PO18_TTS_RATE_WINDOW_MS` | `30` / `60000` | TTS 请求窗口 |
| `PO18_UPLOAD_RATE_MAX` / `PO18_UPLOAD_RATE_WINDOW_MS` | `600` / `60000` | Upload API 写入窗口 |
| `PO18_SETUP_AUTH_RATE_MAX` / `PO18_SETUP_AUTH_RATE_WINDOW_MS` | `20` / `900000` | Setup Token/Cookie 鉴权失败窗口 |

`PO18_TRUST_PROXY` 会改变限流和来源 IP 的可信输入。没有明确代理层时保持 `0`；开启后必须由防火墙保证客户端不能绕过代理直连应用端口。

## 数据库与迁移

完整服务运行时 `PO18_PG_URL` 是必填项；只有 Setup 向导的首次配置阶段可以暂缺数据库 URL。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PO18_PG_POOL_MAX` | `10` | Pool 最大连接数 |
| `PO18_PG_CONNECT_TIMEOUT_MS` | `10000` | 建连超时 |
| `PO18_PG_IDLE_TIMEOUT_MS` | `30000` | 空闲连接超时 |
| `PO18_PG_QUERY_TIMEOUT_MS` | `30000` | 普通查询客户端和 statement timeout |
| `PO18_PG_SLOW_QUERY_MS` | `1000` | 慢查询阈值 |
| `PO18_PG_MIGRATION_TIMEOUT_MS` | `600000` | 每个启动迁移的独立超时，最少不低于普通查询 |
| `PO18_STARTUP_DB_RETRY_MS` | `5000` | 数据库不可用/迁移锁等待重试间隔 |

紧急开关：

- `PO18_ALLOW_MIGRATION_CHECKSUM_DRIFT=1`：只允许检查已发布迁移漂移，不是日常配置。
- `PO18_ALLOW_SCHEMA_ROLLBACK=1`：只在显式 rollback 命令中临时启用。

## 凭据加密

- `PO18_CREDENTIAL_ENCRYPTION_KEY`：当前写入密钥。
- `PO18_CREDENTIAL_ENCRYPTION_KEYS`：轮换期间接受的旧密钥列表。

密钥只应存在于受保护的运行配置和密码管理器中。丢失密钥会导致已加密的 PO18 凭据无法解密。

## Bot 与导出

常用变量：

- `TELEGRAM_API_BASE`：默认 `https://api.telegram.org`。
- `TELEGRAM_REQUEST_TIMEOUT_MS`：默认 `60000`。
- `PO18_BOT_API_TIMEOUT_MS`：Bot 调 server 默认 `30000`。
- `PO18_BOT_EXPORT_PAGE_SIZE`：正文分页，默认 `100`，范围 `20–500`。
- `PO18_BOT_JOB_LEASE_SECONDS`、`PO18_BOT_JOB_HEARTBEAT_MS`：持久任务租约与心跳。
- `TELEGRAM_BROADCAST_POLL_MS`：Bot 领取后台全员通知任务的轮询间隔，默认 `5000`，最小 `2000`。
- `TELEGRAM_BROADCAST_SEND_DELAY_MS`：注册用户私聊之间的限速间隔，默认 `60` 毫秒，运行时最低 `35` 毫秒。
- `PO18_BOT_EXPORT_UNLOCK_COST`、`PO18_BOT_EXPORT_FREE_COPPER_COST`、`PO18_BOT_EXPORT_PAID_CHAPTER_SILVER_COST`：导出定价默认值；后台配置可覆盖。
- `PIKPAK_WEBDAV_URL`、`PIKPAK_WEBDAV_USERNAME`、`PIKPAK_WEBDAV_PASSWORD`、`PIKPAK_WEBDAV_ROOT`：可选导出目标。

Telegram 搜索、详情、导出、书架和 PikPak 还有独立 cooldown；除非确认滥用或限流问题，不建议一次性覆盖全部默认值。

后台 Telegram `pushTypes` 支持 `metadata`、`chapter`、`daily`、`review`。这些选项只控制频道/群组同步；全员通知是单独的 owner/Bot 管理员高风险操作，收件人固定为已注册、未封禁且绑定 Telegram 的用户。

## 单容器进程监管

| 变量 | 默认值 |
| --- | ---: |
| `PO18_CHILD_RESTART_BASE_MS` | `1000` |
| `PO18_CHILD_RESTART_MAX_MS` | `30000` |
| `PO18_CHILD_RESTART_STABLE_MS` | `120000` |
| `PO18_CHILD_RESTART_LIMIT` | `10` |
| `PO18_CHILD_STOP_TIMEOUT_MS` | `10000` |

## 备份与恢复

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PO18_BACKUP_DIR` | `/config/backups` | 本地备份目录 |
| `PO18_BACKUP_KEEP` | 服务默认值 | 本地保留数 |
| `PO18_BACKUP_TIMEOUT_MS` | 服务默认值 | pg_dump/restore 超时 |
| `PO18_BACKUP_ENCRYPTION_KEY` | 空 | 远端上传 AES-256-GCM 密钥 |
| `PO18_REMOTE_BACKUP_KEEP` | `8` | WebDAV/S3 保留数 |
| `PO18_BACKUP_RESTORE_DRILL_ENABLED` | `1` | 自动恢复演练 |
| `PO18_BACKUP_RESTORE_DRILL_INTERVAL_HOURS` | `168` | 演练间隔 |
| `PO18_BACKUP_RESTORE_DRILL_INITIAL_DELAY_MS` | `900000` | 启动后首次演练延迟 |
| `PO18_RESTORE_MAX_ACTIVE_CONNECTIONS` | 服务默认值 | 恢复前允许的活动连接上限 |
| `PO18_RESTORE_DISK_RESERVE_BYTES` | 服务默认值 | 恢复磁盘预留 |

这些变量不会自动创建数据库 dump。`PO18_BACKUP_RESTORE_DRILL_*` 只调度对 `/config/backups` 中已有最新 PostgreSQL 备份的恢复演练；无备份时跳过。演练账户需要 `CREATE DATABASE`、终止临时库连接和 `DROP DATABASE` 能力，权限受限的托管数据库应关闭自动演练并改用独立验证环境。

本地 dump 不会因设置 `PO18_BACKUP_ENCRYPTION_KEY` 自动加密；该密钥只保护 WebDAV/S3 上传的 `.enc` 副本。远端实现不提供下载/解密，必须人工取回并用同一密钥恢复。备份加密密钥和凭据加密密钥应与数据一起存入离线密码库。

## Crawler、质量与治理

- `PO18_CRAWLER_CIRCUIT_FAILURES`：来源熔断失败阈值，模板为 `5`。
- `PO18_CRAWLER_CIRCUIT_COOLDOWN_MS`：熔断冷却，模板为 `60000`。
- `PO18_QUALITY_STALE_DAYS`、`PO18_QUALITY_LARGE_CHAPTER_BYTES`、`PO18_QUALITY_SAMPLE_LIMIT`：数据质量阈值。
- `PO18_REVIEW_REPORT_THRESHOLD`：书评自动进入审核所需独立举报数，默认 `3`。
- `PO18_REVIEW_REPORT_DAILY_LIMIT`：单用户每日举报上限，默认 `5`。
- `PO18_BOOK_REVIEW_*`：发评、投票频率和最多改票次数。

## 日志与可观测

- `PO18_RUNTIME_LOG_FILE`：默认 `/config/runtime.log`。
- `PO18_RUNTIME_LOG_MAX_BYTES`：单容器日志轮转阈值。
- `PO18_REQUEST_LOG_FILE`、`PO18_SLOW_LOG_FILE`、`PO18_EVENT_LOG_FILE`：结构化日志文件。
- `PO18_SLOW_REQUEST_MS`：HTTP 慢请求阈值。
- `PO18_READER_RUM_RETENTION_DAYS`：Reader 性能样本保留时间。

完整变量仍以代码中的 `process.env` 读取点和两个 `.env` 模板为准；新增高影响变量时应同时更新本文件。
