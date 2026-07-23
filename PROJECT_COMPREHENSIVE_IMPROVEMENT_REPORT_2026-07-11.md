# PO18 Reader 综合评估与改善报告

> 文档状态：历史评估与实施复核快照。第 1–18 节保留 2026-07-11 评估当时的风险、评分与建议，第 0 节记录 2026-07-12 的一次实施复核；两者都不会随代码自动更新，不能代替当前运行文档。
>
> 当前事实优先级：代码/测试 → 运行时 `/openapi.json` → [README](README.md)、[Docker 手册](DOCKER.md) 与 [docs/](docs/README.md) → [API 说明](API.md) 与 [迁移手册](db/MIGRATIONS.md) → [2026-07-23 综合审计报告](PROJECT_COMPREHENSIVE_ANALYSIS_2026-07-23.md) → [优化进度快照](V2_OPTIMIZATION_PROGRESS.md) 与本报告。阶段变化见 [更新记录](PROJECT_UPDATE_LOG.md)。
>
> 评估日期：2026-07-11
> 评估对象：单镜像部署、PostgreSQL 后端、Reader、Admin/Setup、Telegram Bot、PO18 Crawler、Legado 书源及运维工具
> 评估原则：以当前工作区代码为准；兼顾自用部署与开放给多用户后的安全、性能和维护成本。

## 0. 2026-07-12 实施复核快照

本报告提出的整改已继续实施。按用户确认的边界，只保留以下两项未实施：

1. `book_key` 统一身份迁移、子表外键回填及跨平台同号数据隔离。
2. Reader、Bot、Crawler、Admin 全端切换到平台感知 API；现有接口未删除、重命名或破坏兼容性。

除上述两项外，本报告的 P0/P1 整改和 P2 功能均已形成代码、迁移、管理入口或自动门禁。身份迁移前新增的 Manifest 会主动检测跨平台同 `book_id` 冲突并返回 `BOOK_ID_COLLISION_REQUIRES_BOOK_KEY`，不会静默选取其中一本。

| 范围 | 复核结果 | 主要证据 |
| --- | --- | --- |
| 凭据、会话、CORS、CSRF、TTS SSRF、限流 | 已实现 | PostgreSQL Session、AES-256-GCM 信封加密、生产配置拒绝、目标网络校验、分路由 Body/限流 |
| 可复现发布 | 已实现 | clean release、不可变 semver/source 标签、源码 hash、digest 冒烟、SBOM、Cosign 签名/证明工作流 |
| 章节统计、搜索、分类与 Schema | 已实现 | statement-level 增量统计、cursor/fast search、taxonomy 表、5 万行 EXPLAIN 基准、迁移快照漂移门禁 |
| API、Token、追踪与审计 | 已实现 | Ajv 高成本接口契约、OpenAPI 请求/响应 Schema、统一 `code/request_id`、Scope Token、追加式审计 |
| Reader | 已实现 | 主入口 gzip 46.11 KiB、虚拟目录、Session 合并、PWA、按账号隔离离线正文与进度补传、封面失败占位 |
| Admin、Setup、排行榜 | 已实现 | Vue Router、RBAC、统一二次确认/脏表单保护、共享静态设计令牌、安全配置导出、Setup Token Cookie、榜单周期/样本/定义元数据 |
| Bot、任务与 Crawler | 已实现 | 持久租约/心跳/重试/取消、扣费与奖励幂等账本、命令注册表、来源熔断/动态退避/分类错误与分位数 |
| Docker、备份与监控 | 已实现 | 固定基础镜像 digest、子进程监管、流式加密远端备份、临时库恢复演练、Prometheus 指标和告警规则 |
| P2 功能 | 已实现 | 缺书闭环、来源/质量中心、Bot 任务卡片、书评治理、PWA 离线、校验和 Manifest 增量恢复 |

本轮验证：Node 20 全量及覆盖率门禁共 310 项，其中 309 通过、0 失败，1 项真实 PostgreSQL 入口因本机未配置 `PO18_TEST_PG_URL` 跳过；覆盖率 statements/lines 71.38%、branches 53.29%、functions 70.19%；Admin 与 Reader 生产构建通过；UTF-8、Schema 漂移、ESLint、Prettier 和 Docker context 门禁通过。真实 PostgreSQL、搜索 EXPLAIN 与 digest Docker smoke 已进入 `main` 推送触发的 GitHub 发布工作流，由远端 Docker 环境执行并更新 Docker Hub `wenmoux/reader:v2.0`。

## 1. 执行摘要

项目已经不是简单的上传服务，而是一套功能较完整的自托管阅读平台：包含跨站元信息和章节缓存、阅读器、后台、初始化向导、Bot、爬虫、排行榜、备份恢复、健康检查、指标和 Docker 单镜像部署。以个人或小规模可信用户使用衡量，功能完整度和部署便利性较高。

目前的主要风险并非缺少功能，而是早期单站设计正在承载多平台、多用户和异步任务场景。最需要优先解决的五件事是：

