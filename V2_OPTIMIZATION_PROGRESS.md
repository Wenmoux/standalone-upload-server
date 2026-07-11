# PO18 Reader v2.0 优化进度

更新时间：2026-07-11

## 本轮边界

- [x] Docker 默认标签调整为 `wenmoux/reader:v2.0`。
- [x] 开始修改前备份当前完整源码和 Git 历史。
- [x] 暂不迁移或调整书籍唯一键。
- [x] 不删除、不重命名、不改变现有 API 请求/响应字段。
- [x] 保留工作区开始前已有的未提交业务修改。

## 修改前备份

- 归档：仓库外本地备份已完成
- 清单：对应 SHA-256 清单已生成
- 条目：1386
- SHA-256：`A7DFB473656F7C78E8EFCA05D5C10787610F30E2330D93BE3EAC38C2624A810F`
- 包含：当前源码、未提交修改、未跟踪报告和 `.git` 历史。
- 排除：可重建的 `node_modules`、`test-results`、`tmp` 及项目内旧备份目录。

## 已完成

### 1. 浏览器凭据保护

- [x] Reader 登录页“记住密码”改为“记住账号”。
- [x] 不再向 `localStorage` 写入密码。
- [x] 读取到旧 `loginInfo.passwd` 时自动重写，只留下用户名。
- [x] 损坏的旧登录信息会自动清除。

### 2. 依赖漏洞修复

- [x] DOMPurify 升级到 `^3.4.11`。
- [x] Axios 升级到 `^1.18.1`。
- [x] `form-data` 锁定到已修复的 `4.0.6`。
- [x] 根项目、Admin、Reader 的生产依赖审计均为 0 漏洞。

### 3. TTS 代理安全

- [x] 拦截 localhost、内网、链路本地、CGNAT、保留地址和云元数据地址。
- [x] 域名解析出的全部地址都执行校验。
- [x] 支持 `PO18_TTS_PROXY_ALLOWED_HOSTS` 域名白名单和 `*.example.com` 通配规则。
- [x] 禁止 URL 内嵌账号密码。
- [x] 禁止自动重定向，避免跳转绕过目标校验。
- [x] 响应体默认限制为 10 MiB，最大可配置到 50 MiB。
- [x] 原有 TTS API 字段保持不变。

### 4. 登录与高成本接口限流

- [x] Admin/Reader 登录、注册和 TG 登录增加独立限流。
- [x] 公开 check-cache 增加限流。
- [x] Reader TTS 增加限流。
- [x] 章节上传和元信息批量上传增加较宽松的独立限流。
- [x] 返回标准 `429` 和 `Retry-After`，原请求字段不变。

### 5. 会话与跨域

- [x] 生产环境 CORS 默认不再反射任意 Origin。
- [x] 使用 `PO18_CORS_ORIGINS` 配置明确白名单。
- [x] 增加 `PO18_TRUST_PROXY`，支持反向代理下识别 HTTPS 和客户端地址。
- [x] Session Cookie 在生产环境使用 HTTPS 自动安全模式。
- [x] Session 从默认 MemoryStore 改为 PostgreSQL 持久存储，避免重启丢失和内存泄漏警告。
- [x] 生产环境拒绝默认管理员密码、默认 Session Secret 和关闭 Setup 鉴权的配置。

### 6. Setup Token

- [x] `?token=` 验证成功后立即交换为 HttpOnly Cookie。
- [x] 自动 302 到不含 Token 的 URL，减少浏览器历史、Referer 和代理日志泄露。
- [x] 后续面板链接和导入成功跳转不再携带 Token。
- [x] 可用 `PO18_SETUP_COOKIE_SECURE=1` 强制 Setup Cookie 仅通过 HTTPS 发送。

### 7. v2.0 发布身份

