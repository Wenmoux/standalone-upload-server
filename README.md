# PO18 Reader Stack

![PO18 Reader Stack](assets/readme-hero.svg)

一个面向个人自托管的小说书库、阅读器、后台和 Telegram Bot 一体化项目。它把上传缓存、书库检索、网页阅读、导出、Bot 交互、任务中心、备份恢复和 PO18 辅助遍历放进同一个 Docker 镜像里，适合部署在自己的服务器上长期维护私有书库。

> 项目默认使用 PostgreSQL。首次部署不需要手动建表，配置数据库连接后服务会自动初始化和迁移表结构。

## 功能概览

### 阅读器

- 独立阅读器端口：默认 `3200`。
- 支持首页、书架、详情页、目录、正文阅读、搜索、榜单和书评展示。
- 支持缓存章节阅读，避免每次打开都依赖外部站点。
- 支持 TXT / EPUB 导出，EPUB 阅读页样式可复用内置标题与头图样式。
- 支持公开书评列表，阅读器详情页可直接查看。

### 后台面板

- 后台/API 端口：默认 `3100`。
- 现代化管理面板，包含系统状态、书库、用户、交易、CDK、反馈、纠错、榜单、Bot、备份恢复、数据质量和任务中心。
- 初始化面板 `/setup` 支持：
  - 生成和保存配置。
  - 测试 PostgreSQL 连接。
  - 导入/导出 `/config/app.env`。
  - 查看服务状态、日志和脱敏诊断。
  - 手动重启服务。
- 任务中心可跟踪备份、恢复、榜单刷新、Bot 导出、书架同步、共享上传、PO18 遍历、陈旧书清理和章节顺序修复。

### Telegram Bot

- 支持搜索、详情、收藏、书架、签到、钱包、TXT/EPUB 导出、众筹、书评、PO18 登录和已购书架共享。
- Bot 不直连数据库，只通过后端 `/bot-api/*` 调用，使用 `PO18_BOT_API_TOKEN` 鉴权。
- 导出和批量共享走任务队列，避免长任务阻塞普通消息。
- 书评支持 Lv.2+ 发布，频道推送后可点赞/点踩，并结算铜币奖励或扣减。

### PO18 辅助能力

- 后台 PO18 遍历支持发现页、已购书架、元信息库、订阅列表等来源。
- 支持 Cookie 档案、并发数、重试次数、定时执行、暂停/继续/停止。
- 支持按标签、关键字、章节数和分类过滤。
- PO18 章节顺序按网站显示编号保存，例如 `1,2,4` 不会重排为 `1,2,3`。
- 已完结且缓存完整的书可标记并跳过后续补缺。

### 运维与安全

- 单镜像同时包含 `server-pg`、阅读器和 Bot。
- `/config` 挂载保存配置、运行日志和备份。
- 支持 `/health/ready`、`/health/version`、`/health/deep` 和 Prometheus `/metrics`。
- 上传写入接口需要 `PO18_UPLOAD_API_TOKEN`，支持请求头 `X-Upload-Token` 或 `X-PO18-Upload-Token`。
- Bot API 空 token 不放行，未配置 `PO18_BOT_API_TOKEN` 会返回 `503`。
- 日志和诊断信息会对 token、Cookie、密码等敏感字段脱敏。

## 架构

```text
Docker image: wenmoux/reader:v1.0

┌──────────────────────────────────────────────────────────────┐
│ po18-app                                                     │
│                                                              │
│  server-pg / admin / API       0.0.0.0:3100                 │
│  reader web server             0.0.0.0:3200                 │
│  telegram bot health           0.0.0.0:3300                 │
│                                                              │
│  /config/app.env             配置                           │
│  /config/runtime.log          运行日志                       │
│  /config/backups              数据库备份                     │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
        PostgreSQL 13+
```

## 快速部署

### 方式一：单容器部署

适合已有远程 PostgreSQL，或者希望先启动安装向导再配置数据库的场景。

```bash
docker run -d --name po18-app --restart unless-stopped -p 3100:3100 -p 3200:3200 -v /opt/po18/config:/config wenmoux/reader:v1.0
```

查看初始化 token：

```bash
docker logs po18-app
```

打开安装向导：

```text
http://服务器IP:3100/setup?token=日志里的TOKEN
```

在面板里填写 PostgreSQL、管理员账号、上传 API Token、Bot API Token、Telegram Bot Token 等配置。保存后容器会退出，Docker 会按 `--restart unless-stopped` 自动重启并进入正常服务。

启动完成后访问：

- 后台/API：`http://服务器IP:3100`
- 阅读器：`http://服务器IP:3200`
- 初始化/配置面板：`http://服务器IP:3100/setup?token=TOKEN`
- 状态面板：`http://服务器IP:3100/setup/status?token=TOKEN`
- 日志面板：`http://服务器IP:3100/setup/logs?token=TOKEN`

### 方式二：Docker Compose

适合想把 PostgreSQL 也放在同一台机器上管理的场景。

```bash
cp .env.docker.example .env
```

编辑 `.env`，至少替换这些值：