1. **统一书籍身份**：元信息以 `(platform, book_id)` 唯一，但章节、统计、书架、历史、书评等大量数据只使用 `book_id`。不同平台 ID 相同会发生串书、误删或统计污染。
2. **收紧凭据与会话安全**：PO18 密码/Cookie 明文保存，Reader 可将密码写入 `localStorage`，跨域策略过宽，默认会话存储和默认口令不适合公网。
3. **把长任务改成可恢复任务**：Bot 队列和爬虫运行态主要在内存，容器重启后无法可靠续跑，运行中任务也缺少完整的取消、租约与幂等机制。
4. **消除批量章节写入的放大效应**：章节表逐行触发全书统计重算，批量上传大书时可能接近 O(N²)。
5. **建立可复现发布链**：长期覆盖同一个 `v1.0` 标签，并允许把未提交工作区构建进镜像，导致“代码已更新但版本仍旧”的判断困难。

结论：**当前适合作为功能强的个人/小团队自托管系统，但在完成身份模型和安全基线整改前，不建议直接作为开放注册的公网多租户服务。**

## 2. 综合评分

| 维度 | 评分 | 结论 |
| --- | ---: | --- |
| 功能完整度 | 8.0/10 | 阅读、搜索、缓存、Bot、爬虫、后台、备份等主链路齐全 |
| 部署便利性 | 8.0/10 | 单镜像和 Setup 向导降低了首次部署门槛 |
| 可观测性 | 7.0/10 | 有健康检查、深度诊断、指标、任务状态和结构化日志 |
| 测试能力 | 8.5/10 | 62 个测试文件，当前 242 通过、1 个 PostgreSQL 环境测试按预期跳过 |
| Reader 体验 | 7.0/10 | 功能丰富，已有分页、预取、主题、TTS 等能力，但首屏资源偏大 |
| 后台体验 | 7.0/10 | 功能覆盖较全，但缺少路由化、RBAC、统一审计和系统化防误触 |
| 性能可扩展性 | 6.0/10 | 已有统计表与索引，但写放大、搜索统计和超长目录仍有瓶颈 |
| 可维护性 | 5.5/10 | 模块数量合理，但数个核心文件重新膨胀到 1,000–2,800 行 |
| 安全与隐私 | 4.5/10 | 认证基础存在，但凭据、会话、CSRF、SSRF、限流仍需系统整改 |
| 发布可复现性 | 4.0/10 | 缺少 CI、不可变版本和源码内容指纹 |
| **综合** | **6.4/10** | 功能成熟，工程基础需要一次有顺序的加固 |

评分不是代码质量排名，而是用于确定投入顺序。优先修复 P0/P1 后，综合可稳定提升到 7.5–8 分区间。

## 3. 评估范围与方法

本次检查覆盖：

- 根项目、Admin 和 Reader 的依赖与构建结果。
- `server-pg.js`、18 个路由模块、26 个服务模块。
- Reader 7 个视图和 6 个组件、Admin 16 个视图。
- Bot 24 个模块及 5 个命令模块。
- PostgreSQL 初始化结构与 004–010 共 7 个迁移文件。
- Docker 构建、单容器启动、Setup、备份恢复、健康检查和发布脚本。
- 现有评估、更新日志、API 和部署文档。

验证结果：

- `npm test`：164 通过、1 跳过、0 失败。
- 跳过项：未配置 `PO18_TEST_PG_URL`，因此真实 PostgreSQL 集成测试未执行。
- 根项目与 Admin 生产依赖审计：0 漏洞。
- Reader 依赖审计：1 个高危、1 个中危，均有可用修复版本。
- Admin 和 Reader 均构建成功。
- Docker 构建上下文约 3.56 MiB，明显低于项目设置的 80 MiB 上限。

## 4. 当前架构概览

```text
Browser / Legado / Telegram
        | 3100 / 3200 / Bot API
        v
single Docker image (run-all)
  +-- server-pg: Admin、Reader API、Upload API、Bot API
  +-- reader static/proxy
  +-- Telegram Bot polling
  +-- Setup/control panel
        |
        v
remote or local PostgreSQL
        |
        +-- metadata / chapters / users / reviews / jobs / config
```

单镜像方案对当前用户群很合适：部署命令短、配置集中、组件版本一致。问题在于它把多个故障域放在同一生命周期内；应通过更可靠的子进程监管和持久任务恢复提高韧性，而不是立即拆成多个镜像。

规模快照：

| 项目 | 当前值 |
| --- | ---: |
| HTTP 路由 | 约 111 个 |
| 服务模块 | 26 |
| 路由模块 | 18 |
| Node 测试文件 | 41 |
| Admin 视图 | 16 |
| Reader 视图/组件 | 7 / 6 |
| Bot 模块/命令模块 | 24 / 5 |
| 数据库迁移 | 7（004–010） |

## 5. 已有优势

### 5.1 产品与用户侧

