# PO18 旁路服务 API 文档

基础地址：

```text
http://localhost:3100
```

## 阅读器页面与读者账号 API

阅读器页面：

```http
GET /reader
```

Cirno master 源码版页面：

```http
GET /cirno
```

读者账号使用独立 session，不影响后台管理员登录。

### 读者注册

```http
POST /reader-auth/register
```

请求：

```json
{
  "username": "reader01",
  "password": "123456",
  "nickname": "读者"
}
```

### 读者登录 / 退出 / 当前用户

```http
POST /reader-auth/login
POST /reader-auth/logout
GET  /reader-auth/me
```

登录请求：

```json
{
  "username": "reader01",
  "password": "123456"
}
```

返回：

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "reader01",
    "nickname": "读者"
  }
}
```

### 我的书架

需要读者登录。

```http
GET    /reader-api/me/bookshelf
GET    /reader-api/me/bookshelf/:bookId/status
POST   /reader-api/me/bookshelf/:bookId
DELETE /reader-api/me/bookshelf/:bookId
```

### 阅读历史 / 继续阅读

需要读者登录。

```http
GET  /reader-api/me/history
POST /reader-api/me/history
```

保存进度请求：

```json
{
  "bookId": "545061",
  "chapterId": "6424173",
  "progress": 0.42
}
```

说明：

- 注册登录会新增并使用 `reader_users`、`reader_bookshelf`、`reader_history`。
- 现有 `book_metadata` 和 `chapter_cache` 字段不变。

## 公共阅读器 API

以下接口不需要登录，前缀为 `/reader-api`。

### 热搜关键词

```http
GET /reader-api/hot-keywords?limit=12
```

热搜数据存放在 PostgreSQL 的 `admin_config` 配置项里，不改 `book_metadata` / `chapter_cache` 字段。
新 Telegram Bot 通过 `/bot-api/hot-keywords` 写入和迁移旧搜索日志。

### 1. 搜索书籍

```http
GET /reader-api/search
```

参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` / `q` | 关键词，匹配书名、作者、ID、标签 |
| `author` | 作者筛选，模糊匹配 |
| `tag` | 标签筛选，模糊匹配 |
| `platform` | 站别，如 `po18`、`popo`、`haitang` |
| `sort` | 排序，见下方 |
| `page` | 页码，默认 `1` |
| `limit` | 每页数量，默认 `20`，最大 `100` |

排序：

```text
updated_desc / updated_asc
cache_desc / cache_asc
complete_desc / complete_asc
popularity_desc / popularity_asc
title_asc / title_desc
```

示例：

```http
GET /reader-api/search?keyword=狐魅&sort=cache_desc&page=1&limit=20
GET /reader-api/search?author=作者名
GET /reader-api/search?tag=仙侠&platform=po18
GET /reader-api/search?author=作者名&tag=仙侠&platform=po18
```

返回：

