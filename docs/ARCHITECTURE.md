# 项目架构

## 目标与边界

PO18 Reader Stack 是单仓库、单镜像的自托管阅读平台。核心设计目标是：

- PostgreSQL 作为唯一运行数据库。
- Reader、Admin、Setup 和 Bot 共用同一后端数据与权限边界。
- Bot 不直接连接数据库，所有业务写入通过 HTTP API。
- 长任务进入持久任务表，支持租约、心跳、重试、取消和幂等结算。
- 本地部署保持简单，同时保留可观测、备份与恢复能力。

当前仍保留部分平台无感 `book_id` 兼容路径。Manifest 会拒绝已发现的跨平台同号冲突，但统一 `(platform, book_id)` / `book_key` 身份迁移尚未实施，因此系统定位是个人或小规模可信用户自托管，而不是开放式多租户平台。

## 运行拓扑

```text
                        ┌──────────────────────┐
                        │ PostgreSQL 16        │
                        │ schema + sessions    │
                        └──────────▲───────────┘
                                   │
┌──────────────┐        ┌──────────┴───────────┐
│ Admin/Setup  ├───────►│ server-pg :3100      │
│ Userscript   │        │ Express + Vue Admin  │
│ Reader       │        │ routes + services    │
│ Telegram Bot │        │ jobs + migration     │
└──────────────┘        └──────────▲───────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
       ┌─────────┴─────────┐             ┌───────────┴─────────┐
       │ Reader :3200      │             │ Bot health :3300    │
       │ static + proxy    │             │ Telegram polling    │
       └───────────────────┘             └─────────────────────┘
```

单容器模式由 `docker/run-all.js` 监管三个子进程；Compose 模式将 PostgreSQL、server、Reader 和 Bot 分成四个容器，但应用容器使用同一镜像。

## 服务职责

| 模块 | 目录/入口 | 职责 |
| --- | --- | --- |
| 后端 | `server-pg.js`、`routes/`、`services/` | Admin、Reader、Bot、Upload API，任务、榜单、备份、健康和 OpenAPI |
| Admin | `admin-ui/` | Vue 3 管理后台，构建后发布到 `public/` |
| Setup | `docker/control-panel.js` | 无数据库时的初始化向导，以及运行后的配置/状态/日志入口 |
| Reader | `cirno-src/` | Vue 3 阅读器；`reader-server.js` 提供静态文件并代理 Reader API |
| Bot | `bot/telegram-bot.js` 与模块 | Telegram polling、命令、持久任务编排、注册用户全员通知、TXT/EPUB 构建和外部同步 |
| 数据库 | `pg-store.js`、`db/` | Pool、迁移、rollback、schema snapshot 和数据模型 |
| 运维 | `docker/`、`scripts/`、`monitoring/` | 入口、监管、备份、状态、构建、发布和告警 |

## HTTP 边界

| 前缀 | 主要调用者 | 鉴权 |
| --- | --- | --- |
| `/reader-auth/*` | Reader | 登录/注册公开，其余按 Reader Session |
| `/reader-api/*` | Reader、Bot | 搜索/元信息等公开；书架、正文、TTS、纠错、性能等按 Reader Session或具体路由策略 |
| `/bot-api/*` | Telegram Bot | `X-Bot-Token` 和 Scope/IP 策略 |
| `/api/metadata/*`、`/api/parse/*` | Userscript、Bot 共享 | Admin Session 或 Upload Token |
| `/admin-api/*` | Admin | Admin Session、RBAC、CSRF 和审计 |
| `/health/*` | Docker/运维 | 无登录；返回存活或就绪状态 |
| `/metrics` | Prometheus | Metrics Bearer Token |
| `/openapi.json`、`/api-docs` | 开发/运维 | 机器可读端点与 Schema 索引 |

Reader server 只代理 `/reader-auth` 和 `/reader-api` 到 `3100`。上传与 Bot API 应直接访问 server，不应把 `3200` 当成共享写 API 地址。

## 数据与任务

主要领域包括：

- 书籍元信息、章节缓存、标准化分类和标签。
- Reader 用户、Session、书架、历史、性能样本和书评。
- Telegram 用户、交易、签到、CDK、红包、众筹和 PO18 凭据。
- 系统任务、任务租约、幂等副作用账本、来源健康和审计。
- Admin 配置、API Token、备份、Manifest 和数据质量。

长任务先写入 `system_jobs`，Worker claim 后维护租约与心跳。全员通知也走该边界：Admin/Bot 只负责创建任务，Bot Worker 分页读取合格收件人并限速私聊；任务最多执行一次，避免部分送达后自动重试造成整批重复。扣费、免费额度和奖励通过 operation ledger 保证重试不重复结算。

## 迁移与启动

`001_baseline.sql` 是唯一初始 schema 来源，后续迁移按版本排序。启动过程：

