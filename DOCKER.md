# Docker 部署与运维

本文是 PO18 Reader Stack 的 Docker 运行手册。配置项集中在 [配置参考](docs/CONFIGURATION.md)，启动异常集中在 [排障手册](docs/TROUBLESHOOTING.md)。

## 运行形态

### 单容器

`wenmoux/reader:v2.0` 默认运行 `docker/run-all.js`，由进程监管器分别启动并重启：

- `server-pg`：Admin/API/Setup，端口 `3100`。
- Reader server：静态站点和 API 代理，端口 `3200`。
- Telegram Bot：仅配置 Telegram Token 时启动，健康端口 `3300`。

单容器只需要持久化 `/config`，PostgreSQL 可以在外部服务器或另一个容器中。

### Compose 四容器

`docker-compose.hub.yml` 启动：

- `postgres`：PostgreSQL 16。
- `server-pg`、`reader`、`bot`：三个进程容器，复用同一应用镜像。

Compose 使用 `po18-postgres-data` 和 `po18-config` 两个命名卷。Bot 的 `3300` 只映射到宿主机 `127.0.0.1`。

## 首次部署：单容器 Setup

准备持久目录并启动：

```bash
sudo install -d -o 1000 -g 1000 /opt/po18/config
docker run -d --name po18-app --restart unless-stopped \
  -p 3100:3100 -p 3200:3200 \
  -v /opt/po18/config:/config \
  wenmoux/reader:v2.0
```

没有 `PO18_PG_URL` 且 `/config/app.env` 不存在时，只启动 Setup。获取 Token：

```bash
docker logs po18-app
```

打开 `http://SERVER_IP:3100/setup?token=TOKEN`。Token 会交换成 HttpOnly Cookie，并从地址栏移除。

Setup 会：

1. 测试 PostgreSQL 连接。
2. 保存管理员、Session、上传 API、Metrics、Bot API 和 Telegram 配置。
3. 以 `0600` 权限写入 `/config/app.env`。
4. 退出当前进程，让 Docker restart policy 启动完整服务。

默认配置导出为 `app.safe.env`，不会包含直接可用的密码、Token、Cookie、数据库 URL 和加密密钥。完整秘密导出必须在已认证 Setup 会话中显式使用 `include_secrets=1&confirm=EXPORT_SECRETS`，下载后应立即进入加密存储。

## 首次部署：Docker Compose

复制模板：

```bash
cp .env.docker.example .env
```

必须替换：

```text
POSTGRES_PASSWORD
PO18_PG_URL
PO18_UPLOAD_ADMIN_PASSWORD
PO18_UPLOAD_SESSION_SECRET
PO18_UPLOAD_API_TOKEN
PO18_BOT_API_TOKEN
PO18_METRICS_TOKEN
TELEGRAM_BOT_TOKEN（完整 Compose 启动 Bot 时必填）
```

Compose 网络中的数据库 host 是 `postgres`：

```text
postgres://po18:你的密码@postgres:5432/po18
```

启动发布镜像：

```bash
docker compose -f docker-compose.hub.yml up -d
docker compose -f docker-compose.hub.yml ps
```

不用 Bot 时不要启动一个空 Token 的 `bot` 容器，应明确选择服务：

```bash
docker compose -f docker-compose.hub.yml up -d postgres server-pg reader
```

Bot 进程会在 Token 为空时返回失败；若仍使用无参数 `up -d`，`restart: unless-stopped` 会导致它反复重启。

从源码构建各阶段：

```bash
docker compose up -d --build
```

`docker-compose.yml` 面向本机源码开发，`3100/3200` 默认只绑定 `127.0.0.1`；生产使用 Hub Compose 或自行配置受保护的反向代理。两套 Compose 都将 `/config` 持久化。Hub Compose 已设置 `restart: unless-stopped`，Setup 保存退出后会自动拉起。

> `docker compose down -v` 会同时删除 `po18-config` 与 PostgreSQL 数据卷，等价于删除运行配置和数据库。普通停止/升级只使用 `down` 或 `up -d`，除非已经验证离线备份，否则不要带 `-v`。

## 必需安全配置

生产环境不得继续使用示例值。最少要求：

- `PO18_UPLOAD_ADMIN_PASSWORD`：后台管理员密码。
- `PO18_UPLOAD_SESSION_SECRET`：至少 16 字符，建议随机 32 字节以上。
- `PO18_UPLOAD_API_TOKEN`：外部写 API 的 `X-Upload-Token`。
- `PO18_BOT_API_TOKEN`：Bot 与后端通信的 `X-Bot-Token`。
- `PO18_METRICS_TOKEN`：生产环境绑定非 localhost 时强制要求。