- 阅读器、书架、详情、目录、正文、搜索和排行榜形成完整阅读闭环。
- Bot 已具备搜索、导出、会员/等级/额度、书评、PO18 登录与共享等复杂业务能力。
- 管理端覆盖元信息、章节、用户、Bot、爬虫、备份、质量、任务和系统状态。
- Setup 可以在数据库未就绪时启动，符合“先开面板、后填数据库”的部署需求。
- Legado 书源与平台分类/标签入口拓展了外部使用场景。

### 5.2 工程与运维侧

- 上传 API 和 Bot API 已改为 Token 缺失时拒绝请求，方向正确。
- 关键写接口有独立 Token，并允许后台管理员 Session 调用。
- 已有 `/health`、`/health/deep`、`/metrics`、诊断脱敏和结构化日志。
- 备份支持本地、WebDAV、S3/R2，并有恢复前备份、文件名清理和保留数量。
- Reader 对 `v-html` 内容使用 DOMPurify，降低存储型 XSS 风险。
- 搜索使用 trigram 索引支持模糊匹配，已有性能预算和指标基础。
- 测试数量与覆盖面相对个人项目已经不错，当前测试全绿。

## 6. P0：必须优先处理的问题

### 6.1 书籍身份模型不一致

**现状**

- `book_metadata` 对 `(platform, book_id)` 建立唯一约束。
- `chapter_cache` 仍是 `UNIQUE(book_id, chapter_id)`，见 `pg-store.js:304`。
- `book_stats`、书架、历史、书评、反馈、众包统计及大量路由主要使用 `book_id`。
- Reader/Bot 常以 `/books/:bookId` 形式访问，查询元信息时可能选“最新一条”而不指定平台。

**风险**

例如起点和 PO18 恰好都存在 `book_id=123456`，可能出现：A 平台详情配上 B 平台章节、统计相加、书评串书、删除错书、频道推送封面或标题错配。数据量越大，碰撞概率越高。

**改善方案**

1. 引入不可变内部主键 `book_key`（推荐 UUID/BIGINT），`book_metadata` 保留 `(platform, external_book_id)` 唯一约束。
2. 所有子表增加 `book_key` 外键：章节、统计、书架、历史、书评、反馈、导出记录、推送去重、任务输入等。
3. API 新增平台感知形式，如 `/reader-api/books/:platform/:bookId`，旧接口保留兼容期并在发生碰撞时返回明确错误。
4. 缓存键、任务幂等键、日志字段统一包含 `book_key` 和平台。
5. 迁移前执行碰撞审计；不能静默选择其中一个平台。

**验收标准**

- 构造两个平台相同 `book_id` 的测试数据。
- 元信息、章节、搜索、书架、历史、书评、导出、删除和 TG 推送全部隔离。
- 外键约束阻止孤立章节和跨书关联。

### 6.2 明文凭据与浏览器密码持久化

**现状**

- `reader_po18_accounts` 保存 PO18 密码和 Cookie。
- 爬虫 Cookie profile 可写入后台配置。
- `cirno-src/src/views/Login.vue:96-143` 的“记住”逻辑会把 `passwd` 写入 `localStorage`。

**风险**

数据库备份、后台配置导出、XSS、浏览器扩展或同源脚本泄露时，可直接取得第三方账号凭据。Cookie 与密码的价值高于普通业务数据。

**改善方案**

- Reader 只记住用户名，不保存密码；认证依赖 HttpOnly Session。
- PO18 密码/Cookie 使用应用层信封加密，主密钥仅来自 `/config/app.env` 或 Docker Secret，不写数据库。
- 密文包含 `key_version`、nonce、tag，支持双密钥轮换和逐条重加密。
- 配置导出默认排除凭据；包含秘密的备份必须明确标记并加密。
- 管理端不再返回完整 Cookie，只显示更新时间、失效状态和脱敏摘要。

**验收标准**

- 数据库 dump、浏览器 Local Storage、普通配置导出中均不存在可直接使用的密码/Cookie。
- 密钥轮换期间旧密文可读，新写入使用新版本。

### 6.3 会话、跨域与写请求保护不足

**证据**

- `server-pg.js:599` 使用 `cors({ origin: true, credentials: true })`，会反射任意来源。
- `server-pg.js:615-618` 使用默认 Session Store；Cookie 未设置 `secure`。
- 未发现生产级 `trust proxy`、CSRF 令牌和登录限流的完整闭环。
- 默认 Session Secret 和管理员密码仍可回退到固定值，见 `server-pg.js:93-95`。

**改善方案**

- Session 改用 PostgreSQL/Redis Store；设置清理周期、会话轮换和并发会话策略。
- 生产模式配置明确 Origin 白名单；无跨域需求时关闭 CORS Credentials。
- 反代 HTTPS 下设置 `trust proxy`、`Secure`、`HttpOnly`、合适的 `SameSite`。
- 后台和 Reader 的状态修改请求增加 CSRF Token 或严格的同源校验。
- 登录、注册、Setup Token、上传检查和昂贵查询分别限流。
- `NODE_ENV=production` 时若仍使用默认密码、默认 Session Secret 或关闭 Setup 鉴权，直接拒绝启动。