```text
POSTGRES_PASSWORD
PO18_PG_URL
PO18_UPLOAD_ADMIN_PASSWORD
PO18_UPLOAD_SESSION_SECRET
PO18_UPLOAD_API_TOKEN
PO18_BOT_API_TOKEN
TELEGRAM_BOT_TOKEN
```

启动：

```bash
docker compose -f docker-compose.hub.yml up -d
```

查看状态：

```bash
docker compose -f docker-compose.hub.yml ps
```

### 更新镜像

```bash
docker pull wenmoux/reader:v1.0
docker rm -f po18-app
docker run -d --name po18-app --restart unless-stopped -p 3100:3100 -p 3200:3200 -v /opt/po18/config:/config wenmoux/reader:v1.0
```

如果使用 Compose：

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

## 配置说明

| 配置项 | 必填 | 说明 |
| --- | --- | --- |
| `PO18_PG_URL` | 是 | PostgreSQL 连接串，例如 `postgres://user:pass@host:5432/po18` |
| `PO18_UPLOAD_ADMIN_USER` | 否 | 后台管理员用户名，默认 `admin` |
| `PO18_UPLOAD_ADMIN_PASSWORD` | 是 | 后台管理员密码 |
| `PO18_UPLOAD_SESSION_SECRET` | 是 | 后台 session 密钥，建议 32 位以上随机字符串 |
| `PO18_UPLOAD_API_TOKEN` | 是 | 上传/写入 API token |
| `PO18_BOT_API_TOKEN` | Bot 启用时必填 | Bot 调后端接口的 token |
| `TELEGRAM_BOT_TOKEN` | Bot 启用时必填 | Telegram BotFather 生成的 token |
| `PO18_METRICS_TOKEN` | 否 | `/metrics` 的 Bearer token |
| `PIKPAK_WEBDAV_URL` | 否 | Bot 导出文件的可选 WebDAV 目标 |

更多配置可参考 [.env.example](.env.example) 和 [.env.docker.example](.env.docker.example)。

## 常用命令

查看容器日志：

```bash
docker logs -f po18-app
```

查看运行日志文件：

```bash
docker exec po18-app tail -n 200 /config/runtime.log
```

容器内状态检查：

```bash
docker exec po18-app node docker/status-check.js local
```

备份配置文件：

```bash
docker exec po18-app sh -lc 'cp /config/app.env /config/app.env.bak.$(date +%Y%m%d-%H%M%S)'
```

手动回滚最近一次数据库迁移：

```bash
docker exec po18-app sh -lc 'cd /app && PO18_ALLOW_SCHEMA_ROLLBACK=1 npm run db:rollback -- --steps 1 --confirm ROLLBACK'
```

## 本地开发

安装依赖：

```bash
npm install
```

启动后端：

```bash
PO18_PG_URL="postgres://user:password@host:5432/po18" \
PO18_UPLOAD_ADMIN_PASSWORD="change-this" \
PO18_UPLOAD_SESSION_SECRET="change-this-long-random-secret" \
PO18_UPLOAD_API_TOKEN="change-this-upload-token" \
PO18_BOT_API_TOKEN="change-this-bot-token" \
npm start
```

构建后台：

```bash
npm run admin:build
```

启动 Bot：

```bash
PO18_SERVER_URL="http://127.0.0.1:3100" \
PO18_BOT_API_TOKEN="change-this-bot-token" \
TELEGRAM_BOT_TOKEN="123456:ABC" \
npm run bot
```

构建 Docker 镜像：

```bash
npm run docker:build
```

推送 Docker Hub：

```bash
npm run docker:push
```

运行测试：

```bash
npm test
```

## 目录结构

```text
.
├─ admin-ui/              后台 Vue 管理面板
├─ bot/                   Telegram Bot
├─ cirno-src/             阅读器前端和 reader server
├─ db/                    数据库迁移
├─ docker/                单镜像入口、安装向导、状态检查和备份工具
├─ routes/                Express 路由
├─ services/              业务服务
├─ tests/                 Node test 测试
├─ Dockerfile             多阶段 Docker 构建
├─ docker-compose.hub.yml 使用 Docker Hub 镜像的 Compose 部署
├─ API.md                 API 文档
└─ DOCKER.md              Docker 详细说明
```

## API 文档

- [API.md](API.md)：阅读器、后台、Bot、上传、书评、健康检查等接口。
- [DOCKER.md](DOCKER.md)：Docker、安装向导、状态检查、备份恢复和发布流程。
- [PROJECT_UPDATE_LOG.md](PROJECT_UPDATE_LOG.md)：阶段更新记录。

## 数据与隐私

请不要把个人运行数据提交到 GitHub：

- `.env`
- `/config/app.env`
- `/config/runtime.log`
- `/config/backups`
- PO18 Cookie
- Telegram token
- 数据库 dump
- 私人上传的书籍正文缓存

仓库默认通过 `.gitignore` 和 Docker 构建上下文排除常见本地数据，但发布前仍建议手动检查一次。

## 免责声明

本项目为个人自托管工具，不是 PO18 官方项目，也不包含任何站点账号、Cookie、数据库内容或书籍正文。请仅缓存和阅读你有权访问的内容，遵守目标站点规则和当地法律法规。