- [x] 根包版本更新到 `2.0.0`。
- [x] Dockerfile、构建/推送/发布脚本、Compose、README 和后台回退显示统一为 `wenmoux/reader:v2.0`。
- [x] Docker 构建计算当前源码 SHA-256 内容指纹。
- [x] 工作区非干净时，构建 revision 自动加入 `.dirty.<hash8>`。
- [x] PowerShell 和 Shell 发布脚本统一调用同一个构建/推送入口。
- [x] 后台静态资源已重新构建，版本回退文本为 v2.0。

### 8. 其它修复

- [x] 修复后台登录失败提示的真实乱码字符串。
- [x] 修复空数据库首次启动在 `book_stats` 建表前创建索引导致初始化循环失败的问题。
- [x] 增加网络安全、HTTP 安全、限流、Setup Token 和 TTS 路由回归测试。

### 9. 章节统计写入性能

- [x] 新增迁移 `011_chapter_stats_incremental`，不修改已发布迁移。
- [x] 移除章节表逐行调用 `refresh_book_stats` 的触发器。
- [x] INSERT 按 SQL 语句聚合后原子增加缓存数。
- [x] 普通 UPDATE 只更新时间和平台，不再重复扫描整本书。
- [x] 跨书移动时只对受影响书籍执行一次精确重算。
- [x] 批量 DELETE 按书聚合扣减，并重算一次最后章节时间。
- [x] 支持 TRUNCATE 后统计归零和孤立统计清理。
- [x] 提供完整 rollback，可恢复原逐行触发器。
- [x] 未修改章节、书籍唯一键或 API 字段。

### 10. Setup 鉴权限流

- [x] Setup Token 失败尝试使用独立窗口计数，不与 Reader/Admin 登录额度混用。
- [x] 默认同一来源 15 分钟最多失败 20 次，可通过环境变量调整。
- [x] 超限返回 `429`、`Retry-After` 和 RateLimit 响应头。
- [x] 有效 Token 验证成功后清除该来源的失败计数。
- [x] Setup 页面、表单和配置字段保持不变。

### 11. 远端备份内存与完整性

- [x] WebDAV PUT 改为磁盘 ReadStream，不再把整个 dump 读入内存。
- [x] S3/R2 先流式计算 SHA-256，再从磁盘流式 PUT，内存占用不再随备份大小增长。
- [x] WebDAV 使用 `X-PO18-Backup-SHA256` 记录校验值。
- [x] S3/R2 使用已签名的 `x-amz-content-sha256` 和 `x-amz-meta-sha256` 保存校验值。
- [x] 同时发送 Content-Length，上传结果仍保持原有 `provider/url/bytes` 字段。
- [x] 增加 WebDAV 和 S3/R2 真实流对象回归测试。

### 12. Reader 图标资源瘦身

- [x] 扫描 Reader 源码，只保留实际使用的 33 个 Remixicon 字形。
- [x] 生成 2.6 KiB WOFF2 子集和 2.1 KiB CSS 映射。
- [x] 公共 CSS 从 103.15 KiB 降到 16.33 KiB。
- [x] 构建产物不再包含 1.20 MiB SVG、403 KiB TTF/EOT、173 KiB WOFF 和 125 KiB 全量 WOFF2。
- [x] Remixicon 从运行依赖移到生成工具所需的开发依赖。
- [x] 增加自动完整性/体积预算测试，新增图标未重建子集时测试会失败。
- [x] Playwright 验证登录页和 33/33 图标，未发现空图标、页面错误或布局回归。

### 13. 写请求保护与后台操作审计