### 6.4 TTS 代理存在认证后 SSRF

`routes/reader-tts.js` 允许已登录 Reader 提交任意 HTTP/HTTPS URL，服务端随后转发请求。攻击者可探测容器网络、云元数据地址、数据库面板或内网 HTTP 服务；过滤 `Host` 等请求头不能阻止目标地址攻击。

**改善方案**

- 最优：移除通用 URL 代理，只保留已配置的 TTS Provider 适配器。
- 如必须保留：仅允许管理员配置的域名与路径前缀；DNS 解析后拦截 loopback、link-local、RFC1918、IPv6 私网和重绑定；禁止重定向到非白名单地址。
- 限制响应大小、请求体大小、Content-Type、并发和超时。
- 对失败目标和调用者记录安全审计，不记录密钥正文。

### 6.5 发布版本不可复现

**现状**

- Docker Hub 频繁覆盖 `wenmoux/reader:v1.0`。
- 构建版本主要来自 Git HEAD，但允许未提交文件进入镜像。
- 当前 Git HEAD 与实际已改源码之间存在工作区差异，这会造成“镜像内容是新的，界面版本仍显示旧日期”。
- 仓库没有 CI 工作流、SBOM、镜像签名和自动发布证据。

**改善方案**

- 正式发布要求 clean worktree；开发构建自动标记 `dirty.<contentHash>`。
- 每次发布生成不可变标签，例如 `v1.0.7` 和 `sha-766d174-<content8>`；`v1.0` 只作为可移动兼容标签。
- UI 显示语义版本、Git SHA、源码内容哈希、构建时间和镜像 digest。
- CI 顺序：测试 -> PG 集成测试 -> audit -> Admin/Reader build -> Docker context -> smoke -> SBOM -> 签名 -> 推送。
- 发布后输出 digest，并以 digest 做一次容器冒烟测试。

## 7. P1：数据库与性能

### 7.1 章节写入触发全量统计重算

`db/migrations/006_book_stats.sql:118-119` 在 `chapter_cache` 每次 INSERT/UPDATE/DELETE 后触发 `refresh_book_stats`。该函数会重新聚合整本书的章节。一次上传 1,000 章可能执行 1,000 次越来越大的聚合，形成明显写放大。

建议按优先级选择：

1. 批量上传事务结束后显式刷新一次统计。
2. 使用 statement-level trigger 和 transition table，只刷新本语句涉及的书。
3. 对简单计数采用增量维护，对复杂完整度异步重算。
4. 建立待刷新书籍队列并去重，短时间内只计算一次。

验收：上传 1,000 章时统计聚合次数有固定上限；记录 p50/p95、SQL 调用数与 WAL 增量。

### 7.2 搜索与分类查询

当前模糊搜索对多个字段做前导通配 `ILIKE`，已有 trigram 索引是正确基础。但大库下仍应注意：

- 默认总数 `COUNT(*)` 可能比结果页本身更慢；普通翻页可返回 `has_more`，仅在需要时精确计数。
- 深分页改用 keyset/cursor，避免高 OFFSET。
- category/tag 不应在每行查询中反复 `regexp_split_to_table`；规范化为关联表，或用数组/JSONB 加 GIN 索引。
- 热门榜单和统计页使用物化统计/缓存，定时更新而非每次实时聚合。
- 为真实规模构造基准库，固定保存 `EXPLAIN (ANALYZE, BUFFERS)` 回归结果。

### 7.3 Schema 管理双轨制

当前既有 `initPg()` 大段建表/补列逻辑，又有 004–010 迁移。继续双轨会导致：新装可用、老库漏迁移，或某次改动只进入初始化 DDL 而没有版本记录。

建议：

- 将所有结构变化写成只前进的编号迁移。
- 初始化只负责创建迁移表并从 001 依次执行。
- 每个迁移记录 checksum、执行时间、应用版本。
- CI 从空 PostgreSQL 创建一次，再从上一个发布版本升级一次。
- 生成 schema snapshot，检测未入迁移的结构漂移。

### 7.4 数据质量约束

需要补充或加强：

- `chapter_order` 的范围、同书排序唯一性策略及 order 冲突处理规则。
- 平台 ID、分类、状态字段的枚举或字典表。
- 元信息更新时间、来源更新时间与缓存更新时间分离。
- 删除书籍时外键级联/限制策略，避免手工多表清理遗漏。
- 完整度计算记录分母来源，区分站点总章数、可购章节数和实际目录数。

## 8. P1：后端与 API

### 8.1 API 契约不统一

约 111 个端点中仍存在大量手工读取和转换 `req.body`/`req.query` 的逻辑，统一验证工具只覆盖少数路由。错误结构和中文提示也不完全一致。