1. 连接 PostgreSQL。
2. 获取 advisory lock；未取得时等待并重试。
3. 校验已应用迁移的 checksum。
4. 在事务中以独立迁移超时执行新 SQL。
5. 写入版本、checksum、耗时和应用版本。
6. 释放锁并完成 Token、凭据与管理员核心初始化，随后打开业务流量闸门并进入就绪状态；日报、榜单、恢复演练和爬虫调度器在放行后独立启动，单项失败只降级自身。

3100 端口可先响应 `/health/*`，但启动闸门在第 6 步完成前对业务请求返回 `503 SERVICE_STARTING`，避免事务中的新 Schema 尚不可见时发生旧结构写入。普通查询与迁移使用不同超时，避免大表回填被普通 30 秒限制打断。详见 [数据库迁移](../db/MIGRATIONS.md)。

## 安全模型

- Admin 和 Reader 使用独立 PostgreSQL Session。
- 写请求有 CSRF、CORS、限流和分路由 Body 限制。
- Upload/Bot Token 在数据库中只存 SHA-256，并支持 Scope、允许 IP、吊销和最近使用时间。
- PO18 密码与 Cookie 使用 AES-256-GCM 信封加密，支持新旧密钥并行轮换。
- TTS 代理拒绝内网、localhost、链路本地、保留地址和重定向绕过。
- Admin 高风险操作进入追加式审计；RBAC 区分 owner/operator/moderator/viewer。
- 生产环境绑定非 localhost 时必须配置 Metrics Token。

## 可观测与恢复

- 结构化 request/slow/event 日志与 `/config/runtime.log`。
- 数据库 Pool、查询耗时、任务、Crawler、Bot polling、Reader RUM 和备份指标。
- `/health/live|ready|version|deep` 与 Admin 系统页。
- 本地/远端备份、checksum、保留策略、加密和真实临时库恢复演练。
- `monitoring/prometheus-alerts.yml` 提供基础告警规则。

## 构建与发布

Dockerfile 主要阶段：

- `admin-build`、`reader-build`：生成前端静态文件。
- `server-pg`、`reader`、`bot`：分进程镜像目标。
- `app`：包含完整 stack，默认 `docker/entrypoint.js` + `docker/run-all.js`。

`main` 推送触发 CI 和 Docker 发布。Docker Hub 只更新 `wenmoux/reader:v2.0`；源码 revision/hash 保留在镜像元数据和发布证据中，发布后以 registry digest 拉取并复验。

## GEB 分形文档

- 根 `CLAUDE.md` 是 L1 全局地图；核心模块 `CLAUDE.md` 是 L2 成员与依赖地图；受控源码首部的 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 是 L3 执行契约。
- `npm run check:docs` 在 CI 中验证相对链接、必需 L2 文件和多语言源码 L3，防止代码与语义地图单边变化。
- 已发布 migration 的 checksum 是更高优先级不可变历史，因此不为补注释改写旧 SQL；其逐文件语义由 `db/migrations/CLAUDE.md` 与 `db/rollbacks/CLAUDE.md` 折叠，新变化使用更高版本文件。
- `public/`、`dist/`、`dist-reader/` 是生成相，不接受手工契约修改；L3 保存在源文件或生成器，构建产物由验证链重建。

## 已知约束与维护热点

以下是当前真实边界，不等同于运行故障，但新功能应优先消减而不是继续放大：

- `GET /reader-api/books/:bookId/chapters?includeContent=1` 是 Bot 历史导出的公开正文兼容面。新的正文客户端必须使用受书库权限保护的单章接口；彻底收紧前需要先给 Bot 提供内部鉴权导出接口和兼容期。
- 书籍身份仍有平台无感的 `book_id` 路径；Manifest 已拒绝可见的跨平台同号冲突，但统一 `book_key` 尚未迁移完成。
- 远端备份只负责上传、索引和保留删除，且没有自动创建 dump 的调度器；下载、解密和恢复仍需运维人员显式完成。
- Reader 正文、详情、书库和首页已通过领域 mixin、局部组件与独立样式边界全部回落到 800 行以内，Admin `BooksView.vue` 当前也低于阈值。仍需优先收缩的生产热点是本地书库上传 UI/CLI、`docker/control-panel.js` 与 Reader 转换报告脚本；新增能力应进入现有 component/service/style/util，而不是继续扩大组合根。
- 繁简转换已由动态加载的 OpenCC 主导，项目残留字表不足 50 项，并已删除约 2,400 字平行表和 800 篇整文 LRU；当前 `chinese-convert` chunk 约 1.20 MiB、gzip 约 526 KiB，主要体积来自 OpenCC 词典，后续优化应围绕词典切分或上游数据压缩，而不是恢复平行字表或调高警告阈值。

## 变更检查清单

- 路由变化：同步 OpenAPI、API 示例和路由测试。
- 环境变量变化：同步 `.env.example`、`.env.docker.example` 和配置参考。
- migration 变化：同步 rollback、schema snapshot 和迁移手册。
- Admin/Reader 变化：执行对应生产构建并提交 Admin 发布产物。
- Docker 输入变化：更新 `scripts/check-build-context.js`。
- 用户可见变化：更新 `PROJECT_UPDATE_LOG.md`。