```json
{
  "rows": [
    {
      "book_id": "545061",
      "title": "狐魅聖女",
      "author": "...",
      "tags": "...",
      "platform": "po18",
      "cache_count": 1033,
      "total_popularity": 631657,
      "updated_at": "2026-05-03T..."
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### 2. 书籍详情

```http
GET /reader-api/books/:bookId
```

示例：

```http
GET /reader-api/books/545061
```

返回：

```json
{
  "book": {
    "book_id": "545061",
    "title": "狐魅聖女",
    "author": "...",
    "description": "...",
    "tags": "...",
    "cover": "...",
    "cache_count": 1033
  }
}
```

### 3. 章节列表

```http
GET /reader-api/books/:bookId/chapters
```

示例：

```http
GET /reader-api/books/545061/chapters
```

返回不包含正文，适合目录页：

```json
{
  "rows": [
    {
      "book_id": "545061",
      "chapter_id": "1",
      "title": "第一章",
      "chapter_order": 1,
      "html_length": 12345,
      "updated_at": "2026-05-03T..."
    }
  ],
  "total": 1033
}
```

### 4. 章节正文

```http
GET /reader-api/books/:bookId/chapters/:chapterId
```

示例：

```http
GET /reader-api/books/545061/chapters/1
```

返回：

```json
{
  "chapter": {
    "book_id": "545061",
    "chapter_id": "1",
    "title": "第一章",
    "html": "<p>...</p>",
    "text": "从 html 派生的纯文本",
    "updated_at": "2026-05-03T..."
  }
}
```

说明：数据库长期只保存 `html`，`text` 字段保留但不存正文；接口返回时会从 `html` 即时提取 `text`。

### 5. 章节 HTML 原文

```http
GET /reader-api/books/:bookId/chapters/:chapterId/html
```

示例：

```http
GET /reader-api/books/545061/chapters/1/html
```

返回 `text/html`，适合调试正文渲染。

### 6. 书评列表

```http
GET /reader-api/books/:bookId/reviews?limit=10&page=1
```

不需要登录。阅读器详情页使用该接口展示公开书评。

返回：

```json
{
  "rows": [
    {
      "id": 1,
      "book_id": "545061",
      "content": "这本书节奏很好，角色也站得住。",
      "author_nickname": "reader",
      "author_telegram_username": "tg_name",
      "like_count": 3,
      "dislike_count": 0,
      "created_at": "2026-06-20T..."
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0,
  "page": 1
}
```

## 油猴上传兼容 API

这些接口保持 `scripts/po18.txt` 现有字段和路径不变。

### 1. 批量上传书籍元信息

```http
POST /api/metadata/batch
```

写入鉴权：

```http
X-Upload-Token: <PO18_UPLOAD_API_TOKEN>
```

也兼容：

```http
X-PO18-Upload-Token: <PO18_UPLOAD_API_TOKEN>
```

未配置 `PO18_UPLOAD_API_TOKEN` 时，写入接口返回 `503`，避免外部上传入口误暴露。

同一套写入鉴权适用于：

- `POST /api/metadata/batch`
- `POST /api/parse/chapter-content`
- `DELETE /api/chapters/:bookId`

`POST /api/parse/check-cache` 是只读缓存检查接口，不要求上传 token。

请求：

```json
{
  "books": [
    {
      "bookId": "545061",
      "title": "狐魅聖女",
      "author": "作者",
      "cover": "https://...",
      "description": "简介文本",
      "descriptionHTML": "<p>简介</p>",
      "tags": "标签1,标签2",
      "wordCount": 123456,
      "freeChapters": 10,
      "paidChapters": 20,
      "totalChapters": 30,
      "subscribedChapters": 30,
      "status": "连载中",
      "latestChapterName": "最新章节",
      "latestChapterDate": "2026-05-03",
      "totalPopularity": 1000,
      "monthlyPopularity": 100,
      "weeklyPopularity": 10,
      "dailyPopularity": 1,
      "favoritesCount": 0,
      "commentsCount": 0,
      "purchaseCount": 0,
      "readersCount": 0,
      "platform": "po18",
      "detailUrl": "https://www.po18.tw/books/545061/articles",
      "uploader": "上传者",
      "uploaderId": "上传者ID"
    }
  ]
}
```

返回：

```json
{
  "success": true,
  "stats": {
    "success": 1,
    "failed": 0,
    "errors": []
  }
}
```

说明：

- 写入 `book_metadata`。
- 冲突键为 `book_id + subscribed_chapters`。
- 字段名兼容油猴脚本，不需要改脚本。

### 2. 上传或读取章节正文

```http
POST /api/parse/chapter-content
```

上传正文请求：

```json
{
  "bookId": "545061",
  "chapterId": "6424173",
  "title": "第一章",
  "html": "<p>正文<img src=\"...\"></p>",
  "text": "正文",
  "fromUserScript": true,
  "platform": "po18",
  "uploader": "上传者",
  "uploaderId": "上传者ID"
}
```

上传返回：

```json
{
  "html": "<p>正文<img src=\"...\"></p>",
  "text": "正文",
  "title": "第一章",
  "fromCache": false,
  "uploaded": true
}
```

读取缓存请求：

```json
{
  "bookId": "545061",
  "chapterId": "6424173",
  "cacheOnly": true
}
```

读取返回：

```json
{
  "html": "<p>正文<img src=\"...\"></p>",
  "text": "从 html 派生的纯文本",
  "title": "第一章",
  "fromCache": true
}
```

说明：

- 数据库长期只保存 `html`。
- `text` 字段保留但不存正文。
- API 返回时会从 `html` 即时派生 `text`。
- 新章节写入会记录 `upload_events`，并按配置触发 Telegram 推送。

### 3. 检查章节缓存

```http
POST /api/parse/check-cache
```

按书检查缓存章节列表：

```json
{
  "bookId": "545061"
}
```

返回：

```json
{
  "cached": true,
  "chapterIds": ["6424173", "6424174"],
  "cachedChapters": ["6424173", "6424174"]
}
```

说明：

- 该接口现在只接受 `bookId`，不再支持单章检查。
- 服务端只返回该书已缓存的 `chapterId` 列表，不返回章节标题等额外字段。
- 油猴脚本会先检查本地缓存；本地不存在时，再按 `bookId` 请求本接口，把服务端返回的 `chapterId` 合并到本地缓存后再决定是否上传。
- `cachedChapters` 为兼容字段，内容与 `chapterIds` 相同。

### 4. 删除某书全部章节缓存

```http
DELETE /api/chapters/:bookId
```

示例：

```http
DELETE /api/chapters/545061
```

返回：

```json
{
  "success": true,
  "deleted": 1033
}
```

## 管理 API

管理 API 需要先登录，浏览器会使用 session cookie。

### 1. 登录

```http
POST /admin-api/auth/login
```

请求：

```json
{
  "username": "admin",
  "password": "admin123"
}
```

返回：

```json
{
  "user": {
    "id": "1",
    "username": "admin"
  }
}
```

### 2. 退出

```http
POST /admin-api/auth/logout
```

### 3. 当前登录用户

```http
GET /admin-api/auth/me
```

### 4. 首页统计

```http
GET /admin-api/stats
```

返回包含：

```text
metadata / books / cachedBooks / completeBooks / chapters
chapters7d / chapters24h / chaptersToday
metadata7d
uploaders / metadataUploaders
platformsCount / platforms
topUploaders
events / events7d / events24h
avgChaptersPerBook
uptimeSeconds / startedAt
lastChapterAt / lastMetadataAt
```

### 4.1 系统任务

```http
GET /admin-api/jobs
GET /admin-api/jobs/:id
POST /admin-api/jobs/:id/retry
POST /admin-api/jobs/:id/cancel
```

说明：

- 需要后台管理员 session。
- `/admin-api/jobs` 支持 `status`、`type`、`page`、`limit` 查询参数。
- 备份、上传 dump、恢复数据库、榜单刷新、Bot 长任务、陈旧 PO18 批量清理和章节顺序修复会写入 `system_jobs`，用于排查耗时任务、失败原因和结果文件。
- `POST /admin-api/jobs/:id/retry` 仅允许重试 `failed` / `canceled` 任务；当前支持 `backup:*`、`rank_refresh`、`chapters_repair_order`，以及需要确认短语的 `restore:postgres`、`books_cleanup_stale`。
- `POST /admin-api/jobs/:id/cancel` 仅允许取消仍处于 `queued` 的任务；已经 `running` 的任务不会强杀，避免导出、恢复、上传等任务留下半完成状态。
- 恢复/清理等破坏性任务重试请求体需携带确认短语：

```json
{
  "confirm": "RETRY 123"
}
```

任务状态：

```text
queued / running / succeeded / failed / canceled
```

### 4.2 系统状态、诊断、日志和重启

```http
GET  /admin-api/system/status
GET  /admin-api/system/diagnostics
GET  /admin-api/system/overview
GET  /admin-api/system/logs?filter=all|error|database|bot|reader|server|setup
POST /admin-api/system/restart
```

说明：

- `status` 返回 setup 地址、版本、deep health 和当前服务检查。
- `diagnostics` 返回脱敏诊断信息，适合复制给维护者排障。
- `overview` 返回系统页聚合数据：schema、迁移、任务中心、最近错误、慢请求、配置安全状态等。
- `logs` 读取 `/config/runtime.log` 最近日志并按类型过滤。
- `restart` 会延迟退出当前进程，依赖 Docker restart policy 拉起服务。

### 4.3 数据质量与榜单

```http
GET  /admin-api/data-quality
GET  /admin-api/rank/status
POST /admin-api/rank/refresh
```

说明：

- `data-quality` 返回重复书籍、缺章节、章节顺序重复、无封面、无简介、平台异常、长期未更新和大体积章节样例。
- `rank/status` 返回动态榜单缓存状态。
- `rank/refresh` 手动刷新榜单，并写入 `system_jobs`。

### 5. 管理书籍列表

```http
GET /admin-api/books
GET /admin-api/books/cleanup-stale/preview
POST /admin-api/books/cleanup-stale
GET /admin-api/books/:bookId/export.txt
```

参数同阅读搜索的常用参数：

```text
q / tag / platform / sort / page / limit
```

返回带 `cache_count`，用于后台排序和展示。`sort` 支持 `complete_desc / complete_asc`，按 `cache_count / 总章节数` 排序。

`cleanup-stale` 用于清理长期未更新且章节数很少的 PO18 陈旧书籍，正式执行需要：

```json
{
  "confirm": true
}
```

执行会写入 `books_cleanup_stale` 任务，失败后可在任务中心重试。

### 6. 管理章节列表

```http
GET /admin-api/books/:bookId/chapters
DELETE /admin-api/books/:bookId/chapters
POST /admin-api/chapters
GET /admin-api/chapters/repair-order/preview
POST /admin-api/chapters/repair-order
```

`POST /admin-api/chapters/repair-order` 需要：

```json
{
  "confirm": true,
  "limit": 50
}
```

说明：该接口会把重复 `chapter_order` 的书按当前章节显示顺序重新编号，并写入任务中心。

### 7. 更新记录

```http
GET /admin-api/events?limit=80
```

### 8. Telegram 配置

```http
GET  /admin-api/config/telegram
PUT  /admin-api/config/telegram
POST /admin-api/config/telegram/test
```

保存请求：

```json
{
  "enabled": true,
  "botToken": "123456:ABC",
  "chatId": "-1001234567890"
}
```

说明：

- 只有新章节插入/更新事件会尝试推送。
- Bot Token 和 Chat ID 存在 PostgreSQL 的 `admin_config`。

### 9. 备份接口

```http
POST /admin-api/backup
GET  /admin-api/backup/download
```

说明：

- `POST /admin-api/backup` 支持 `type=postgres|config|diagnostics`。
- PostgreSQL 备份会调用容器内 `pg_dump`，备份文件写入 `/config/backups`。
- 备份、上传 dump、恢复数据库会记录到 `system_jobs`。
- 恢复仍同步执行 `pg_restore`；成功后默认重启容器。

## 管理 API 速览

```http
POST /admin-api/auth/login
POST /admin-api/auth/logout
GET  /admin-api/auth/me
GET  /admin-api/stats
GET  /admin-api/system/status
GET  /admin-api/system/diagnostics
GET  /admin-api/system/overview
GET  /admin-api/system/logs
POST /admin-api/system/restart
GET  /admin-api/jobs
GET  /admin-api/jobs/:id
POST /admin-api/jobs/:id/retry
POST /admin-api/jobs/:id/cancel
GET  /admin-api/data-quality
GET  /admin-api/rank/status
POST /admin-api/rank/refresh
GET  /admin-api/bot/overview
GET  /admin-api/bot/audit
GET  /admin-api/books
GET  /admin-api/books/cleanup-stale/preview
POST /admin-api/books/cleanup-stale
POST /admin-api/books
PUT  /admin-api/books/:id
DELETE /admin-api/books/:id?deleteChapters=0|1
GET  /admin-api/books/:bookId/export.txt
GET  /admin-api/books/:bookId/chapters
DELETE /admin-api/books/:bookId/chapters
POST /admin-api/chapters
GET  /admin-api/chapters/repair-order/preview
POST /admin-api/chapters/repair-order
PUT  /admin-api/chapters/:id
DELETE /admin-api/chapters/:id
GET  /admin-api/events
GET  /admin-api/config/telegram
PUT  /admin-api/config/telegram
POST /admin-api/config/telegram/test
POST /admin-api/config/telegram/daily-report/test
GET  /admin-api/config/platforms
PUT  /admin-api/config/platforms
GET  /admin-api/config/export
PUT  /admin-api/config/export
POST /admin-api/backup
GET  /admin-api/backup/list
POST /admin-api/backup/upload
POST /admin-api/backup/restore
GET  /admin-api/backup/download
GET  /admin-api/backup/config
GET  /admin-api/backup/diagnostics
```

## PowerShell 测试

```powershell
Invoke-RestMethod "http://localhost:3100/reader-api/search?keyword=狐魅&sort=cache_desc"
Invoke-RestMethod "http://localhost:3100/reader-api/books/545061"
Invoke-RestMethod "http://localhost:3100/reader-api/books/545061/chapters"
Invoke-RestMethod "http://localhost:3100/reader-api/books/545061/chapters/1"
Invoke-RestMethod "http://localhost:3100/reader-api/books/545061/chapters?includeContent=1"
```

## API Change Log

### 2026-05-03

`GET /reader-api/books/:bookId/chapters` 增加可选查询参数：

| Param | Type | Default | Description |
|------|------|---------|-------------|
| `includeContent` | `0/1` or `true/false` | `0` | 设置为 `1` 时，章节列表会同时返回 `html` 和由 HTML 派生出的 `text`。适合 Telegram Bot 或整本导出；阅读器目录页建议不传，保持轻量。 |

示例：

```http
GET /reader-api/books/545061/chapters?includeContent=1
```

新增返回字段：

```json
{
  "rows": [
    {
      "book_id": "545061",
      "chapter_id": "1",
      "title": "第一章",
      "chapter_order": 1,
      "html_length": 12345,
      "html": "<p>...</p>",
      "text": "从 html 即时提取的纯文本",
      "updated_at": "2026-05-03T..."
    }
  ],
  "total": 1033
}
```

### 2026-06-05

新增/补充：

- `GET /health/live`、`GET /health/ready`、`GET /health/status`、`GET /health/version`、`GET /health/deep`。
- `GET /metrics`，支持 `Authorization: Bearer <PO18_METRICS_TOKEN>` 或 `?token=`。
- `GET /admin-api/system/status`、`diagnostics`、`overview`、`logs`、`POST /admin-api/system/restart`。
- `GET /admin-api/jobs`、`GET /admin-api/jobs/:id`、`POST /admin-api/jobs/:id/retry`、`POST /admin-api/jobs/:id/cancel`。
- `GET /admin-api/data-quality`。
- `GET /admin-api/rank/status`、`POST /admin-api/rank/refresh`。
- `GET /admin-api/bot/overview`、`GET /admin-api/bot/audit`、`GET /admin-api/search-requests`。
- `POST /bot-api/jobs`、`GET /bot-api/jobs/:id`、`PATCH /bot-api/jobs/:id`、`POST /bot-api/audit`、`POST /bot-api/search-requests`。
- `GET /bot-api/books/:bookId/reviews`、`POST /bot-api/books/:bookId/reviews`、`POST /bot-api/book-reviews/:reviewId/vote`。
- `GET /admin-api/books/cleanup-stale/preview`、`POST /admin-api/books/cleanup-stale`。
- `GET /admin-api/chapters/repair-order/preview`、`POST /admin-api/chapters/repair-order`。
- `POST /admin-api/backup/upload`、`POST /admin-api/backup/restore`、`GET /admin-api/backup/config`、`GET /admin-api/backup/diagnostics`。

鉴权变化：

- 上传/写入 API 需要后台管理员 session，或 `X-Upload-Token` / `X-PO18-Upload-Token`。
- 未配置 `PO18_UPLOAD_API_TOKEN` 时，外部写入接口返回 `503`。
- `/bot-api/*` 需要 `X-Bot-Token: <PO18_BOT_API_TOKEN>`；未配置 `PO18_BOT_API_TOKEN` 时返回 `503`。

## 运维增强 API

本节接口鉴权方式不同：

- `/admin-api/*` 需要后台管理员 session。
- `/bot-api/*` 需要 `X-Bot-Token: <PO18_BOT_API_TOKEN>`。
- `/health/*` 不需要登录，按检查结果返回 `200` 或 `503`。
- `/metrics` 可公开访问；如果设置 `PO18_METRICS_TOKEN`，则需要 Bearer token 或 `?token=`。

### 上传 PostgreSQL dump

```http
POST /admin-api/backup/upload
Content-Type: application/octet-stream
X-Backup-File: po18-pg-upload.dump
```

返回备份文件名和最新备份列表。上传大小由 `PO18_BACKUP_UPLOAD_MAX_BYTES` 控制。

### 恢复 PostgreSQL dump

```http
POST /admin-api/backup/restore
Content-Type: application/json
```

请求：

```json
{
  "file": "po18-pg-20260604-120000.dump",
  "confirm": "RESTORE po18-pg-20260604-120000.dump"
}
```

恢复前会自动生成当前数据库备份；恢复成功后默认重启服务。

### 数据质量

```http
GET /admin-api/data-quality
```

返回重复书籍、缺章节、章节顺序重复、无封面、无简介、平台异常、长期未更新和大体积章节样例。

### Bot 运行概览

```http
GET /admin-api/bot/overview
GET /admin-api/bot/audit?limit=50&status=failed&command=/search&telegram_id=123
```

返回 Bot 在线状态、后台任务队列、限流、Telegram API 延迟、近 7 日流水/导出、失败原因、审计命令 Top 和最近任务日志。

`/admin-api/bot/audit` 需要后台管理员 session，查询 `bot_audit_logs`，支持：

| 参数 | 说明 |
| --- | --- |
| `limit` | 返回条数，最大 200 |
| `status` | `succeeded` / `failed` / `queued` / `ignored` |
| `command` | 命令名，例如 `/search`、`/exporttxt` |
| `telegram_id` | Telegram 用户 ID |

### Bot 内部任务上报

```http
POST /bot-api/jobs
X-Bot-Token: <PO18_BOT_API_TOKEN>
Content-Type: application/json
```

请求：

```json
{
  "type": "bot_export_txt",
  "created_by": "telegram_bot",
  "input": {
    "telegram_id": "123456",
    "book_id": "545061",
    "format": "txt"
  }
}
```

返回 `system_jobs` 任务对象。Bot 创建导出、PO18 书架同步、共享上传等长任务后，用该接口登记任务。

```http
GET /bot-api/jobs/:id
X-Bot-Token: <PO18_BOT_API_TOKEN>
```

返回单个 `system_jobs` 任务对象，用于 Bot 在任务启动前检查是否已被后台取消，也可用于排障。

```http
PATCH /bot-api/jobs/:id
X-Bot-Token: <PO18_BOT_API_TOKEN>
Content-Type: application/json
```

请求：

```json
{
  "status": "running",
  "progress": 50,
  "result": { "message": "half done" },
  "error": "",
  "started": true,
  "finished": false
}
```

状态允许：`queued`、`running`、`succeeded`、`failed`、`canceled`。`progress` 会限制到 `0-100`，`result` 超过限制时会被压缩成摘要。

### Bot 内部审计写入

```http
POST /bot-api/audit
X-Bot-Token: <PO18_BOT_API_TOKEN>
Content-Type: application/json
```

请求：

```json
{
  "telegram_id": "123456",
  "telegram_username": "reader",
  "chat_id": "-100123",
  "chat_type": "supergroup",
  "command": "/exporttxt",
  "action": "export_txt",
  "status": "failed",
  "error_code": "EXPORT_NO_CONTENT",
  "error": "本地没有正文缓存",
  "duration_ms": 1200,
  "details": { "book_id": "545061", "format": "txt" }
}
```

说明：

- 该接口只给 Telegram Bot 内部使用，受 `PO18_BOT_API_TOKEN` 保护。
- 审计表由 `db/migrations/007_bot_audit_logs.sql` 创建，启动迁移会自动执行。

### Bot 搜索无结果需求提交

```http
POST /bot-api/search-requests
X-Bot-Token: <PO18_BOT_API_TOKEN>
Content-Type: application/json
```

请求：

```json
{
  "telegram_id": "123456",
  "telegram_username": "reader",
  "nickname": "Reader",
  "query": "搜索原文",
  "clean_query": "搜索词",
  "type": "search",
  "platform": "po18",
  "result_count": 0,
  "source": "bot_search_no_result"
}
```

说明：

- Bot 搜索无结果时，用户点击“提交缺书需求”会调用该接口。
- 同一用户、同一搜索词、同一平台和类型只保留一条，重复提交会更新 `updated_at` 并返回 `already_exists: true`。
- 后台反馈统计页通过 `GET /admin-api/search-requests?limit=120` 展示聚合后的缺书需求列表。

### Bot 书评发布与投票

```http
GET  /bot-api/books/:bookId/reviews?telegram_id=123456&limit=5
POST /bot-api/books/:bookId/reviews
POST /bot-api/book-reviews/:reviewId/vote
X-Bot-Token: <PO18_BOT_API_TOKEN>
Content-Type: application/json
```

发布请求：

```json
{
  "telegram_id": "123456",
  "content": "这本书节奏很好，角色也站得住。"
}
```

投票请求：

```json
{
  "telegram_id": "234567",
  "vote": "like"
}
```

规则：

- 发布书评需要 Lv.2 及以上，默认消耗 `100` 铜。
- 发布成功后会尝试推送到后台 Telegram 配置中的 `telegram_chat_id`。
- 频道按钮投票：`like` 给书评作者 `+100` 铜，`dislike` 给书评作者 `-1` 铜。
- 同一用户对同一书评只能保留一个态度；重复点击不重复结算，改投只结算净变化。

### 健康检查

```http
GET /health/live
GET /health/ready
GET /health/status
GET /health/version
GET /health/deep
```

说明：

- `live` 只检查进程存活。
- `ready` / `status` 检查数据库、schema 和连接池状态。
- `version` 返回服务名、镜像 tag、Node 版本和平台信息。
- `deep` 检查数据库、schema、磁盘写入、reader、bot、Telegram API、`upload-api-token` 和 `bot-api-token`。其中 token、Bot、Telegram API 属于 optional/skipped 检查，不影响 required health。
- setup-only 初始化面板也暴露 `GET /health/live`、`GET /health/ready`、`GET /health/version`，用于无数据库配置时的 Docker/冒烟检查；这些健康接口不需要 setup token。

### Prometheus 指标

```http
GET /metrics
```

如果设置 `PO18_METRICS_TOKEN`，请求需带：

```http
Authorization: Bearer <PO18_METRICS_TOKEN>
```

也支持：

```http
GET /metrics?token=<PO18_METRICS_TOKEN>
```

新增阅读器性能预算相关指标：

```text
po18_reader_endpoint_p95_ms{endpoint="search|detail|catalog|chapter"}
po18_reader_endpoint_budget_ms{endpoint="search|detail|catalog|chapter"}
```

默认预算可通过环境变量覆盖：

```text
PO18_SEARCH_P95_MS
PO18_DETAIL_P95_MS
PO18_CATALOG_P95_MS
PO18_CHAPTER_P95_MS
PO18_READER_ENTRY_JS_BYTES
PO18_READER_ENTRY_CSS_BYTES
```

### 后台 Bot 命令管理

```http
GET /admin-api/bot/commands
PUT /admin-api/bot/commands
GET /bot-api/commands
```

- 后台接口需要管理员 session。
- `PUT /admin-api/bot/commands` 请求体：

```json
{
  "commands": [
    {
      "command": "/search",
      "enabled": true,
      "description": "搜索书籍",
      "disabledMessage": "该命令暂时关闭"
    }
  ]
}
```

- Bot 运行时读取同一份配置，禁用命令不再执行。

### 后台指标摘要

```http
GET /admin-api/metrics/summary
```

返回 HTTP 请求、错误、阅读器 API、Bot 队列、数据库连接池、备份事件和 Top 路径摘要。后台系统页直接读取该接口。

阅读器性能相关字段：

```text
reader_api.p95_duration_ms
reader_performance.endpoints[].p95_ms / budget_ms / ok
reader_performance.breached
reader_assets.checks[].value / budget / ok
reader_assets.largest[]
```

### 筛选导出 CSV

```http
GET /admin-api/books/export.csv?q=&tag=&platform=&sort=
GET /admin-api/users/export.csv?q=&telegram_id=&membership=&status=
GET /admin-api/transactions/export.csv?telegram_id=&type=&currency=&limit=10000
```

- 以上接口需要管理员 session。
- 后台书籍、用户、流水页面已提供按当前筛选条件导出入口。

### 远程备份

```http
GET /admin-api/backup/remote/status
POST /admin-api/backup/remote/upload
Content-Type: application/json
```

请求体：

```json
{ "file": "po18-pg-20260606.dump" }
```

支持环境变量：

- `PO18_REMOTE_BACKUP_PROVIDER=webdav|s3|r2`
- WebDAV：`PO18_REMOTE_BACKUP_WEBDAV_URL`、`PO18_REMOTE_BACKUP_WEBDAV_USERNAME`、`PO18_REMOTE_BACKUP_WEBDAV_PASSWORD`
- S3/R2：`PO18_REMOTE_BACKUP_S3_ENDPOINT`、`PO18_REMOTE_BACKUP_S3_BUCKET`、`PO18_REMOTE_BACKUP_S3_REGION`、`PO18_REMOTE_BACKUP_S3_ACCESS_KEY`、`PO18_REMOTE_BACKUP_S3_SECRET_KEY`、`PO18_REMOTE_BACKUP_S3_PREFIX`

状态接口只返回配置是否存在、bucket/prefix 等非敏感信息，不返回密码或 secret。

### 阅读器搜索建议

```http
GET /reader-api/search/suggest?q=&platform=&limit=10
```

返回 `title`、`author`、`tag`、`hot` 类型建议。阅读器搜索弹窗会显示建议 chips：

- `title` 建议可直接进入详情页。
- `author` 建议进入 `/library?author=...`，如果建议带 `platform` 或当前选择了站点，会同时带上 `platform`。
- `tag` 建议进入 `/library?tag=...`，如果建议带 `platform` 或当前选择了站点，会同时带上 `platform`。
- `hot` 建议作为普通关键词搜索。

阅读器搜索框支持快捷输入：

```text
作者:作者名
author:作者名
a:作者名
标签:标签名
tag:标签名
t:标签名
#标签名
```

作者/标签快捷搜索会进入书库筛选页；普通关键词仍在搜索弹窗内返回结果。

### 4.4 PO18 自动遍历 / 定时补缓存

```http
GET  /admin-api/po18-crawler
PUT  /admin-api/po18-crawler/config
POST /admin-api/po18-crawler/run
POST /admin-api/po18-crawler/pause
POST /admin-api/po18-crawler/resume
POST /admin-api/po18-crawler/stop
POST /admin-api/po18-crawler/test-cookie
```

说明：
- 需要后台管理员 session。
- 配置存储在 `admin_config.po18_crawler_config`；状态接口不会返回明文 Cookie，只返回 `cookieConfigured`、`cookieLength`、`cookieProfileCount` 和脱敏 `cookieProfiles`。
- `sourceMode` 支持 `discover`、`bookshelf`、`cache`、`subscription`。
- `discover` 按 PO18 发现页分页遍历；`bookshelf` 按已购书架遍历；`cache` 从已有 PO18 缓存 book_id 反推更新；`subscription` 按 `subscriptionBookIds` 手动订阅列表更新。
- 运行任务类型为 `po18_crawler_run`，会写入 `system_jobs`，可在任务中心查看进度和结果，也支持失败/取消后重试。
- `skipCached=true` 时已有缓存章节会跳过；`overwrite=true` 时会重抓覆盖。
- PO18 章节顺序按网站目录显示编号保存，`1,2,4` 会保持 `1,2,4`，不会补排成 `1,2,3`。
- Cookie 失效或返回登录/验证页时，运行中的任务会暂停，等待后台更新 Cookie 后继续。

配置示例：
```json
{
  "enabled": true,
  "sourceMode": "subscription",
  "subscriptionBookIds": ["844058", "868156"],
  "startPage": 1,
  "endPage": 20,
  "maxBooksPerRun": 200,
  "cacheIdLimit": 500,
  "bookshelfStartYear": 2010,
  "bookshelfEmptyYearStop": 3,
  "sort": "time",
  "status": "all",
  "words": "all",
  "bookConcurrency": 1,
  "chapterConcurrency": 3,
  "delayMs": 800,
  "requestIntervalMs": 250,
  "timeoutMs": 20000,
  "uploadMetadata": true,
  "uploadChapters": true,
  "skipCached": true,
  "overwrite": false,
  "intervalMinutes": 360,
  "activeCookieProfile": "default",
  "cookieName": "default",
  "cookie": "po18_login_cookie_here"
}
```