建议：

- 引入 Zod/Ajv/Joi 中的一种，定义请求、响应和分页 Schema。
- 标准错误：`{ error, code, details, request_id }`。
- 生成 OpenAPI；Legado、Bot、Reader 使用生成或共享的客户端类型。
- 对废弃字段和兼容接口设置版本与删除日期。
- `API.md` 保留面向人的说明，端点清单由 OpenAPI 自动生成，避免重复章节漂移。

### 8.2 内部 Token 权限过大

Bot 使用单一全局 Token 调用多类接口，其中包含用户导入、管理员状态、PO18 账户 Cookie 等高敏能力。Token 泄露后的影响范围过大。

建议拆分 Scope：

- `bot:read`：搜索、书籍、命令配置。
- `bot:user`：签到、额度、普通用户写入。
- `bot:export`：导出任务。
- `bot:admin`：用户导入和管理操作，默认不授予 Bot 运行实例。
- `crawler:write`：元信息/章节上传。

Token 存储哈希，支持独立吊销、轮换、最近使用时间和来源 IP 策略。

### 8.3 限流与资源上限

全局 30 MiB JSON/urlencoded 限制发生在鉴权前，容易被用于内存和 CPU 消耗。应按路由设置：

- 登录/Setup：小 Body、严格 IP+账号限流。
- 元信息：数百 KiB。
- 单章正文：按业务上限，流式或明确限制。
- 备份：保持流式，不走 JSON Parser。
- 搜索、check-cache、TTS：用户/IP/Token 三维限流。

`/api/parse/check-cache` 当前公开返回章节 ID/order，不返回正文，可以继续作为兼容接口，但需要限流、缓存和文档声明。

### 8.4 请求追踪与审计

- 为每个请求生成/透传 `request_id`，日志、任务、Bot 错误消息和 API 响应关联。
- 新建不可变 `admin_audit_logs`：操作者、动作、对象、前后摘要、原因、IP、时间。
- 删除、恢复、改会员、改余额、改管理员、批量章节操作必须审计。
- 敏感字段只记录是否配置、长度/版本和脱敏指纹。

## 9. P1：Reader 体验与性能

### 9.1 构建基线

| 资源 | 当前构建结果 |
| --- | ---: |
| Reader 主 JS | 728.53 KiB（gzip 229.13 KiB） |
| Reader 阅读页异步块 | 81.86 KiB（gzip 23.41 KiB） |
| 简繁转换异步块 | 1,144.09 KiB（gzip 507.66 KiB） |
| Remixicon SVG | 1,195.52 KiB |
| Admin JS | 219.19 KiB（gzip 69.17 KiB） |

阅读页本身的异步块并不大，首屏偏重主要来自公共依赖和整套图标资源。简繁转换已经异步加载，方向正确，但需避免未启用时预取。

### 9.2 优化顺序

1. 升级 Reader 的 `dompurify` 及其依赖链，修复当前 1 高危、1 中危审计项。
2. Remixicon 改为按需 SVG/Icon 组件，不打包完整字体和 SVG 集。
3. 分析主包依赖占比，将非首屏功能（图表、导出、TTS Provider、复杂设置）继续按路由/交互异步加载。
4. 全局维护认证状态，避免每次路由切换重复调用 `/reader-auth/me`；删除误导性的 `login_token=local-session`。
5. 数千章节目录使用虚拟列表；目录请求支持增量加载但保持定位当前章能力。
6. 统一首页、书架、详情、正文的 skeleton/empty/error/offline 状态，避免慢请求时页面像“未加载”。
7. 封面使用尺寸参数、懒加载、失败占位和代理缓存策略。

### 9.3 Reader.vue 拆分

`Reader.vue` 约 2,878 行，混合主题、目录、TTS、纠错、阅读计时、Ihuaben 解析、导航和大量 UI 状态。建议保持视觉不变，按行为拆分：

- `useReaderSettings`
- `useChapterNavigation`
- `useReaderTts`
- `useCorrections`
- `useReadingProgress`
- `parseIhuabenContent`
- `ReaderToolbar`、`ReaderSettingsPanel`、`ReaderCatalog`、`ReaderHeader`、`ReaderContent`

拆分验收不是“文件变短”，而是每个模块有单元测试、输入输出明确，切章/TTS/设置不发生行为回归。

### 9.4 性能预算建议

| 指标 | 建议目标 |
| --- | ---: |
| 首屏主 JS gzip | < 150 KiB |
| 搜索 p95（缓存命中） | < 500 ms |
| 搜索 p95（冷查询） | < 1.5 s |
| 详情目录 p95 | < 500 ms |
| 正文打开 p95 | < 800 ms |
| Reader 路由 warm p95 | < 1 s |
| JS 长任务 | 单次 < 100 ms |

将 Web Vitals 和上述 API 指标接入系统页，并按版本保存基线，不只看单次主观速度。

## 10. P1：后台、Setup 与排行榜