- [x] Session 写请求增加 Origin/Referer/Sec-Fetch-Site 校验，拒绝跨站来源。
- [x] Reader 3200 端口、后台同源和显式 CORS/Reader 公网地址均可作为可信来源。
- [x] 不携带 Session Cookie 的 Upload/Bot Token 客户端保持兼容，不增加 API 请求字段。
- [x] 可用 `PO18_CSRF_ALLOW_MISSING_ORIGIN=1` 兼容无法发送来源头的旧 Session 客户端，默认关闭。
- [x] 新增 `012_admin_audit_logs`，记录后台写操作的账号、动作、状态、请求 ID、来源 IP 和脱敏摘要。
- [x] 审计写入在原响应完成后异步执行，不阻塞也不改变原接口响应。
- [x] 密码、Token、Cookie、数据库连接和配置类字段不会写入审计详情。
- [x] 审计表通过 PostgreSQL 触发器禁止 UPDATE/DELETE，并提供对应 rollback。
- [x] 唯一键和现有 API 请求/响应字段保持不变。

### 14. 后台审计、防误触与 RBAC

- [x] 新增后台审计日志查看页和筛选分页接口。
- [x] 全部后台 `window.confirm` 收敛到统一确认组件；删除、恢复、重启、Token 吊销等高风险操作支持原因和确认短语。
- [x] 通用表单弹窗增加脏表单关闭保护。
- [x] 新增 `015_admin_roles`，支持 `owner / operator / moderator / viewer`。
- [x] 最后一个 owner 不能删除或降级，当前管理员不能删除自己。
- [x] 旧登录和 `/admin-api/auth/me` 响应仍只返回原有 `id / username`；角色通过新接口读取。

### 15. 持久任务、凭据与 Token

- [x] 新增 `013_system_job_leases`：优先级、最大尝试次数、幂等键、租约、心跳、取消和重启恢复。
- [x] Bot 导出、PO18 书架同步、单书共享和整书架共享在进入内存队列前先持久化。
- [x] 临时失败使用指数退避重试；运行任务可由后台请求取消。
- [x] PO18 密码、用户 Cookie、爬虫 Cookie profile 使用 AES-256-GCM；支持密钥轮换和旧明文迁移。
- [x] 新增 `014_api_tokens`，数据库只保存 Token SHA-256，支持 Scope、来源 IP、吊销和最近使用审计。
- [x] Bot 默认 Scope 不包含 `bot:admin`，高权限命令必须显式授权。

### 16. Reader 目录与资源性能

- [x] Ant Design Vue 组件按页面异步加载，移除未使用全局组件。
- [x] Reader 主入口约 182 KiB、gzip 67 KiB；简繁转换仍作为用户启用时才加载的独立大词典 chunk。
- [x] 详情页目录和阅读页目录使用共享虚拟列表，数千章只创建视口附近 DOM。
- [x] 提取共享主题模块和话本正文解析模块，减少详情/书库/Reader 重复逻辑。

### 17. 来源健康、进程监管与备份恢复

- [x] PO18 临时网络错误、429 和 5xx 连续失败后打开熔断，冷却后半开探测；404/Cookie 失效不误触发。
- [x] Prometheus 和后台指标增加爬虫成功/失败/重试/熔断，以及持久任务租约、重试耗尽和取消请求。
- [x] 单镜像子进程独立重启，带指数退避、稳定窗口、重启上限、SIGTERM 和超时 SIGKILL。
- [x] 新备份写入 SHA-256，并自动执行 `pg_restore --list`；上传和恢复前均验证。
- [x] 真实 PG 测试把 dump 恢复到临时数据库并检查 Schema，再自动删除临时库。
- [x] 镜像固定 `postgresql16-client`，与默认 PostgreSQL 16 部署保持可恢复兼容。
- [x] 提供非 root + read-only root filesystem 的可选部署方式，不改变旧部署默认用户。

### 18. 第一轮大文件拆分