访问 Metrics：

```bash
curl -H "Authorization: Bearer $PO18_METRICS_TOKEN" http://127.0.0.1:3100/metrics
```

反向代理部署建议同时设置：

- `PO18_TRUST_PROXY=1`：仅在前方确实有一层可信代理时使用。
- `PO18_CORS_ORIGINS=https://reader.example.com`：不要使用 `*`。
- `PO18_SETUP_COOKIE_SECURE=1`：Setup 通过 HTTPS 访问时启用。
- `PO18_READER_PUBLIC_URL`：后端生成 Reader 跳转时使用的公网地址。

Reader 与 Admin/API 分别使用两个域名时，浏览器仍应通过 Reader 域名的同源 `/reader-auth`、`/reader-api` 访问 3200；3200 再代理到 3100。2.0.0 之后的 Reader server 会把原始公网 Host/协议继续传给后端，CSRF 同时接受浏览器控制的 `Sec-Fetch-Site: same-origin` 证据，因此外层代理即使把内部上游 Host 改写为容器地址，或未继续传递 `Origin`/`Referer`，也不会让真实同源登录被误判为跨站请求。若更旧的代理连 Fetch Metadata 也丢失，Admin/Reader 登录、Reader 注册和 Telegram 登录仍兼容历史页面使用的 JSON、表单或未声明内容类型请求以及历史/活动 Session Cookie，尾部斜杠也兼容；兼容仅限身份入口，其他无来源写入继续拒绝，真实 `cross-site` 请求始终优先拒绝。

不要直接把 `3100` 的 Setup/Admin 暴露给不受信网络；至少使用 HTTPS、访问控制和防火墙。不要公开 `3300`。

## 可选加固运行

镜像支持非 root 与只读根文件系统：

```bash
docker run -d --name po18-app --restart unless-stopped \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  -p 3100:3100 -p 3200:3200 \
  -v /opt/po18/config:/config \
  wenmoux/reader:v2.0
```

宿主机 `/opt/po18/config` 必须允许 UID/GID `1000` 写入配置、日志和备份。

## 更新镜像

Compose：

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

单容器更新前记录原命令和挂载，然后：

```bash
docker pull wenmoux/reader:v2.0
docker stop po18-app
docker rm po18-app
```

使用相同端口、环境变量和 `/config` 挂载重新执行 `docker run`。删除容器不会删除 bind mount，但不要删除 `/opt/po18/config` 或 PostgreSQL 数据。

## 启动迁移

server 在连接数据库后按文件名顺序执行 `db/migrations/*.sql`：

- 普通查询默认 `30000ms`。
- 迁移默认 `600000ms`，可由 `PO18_PG_MIGRATION_TIMEOUT_MS` 调整。
- PostgreSQL advisory lock 保证同时只有一个实例迁移。
- 未取得锁的实例每 5 秒重试。

升级时可能看到：

```text
[startup] database unavailable (database migrations are running in another instance); retrying in 5000ms
[pg-migrate] applying 020_taxonomy_and_quality_semantics (timeout 600000ms)
[pg-migrate] applied 020_taxonomy_and_quality_semantics
```

这表示迁移保护正常工作。`020` 包含生成列、taxonomy 回填和索引，大库可能持续数分钟。3100 端口会先提供存活/就绪探测，但在日志出现 `[startup] database initialized` 前，业务接口统一返回带 `Retry-After` 的 `503`，避免请求读写尚未提交的新 Schema。核心初始化失败会每 60 秒受控重试；后台调度器单项失败只禁用自身，不会锁死业务接口。迁移期间不要滚动启动多个副本或反复重启。

迁移备份、状态检查和 rollback 见 [db/MIGRATIONS.md](db/MIGRATIONS.md)。

## 健康检查与日志

```bash
docker ps
docker logs -f po18-app
docker exec po18-app node docker/status-check.js local
docker exec po18-app tail -n 200 /config/runtime.log
```

Compose：

```bash
docker compose -f docker-compose.hub.yml ps
docker compose -f docker-compose.hub.yml logs -f server-pg reader bot
```

健康端点：