### 10.1 后台路由化

Admin 当前通过动态组件状态切换视图，缺少真正的 URL 路由。后果是刷新丢失页面、不能分享深链接、浏览器前进后退行为不自然。

引入 Vue Router：

- `/admin/overview`
- `/admin/books`
- `/admin/books/:platform/:bookId`
- `/admin/tasks`
- `/admin/crawler`
- `/admin/backups`
- `/admin/system`

筛选、分页和排序写入 Query String，刷新后可恢复。

### 10.2 RBAC 与高风险操作

目前管理员会话基本拥有完整权限。建议角色：

- `owner`：密钥、恢复、管理员、系统配置。
- `operator`：书籍、章节、爬虫、任务。
- `moderator`：书评、反馈、用户内容。
- `viewer`：只读监控和统计。

删除章节/书籍、恢复数据库、调整余额和权限需要二次确认、填写原因并进入审计日志。弹窗统一增加 dirty guard，点击遮罩或 Esc 时有未保存内容则不关闭。

### 10.3 Setup 与 Admin 共用设计基础

两者视觉可以保持一致，但 Setup 必须继续在数据库不可用时独立运行。推荐共享静态设计令牌（颜色、间距、字体、表单和提示样式），不要让 Setup 依赖 Admin API 或数据库。

Setup Token 不应长期存在 URL 中：首次验证后交换为短期 HttpOnly Secure Cookie，再 302 到不含 Token 的 `/setup`，避免浏览器历史、Referer、截图和反代日志泄露。

### 10.4 排行榜

动态榜单方向优于大型静态 JSON，但应明确：

- 排名计算周期、最近更新时间和样本数量。
- 平台/分类/更新时间/缓存/人气的标准化定义。
- 使用预计算表或物化视图，不在每个访问请求上实时扫全库。
- 站点与分类字典来自数据库有效值，避免书源写死不存在的平台。

## 11. P1：Bot 与爬虫

### 11.1 Bot 任务持久化

`bot/job-queue.js` 是内存队列；`system_jobs` 主要记录状态，不是可恢复执行队列。容器重启后，排队或运行任务不能可靠续跑；当前取消只覆盖 queued，运行任务缺少贯穿业务层的 AbortSignal。

建议 PostgreSQL 持久任务协议：

1. 写入任务时包含 type、payload、idempotency_key、priority、max_attempts。
2. Worker 使用 `FOR UPDATE SKIP LOCKED` 领取任务。
3. 运行时维护 lease/heartbeat；超时任务在启动时回收。
4. 重试记录 attempt、next_run_at 和指数退避。
5. 取消设置 `cancel_requested_at`，业务循环检查 AbortSignal。
6. 输出结果、错误码、进度和可重试性，Bot 消息与后台都可刷新/取消/重试。

导出、PO18 共享、批量上传、备份和爬虫应进入持久队列；普通消息和低价值通知可继续使用内存队列。

### 11.2 Bot 代码拆分

`bot/telegram-bot.js` 约 1,546 行，较早期拆分后又增长。应继续移动：

- PO18 登录/书架/共享处理器。
- 搜索、导出、书评和词云命令处理器。
- Callback Query 路由。
- 频道元信息推送与去重。
- 命令注册、配置刷新和启动逻辑。

采用命令注册表 `{ command, permission, rateLimit, handler }`，避免主文件继续累积条件分支。

### 11.3 PO18 Crawler 分层

`services/po18-crawler.js` 约 1,672 行，同时负责 HTML 解析、Cookie、HTTP 重试、来源扫描、调度、状态和上传。建议拆成：

- `po18/http-client`：Cookie Jar、限速、重试、状态码分类。
- `po18/parsers`：详情、目录、书架、发现页纯函数。
- `po18/sources`：书架、缓存 ID、订阅、发现页 Provider。
- `crawler/scheduler`：定时、暂停、恢复、并发。
- `crawler/uploader`：元信息、章节、order-only、幂等。

解析器使用保存的脱敏 HTML fixture 测试，覆盖登录页、验证页、404、分页、免费/付费、分卷、插章和缺失章节 ID。

### 11.4 来源健康和反爬策略

- 每个平台独立并发、最小间隔、退避上限和熔断状态。
- “请求频繁，请 N 秒后再试”解析动态 N，并加入随机抖动；不能把提示页作为正文存储。
- 保存最近成功、认证失败、限流、解析失败、p50/p95 延迟。
- Cookie 失效与网页结构变化使用不同错误码，不要统一提示“Cookie 无效”。
- 已完结且 100% 缓存的书可跳过正文，但仍按低频周期检查元信息/目录漂移。

## 12. P1：Docker、备份与运行维护

### 12.1 单镜像继续保留

当前无需为了“架构漂亮”强制拆成三个镜像。单镜像满足主要部署诉求，但建议：