- [x] Reader 提取主题、正文解析、Session、设置、TTS 和虚拟列表模块。
- [x] Bot 提取 PO18 账号登录/验证码/书架 handler，并保持命令行为不变。
- [x] PO18 Crawler 提取 Cookie profile 与来源健康模块。
- [x] Reader 校对与 TTS 编排拆为独立 mixin，保留原数据字段、模板绑定和请求结构；`Reader.vue` 从 2827 行降到 2350 行。
- [x] Bot 单书/书架共享、缓存跳过和奖励判断拆为独立工厂；`telegram-bot.js` 从 1590 行降到 1213 行。
- [x] PO18 DOM、目录、正文、登录页识别和请求 URL/Form 构造拆为独立解析模块；`po18-crawler.js` 从 1736 行降到 1266 行。
- [x] 本轮只调整内部模块边界，UI、Bot 命令、书籍唯一键和现有 API 字段均未改变。

### 19. Admin 路由与保存视图

- [x] Admin 接入 Vue Router，提供 `/admin/overview`、`/admin/books`、`/admin/jobs`、`/admin/system` 等可刷新深链接。
- [x] 服务端为 `/admin/*` 增加 SPA 回退，Setup、排行榜和现有 API 路由保持独立。
- [x] 后台视图改为路由级懒加载，主入口 JS gzip 从约 74 KiB 降到 45.56 KiB。
- [x] 侧栏增加保存视图，可保存当前路径与 Query 筛选，最多保留 8 个并支持快速移除。
- [x] RBAC 继续限制不可访问路由，直接输入无权限地址会回到该角色首个可用页面。

### 20. 缺书闭环与 Bot 任务入口

- [x] 新增 `016_search_request_workflow`，缺书请求支持待处理、已接受、抓取中、已缓存和已驳回状态。
- [x] 后台反馈页可直接处理缺书需求；标记已缓存时填写书号和说明，并可通知此前提交过该需求的 Telegram 用户。
- [x] 通知按 Telegram ID 去重，已通知记录不会重复发送，并提供阅读器详情跳转按钮。
- [x] Bot 新增 `/tasks`、`/task 任务号`、`/canceljob 任务号`，只允许查看和取消当前 Telegram 用户自己的任务。
- [x] Bot 任务卡片显示类型、状态、进度、尝试次数、错误和下次重试时间，不改变原导出/共享命令。

### 21. RUM 与统一迁移基线

- [x] Reader 采集页面加载、TTFB、FCP、LCP、CLS、INP、路由切换和长任务，不记录正文、搜索词或密码。
- [x] 系统页展示浏览器 Web Vitals 与路由 p95，Reader 主入口 gzip 继续低于 150 KiB 预算。
- [x] 原 `initPg()` 内嵌 DDL 收敛到 `001_baseline.sql`，空库与升级库执行同一迁移链。
- [x] `schema_migrations` 记录应用版本和 checksum；已应用迁移发生漂移时默认拒绝启动。

### 22. 第二轮大文件拆分

- [x] Bot 搜索、词云、详情、缺书提交拆到 `bot/search-handlers.js`，书评、反馈、众筹拆到 `bot/social-handlers.js`。
- [x] `telegram-bot.js` 从 1233 行降到 1018 行，并新增分页、缺书提交和书评参数测试。
- [x] PO18 HTTP 限速、Cookie 合并、重试、超时和来源熔断拆到 `services/po18-crawler-http.js`；主文件从 1266 行降到 1177 行。
- [x] Reader 章节导航、卷标跳过、阅读时长和历史同步拆到 `reader-navigation` mixin；`Reader.vue` 从 2350 行降到 2234 行。

### 23. API、质量约束与开发工具

- [x] 新增 `/openapi.json` 和 `/api-docs`，端点索引从 Express 路由栈生成，避免手写清单漂移。
- [x] 所有 JSON 错误响应在保留原 `error` 字段的同时补充 `code` 和 `request_id`。
- [x] 新增 `018_data_quality_guards`，使用 `NOT VALID` 约束保护新写入，不触碰 `book_key`，也不阻断历史库升级。
- [x] 增加 ESLint、Prettier、`.editorconfig`、c8 覆盖率门槛和 Dependabot；CI 执行 lint、格式检查和覆盖率测试。
- [x] 增加 BookIdentity、Chapter、Job、AuthScope、CrawlerResult 的 JSDoc 领域契约。