| 端点 | 含义 |
| --- | --- |
| `/health/live` | 进程存活 |
| `/health/ready` | 数据库、schema 和应用启动状态；迁移/初始化未完成时为 `503` |
| `/health/version` | 构建版本、revision、镜像和源码指纹 |
| `/health/deep` | 数据库、磁盘、Reader、Bot、Telegram 等深度检查 |

Prometheus 告警样例位于 `monitoring/prometheus-alerts.yml`。

## 备份、恢复与演练

- 本地备份目录：`/config/backups`。
- 当前没有自动创建数据库 dump 的定时器；备份由 Admin/运维命令显式创建。每周调度的是“取已有最新备份做恢复演练”，没有本地 PostgreSQL 备份时会跳过。
- PostgreSQL custom dump 会记录 checksum、客户端版本和 schema 版本。
- 恢复前执行文件检查、目标连接检查和磁盘余量检查。
- 恢复前自动再备份当前数据库；恢复完成后重启服务以清理连接池。
- 恢复演练默认每 168 小时把最新备份恢复到临时数据库，验证核心表后删除临时库。
- 恢复演练连接账户必须能创建数据库、终止临时库连接并删除数据库；托管 PostgreSQL 不授予这些权限时，应设置 `PO18_BACKUP_RESTORE_DRILL_ENABLED=0`，并在独立有权限环境定期演练。
- 本地 `.dump` 保持 PostgreSQL custom 明文格式；`PO18_BACKUP_ENCRYPTION_KEY` 只在上传 WebDAV/S3 前生成临时 AES-256-GCM `.enc` 文件。
- 当前远端模块只实现上传、索引和保留删除，不负责下载。恢复远端 `.enc` 时需从 WebDAV/S3 手工取回，用原密钥解密成 dump，再通过 Admin 上传后执行校验/恢复。
- dump 加密密钥与 `PO18_CREDENTIAL_ENCRYPTION_KEY(S)` 都必须连同备份一起离线保存；任何一类密钥遗失都会让对应备份或凭据不可恢复。

常用演练配置：

```env
PO18_BACKUP_RESTORE_DRILL_ENABLED=1
PO18_BACKUP_RESTORE_DRILL_INTERVAL_HOURS=168
PO18_BACKUP_RESTORE_DRILL_INITIAL_DELAY_MS=900000
PO18_REMOTE_BACKUP_KEEP=8
```

生产恢复优先使用 Admin 的备份页面，避免手工命令绕过校验和审计。

## 进程监管

单容器会独立重启 server、Reader 和 Bot：

```env
PO18_CHILD_RESTART_BASE_MS=1000
PO18_CHILD_RESTART_MAX_MS=30000
PO18_CHILD_RESTART_STABLE_MS=120000
PO18_CHILD_RESTART_LIMIT=10
PO18_CHILD_STOP_TIMEOUT_MS=10000
```

某个子进程失败不会立即停止其他服务；超过重启上限才会让容器失败退出。

## GitHub Actions 与 Docker Hub

推送 `main` 会触发 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`。发布工作流执行：

1. UTF-8、Schema、ESLint、Prettier 和文档链接检查。
2. 单元测试、覆盖率和依赖审计。
3. Admin/Reader 构建与 Docker context 检查。
4. 真实 PostgreSQL、搜索计划基准和本地镜像冒烟。
5. 推送 revision/source-hash 标签并更新 `wenmoux/reader:v2.0`。
6. 按 registry digest 再拉取并冒烟。

GitHub 仓库 Secrets：

- `DOCKERHUB_TOKEN`：必填，只授予目标仓库所需的 Docker Hub Read & Write，不授予账户管理能力。
- `DOCKERHUB_USERNAME`：可选，默认 `wenmoux`。

推送与 `package.json` 版本对应的 tag（如 `v2.0.0`）会进入正式发布模式，额外生成不可变 semver 标签、SBOM、Cosign 签名和 attestations。

`wenmoux/reader:v2.0` 是随 `main` 更新的移动标签，不是不可变版本。生产回滚或严格复现可从 `/health/version`/registry 记录中取得 digest，并使用 `wenmoux/reader@sha256:...` 固定部署。仓库应保护 `main`、要求 CI 通过，并限制 `.github/workflows/` 与发布 Secrets 的修改权限；普通源码推送者不应能绕过这些门禁。

## 常见故障

Metrics Token、迁移锁、Bot `fetch failed`、数据库超时、Reader 代理和镜像版本判断见 [排障手册](docs/TROUBLESHOOTING.md)。