- `run-all` 对子进程做独立重启和退避，不因一个可选 Bot 暂时失败而结束全部服务。
- Readiness 区分 Reader 静态可用、API 可用、数据库可用、Bot 已连接。
- 优雅停机：停止接单、等待短任务、标记长任务可恢复、关闭连接池。
- 增加只读文件系统兼容性，写入集中到 `/config`、`/data`、`/tmp`。
- Dockerfile 使用非 root 用户、多阶段构建、固定基础镜像 digest。

### 12.2 备份系统

已有实现的优点包括流式本地上传、1 GiB 限制、恢复前备份、默认保留 8 份、文件名清理和远端支持。需要补齐：

- 远端上传当前读取完整 dump 后 PUT，大文件可能 OOM；改为流式/分片上传。
- 远端同样执行保留策略。
- 每个备份记录 SHA-256、数据库版本、Schema 版本、应用版本和大小。
- 支持客户端或服务端加密，配置备份默认视为敏感数据。
- 定期自动恢复到临时数据库并运行一致性检查，只有“能恢复”的备份才算有效。
- 恢复前检查磁盘空间、连接数和目标库；恢复过程进入持久任务中心。

### 12.3 监控与告警

建议新增指标：

- 数据库池等待、查询超时、慢查询分位数。
- 搜索/目录/正文接口 p50/p95/p99。
- 任务排队时长、运行时长、失败率、重试率、失去心跳数量。
- 各来源抓取成功率、认证失败率、限流率。
- 缓存书数、完整书数、章节增长、order 漂移和异常正文数。
- Bot polling 延迟、发送失败、TG 429、私聊不可达。
- 备份最后成功时间和最后一次恢复演练时间。

`/metrics` 绑定公网地址时强制配置 Token，或仅监听内网/localhost。

## 13. P1：代码质量与开发体验

### 13.1 大文件治理

| 文件 | 约行数 | 主要问题 |
| --- | ---: | --- |
| `cirno-src/src/views/Reader.vue` | 2,878 | 阅读状态、解析、TTS、设置、UI 混合 |
| `cirno-src/src/utils/chinese-convert.js` | 2,669 | 生成字典，可接受但应标明生成来源 |
| `services/po18-crawler.js` | 1,672 | 网络、解析、任务、状态、上传混合 |
| `admin-ui/src/styles.css` | 1,575 | 全局样式难定位、令牌和组件样式混合 |
| `bot/telegram-bot.js` | 1,546 | 命令与业务处理重新集中 |
| `BookDetail.vue` | 1,348 | 详情、目录、编辑和交互混合 |
| `BookLibrary.vue` | 1,143 | 搜索、筛选、分页、卡片状态混合 |
| `server-pg.js` | 996 | 配置、装配、兼容逻辑过多 |
| `docker/control-panel.js` | 993 | HTML、认证、配置和路由混合 |

生成字典的大文件不需要人为拆分；业务大文件则应按可测试行为拆分。不要以“减少行数”为唯一目标。

### 13.2 工具链

- 添加 ESLint、Prettier 和 `.editorconfig`，CI 中只检查本次改动或逐步清债。
- 为核心领域对象增加 TypeScript 或严格 JSDoc：BookIdentity、Chapter、Job、AuthScope、CrawlerResult。
- 新增覆盖率报告和阈值；先记录基线，再逐步提高，避免一次性要求过高。
- 添加 dependency update 流程和 lockfile 审查。
- 自动检测 UTF-8 损坏字符串。当前 `routes/admin-auth.js:14` 存在真实异常字符；另外 PowerShell 显示乱码不一定代表文件损坏，应以 UTF-8 字节扫描为准。

### 13.3 文档治理

- `PROJECT_UPDATE_LOG.md` 当前停在 2026-06-30，需要补充 7 月变更，但只记录用户可感知内容和重要 API/迁移。
- 旧综合报告的文件规模和完成状态已过时，应在顶部标记 superseded，而非保留多个互相冲突的“当前结论”。
- `DOCKER.md` 对“四容器”和主要单镜像路径的表述需明确区分：推荐部署、开发部署、外部 PostgreSQL。
- `API.md` 已有重复变更段落，长期应由 OpenAPI 生成端点索引。
- 删除文档前先检查 README/Issue/脚本链接；历史决策文档可归档到 `docs/archive`，不宜直接丢失上下文。

## 14. P2：值得增加的功能

这些功能有价值，但应排在 P0/P1 基础整改之后：

1. **缺书请求闭环**：待处理 -> 已接受 -> 抓取中 -> 已缓存 -> 已通知，缓存完成自动私聊请求者。
2. **来源健康面板**：按平台展示成功率、延迟、Cookie 状态、限流和结构变化告警。
3. **数据质量中心**：ID 碰撞、重复元信息、元信息新鲜度、字段完整率、目录 order 漂移、异常正文。
4. **Bot 任务卡片**：排队/运行/失败/重试/取消，原消息实时编辑。
5. **书评治理**：举报、审核、频率限制、反刷赞踩、金币流水和申诉记录。
6. **PWA/离线阅读与进度同步**：需在认证、缓存权限和数据主键完成后实施。
7. **导入导出 Manifest**：元信息、章节、版本、checksum 和来源，支持校验与增量恢复。