### 24. 远端备份加密

- [x] WebDAV/S3 上传保持流式传输；配置 `PO18_BACKUP_ENCRYPTION_KEY` 后，离开容器前使用 AES-256-GCM 加密。
- [x] 远端密文使用 `.enc` 后缀，密钥只来自环境，不写数据库、备份元数据或诊断信息。
- [x] 加密支持往返验证和错误密钥认证失败测试。
- [x] WebDAV/S3 维护远端索引并默认保留最新 8 份；清理失败会记录错误，但不会把已成功上传的备份误报为失败。

## 当前验证

- [x] `npm run test:coverage`：237 通过、1 个 PostgreSQL 集成入口因默认未配置 `PO18_TEST_PG_URL` 跳过、0 失败。
- [x] c8 覆盖率：语句/行 68.27%，分支 49.42%，函数 73.39%，均高于当前 CI 基线。
- [x] Admin 构建：通过，主入口 JS gzip 45.56 KiB，其余视图按路由异步加载。
- [x] Reader 构建：通过；主入口 JS gzip 68.31 KiB，公共 CSS 16.33 KiB；简繁转换词典为按需独立 chunk。
- [x] 根项目生产依赖审计：0 漏洞。
- [x] Admin 生产依赖审计：0 漏洞。
- [x] Reader 生产依赖审计：0 漏洞。
- [x] Docker context：已排除 Playwright 截图和测试结果，低于 80 MiB 限制。
- [x] PostgreSQL Session Store 真实数据库验证：`web_sessions` 已建立，登录后写入 1 条会话。
- [x] 空 PostgreSQL 首次部署：迁移、管理员登录、Session 和 `/health/ready` 冒烟通过。
- [x] 真实 PostgreSQL 集成测试：11/11 通过，包含统计增量、审计不可篡改、持久任务、Token、凭据迁移、CDK、红包、备份真实恢复和迁移回滚/重放。
- [x] 1,000 章真实写入基准：5 批，p50 77.9ms、p95 111.6ms、WAL 约 3.65 MiB。
- [x] `wenmoux/reader:v2.0` 本地 Docker 完整构建与容器冒烟。
- [x] 当前本地镜像版本：`2.0.0+20260711T083719.766d1740cf18.dirty.4bb3f875`；镜像 ID/digest：`sha256:8ccd4b44bd08f56bcbb345c3bd15b98a4f4e4c6cf5c0efefab391e7baca14c1d`。
- [x] 最终镜像内部版本和源码指纹写入 `.docker-build.json`，以最后一次构建产物为准。
- [x] Docker smoke 已验证 baseline 与 004–018 共 16 个迁移，并写入 2 条审计记录。
- [x] 覆盖率测试：242 通过、1 个 PostgreSQL 环境测试按预期跳过、0 失败；行/语句覆盖率 68.70%。
- [x] Docker Hub 已推送，并通过远端 manifest 核对 digest。

## 下一批优化

- [x] 增加后台审计日志查看入口，并把高风险操作收敛到统一二次确认组件。
- [x] 完成 Reader、Bot 和 PO18 Crawler 第一轮按行为拆分，保持现有 UI 与接口兼容。
- [x] 继续拆 Reader 校对/TTS 编排、Bot 共享编排和 Crawler HTML 解析。
- [x] 继续拆 Bot 搜索/社交、Crawler HTTP、Reader 导航与进度编排。
- [x] 增加运行时 OpenAPI、统一错误追踪、覆盖率基线、依赖更新和远端备份加密。

## 明确暂缓

- [ ] `(platform, book_id)` / `book_key` 唯一身份迁移：按本轮要求暂不实施。
- [ ] 现有 API 字段版本化或重命名：按本轮要求暂不实施。

VoceChat 已按用户要求明确排除，不属于本轮或后续待办。