## 15. 分阶段实施路线

### 阶段 A：1–2 天，立即止损

- [x] Reader 不再把密码写入 `localStorage`，清理已有 `loginInfo.passwd`。
- [x] 升级 Reader 中存在漏洞的 DOMPurify/form-data 依赖链。
- [x] 修复 `routes/admin-auth.js` 的真实乱码字符串并加入 UTF-8 扫描。
- [x] TTS 通用代理增加域名白名单和私网 IP 拦截，或暂时关闭。
- [x] 生产环境禁用默认管理员密码和默认 Session Secret。
- [x] 为登录、Setup、check-cache、TTS 和上传接口增加基础限流。
- [x] 构建信息增加 dirty/content hash，停止只看固定 `v1.0` 文本。

### 阶段 B：1–2 周，安全与稳定性

- [x] PostgreSQL Session Store、HTTPS Cookie、Origin 白名单、CSRF。
- [x] PO18 密码/Cookie 应用层加密与密钥轮换。
- [x] Bot/Upload Token 拆分 Scope 并支持吊销审计。
- [x] 章节批量写入后只刷新一次统计，完成 1,000 章基准测试。
- [x] 备份 checksum、远端流式上传和自动恢复演练。
- [x] CI 执行测试、真实 PG 集成、audit、build、Docker smoke。
- [x] 后台高风险操作审计日志与统一二次确认。

### 阶段 C：2–6 周，核心模型迁移

- [ ] 引入 `book_key`，完成碰撞审计和子表迁移。
- [ ] 新旧 API 双读/兼容，随后把 Reader、Bot、Crawler、Admin 全部切到平台感知身份。
- [x] PostgreSQL 持久任务队列、租约、心跳、重试、幂等和取消。
- [x] 统一 Schema 迁移体系和空库/升级测试。
- [x] 拆分 Reader、Bot、Crawler 大文件并补领域测试。

### 阶段 D：后续产品增强

- [x] 缺书请求通知闭环。
- [x] 来源健康与数据质量仪表盘。
- [x] Admin Router、RBAC、保存视图和批量操作。
- [x] Bot 任务状态卡片和 Telegram 命令体验增强。
- [x] Reader 资源瘦身、目录虚拟列表、RUM 性能看板。

## 16. 关键验收清单

| 主题 | 必须通过的验收 |
| --- | --- |
| 书籍身份 | 两个平台相同外部 ID 时，所有数据和操作完全隔离 |
| 凭据 | DB dump、Local Storage、普通配置导出无可直接使用的密码/Cookie |
| 会话 | 重启不丢 Session；HTTPS 下 Secure；跨站写请求被拒绝 |
| SSRF | TTS 无法访问 localhost、私网、云元数据和非白名单重定向 |
| 章节上传 | 1,000 章批量写入统计聚合次数有界，p95 有基线 |
| 任务恢复 | Worker 在执行中被杀后，任务租约到期可恢复且不会重复发奖/扣费 |
| 备份 | 自动恢复到临时库成功并通过行数、checksum、Schema 校验 |
| 发布 | 任一运行容器可反查版本、Git SHA、源码 hash、镜像 digest |
| API | 非法输入返回统一 code/request_id；OpenAPI 与实现一致 |
| Reader | 达到搜索、目录、正文和首屏性能预算，无明文记住密码 |

## 17. 暂时不要做的事情

- 不要在 `book_key` 迁移前继续扩大只接受 `book_id` 的新功能表。
- 不要为了形式上的微服务化立刻拆成多个镜像；先解决任务恢复、会话和发布问题。
- 不要同时大改 Reader UI 和拆分 Reader 逻辑；先保持行为与视觉稳定地组件化。
- 不要用更多内存缓存掩盖缺少索引、全量 COUNT 或逐行统计触发器。
- 不要在凭据仍为明文、后台无 RBAC 时开放公共注册或给不受信任管理员使用。
- 不要继续覆盖唯一的发布标签而不保留不可变版本和 digest。

## 18. 建议的下一轮工作顺序

推荐建立一个独立的“基础加固版本”，不混入新的产品功能：

1. 完成阶段 A 的低风险修复。
2. 建立 CI、构建指纹和不可变镜像标签，使之后每次修改可追踪。
3. 优化章节统计写入，先解除当前最明显的数据库放大点。
4. 完成会话、CSRF、CORS、凭据加密和 TTS SSRF 修复。
5. 做书籍 ID 碰撞审计，设计并演练 `book_key` 迁移。
6. 最后把长任务迁到持久队列，再继续增加 Bot、Crawler 和 Reader 功能。

按这个顺序推进，既不会推翻现有单镜像部署，也能把系统从“功能很多的自用项目”提升为可长期维护、可验证发布、可安全开放给更多用户的平台。
