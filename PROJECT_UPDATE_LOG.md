# PO18 Reader 简化更新记录

更新时间：2026-06-06

说明：本文件只保留阶段级更新，不再记录旧报告里的每条细碎构建流水。完整旧记录已备份到 `backups/docs-consolidation-20260605-204647`。

## 2026-06-20：Bot PO18 书架共享奖励

- 新增书评功能：
  - 数据表 `reader_book_reviews`、`reader_book_review_votes` 和迁移 `009_book_reviews.sql`。
  - 阅读器详情页新增“书评”标签，异步展示公开书评列表。
  - Bot 新增 `/review 书号 内容` 和 `/reviews 书号`；详情卡片增加“书评”入口。
- 发布书评要求 Lv.2 及以上，默认消耗 100 铜。
- 发布成功后推送到配置的 Telegram 频道；频道按钮支持赞/踩。
- 点赞给书评作者 +100 铜，点踩给作者 -1 铜；同一用户重复点击不重复结算，改投只结算净变化。
- Bot `/reviews` 列表展示增加书名、作者、站点和更清晰的评论卡片排版；列表接口同步返回书籍摘要，空书评时也能显示书名。
- `/mybookshelf` 拉取已购书架后新增“上传共享已购书架”按钮。
- 书架共享进入 Bot 后台任务队列，任务类型为 `bot_po18_bookshelf_share`，同一用户避免重复并发执行。
- 批量共享会持续编辑进度：处理本数、新增章节、跳过章节、失败章节、可奖励付费新增章节和铜币奖励。
- 上传章节事件来源标记为 `telegram_bot`，章节/元信息继续记录上传用户 `tgid`。
- 奖励规则收紧：单本本次新增上传的付费章节大于 20 章奖励 1000 铜币；免费章节和已存在跳过章节不计入奖励。
- 后台 PO18 遍历增加过滤配置：发现页 `tag/tid`、只选分类/标签、屏蔽标签、屏蔽关键字、最小/最大章节数，并在运行状态展示过滤跳过数量。
- PO18 遍历“缓存 ID”来源改为“元信息库”：直接从 `book_metadata.platform=po18` 读取候选书籍；已完结且 `book_stats.cache_count` 达到总章节数的书会在源列表阶段跳过，并展示“完结完整跳过”数量。
- 修复 PO18 发现页遍历：按站点真实表单恢复 `POST /findbooks/index`，请求前读取隐藏 `_po18rf-tk001`，POST 后刷新下一次 token，并补齐浏览器导航请求头；遇到 404 会刷新表单 token 后重试一次。
- PO18 元信息库、订阅和书架补缺不再套用最小/最大章节数过滤；章节数范围仅用于发现页筛选，标签/关键字屏蔽仍适用于所有来源。
- 优化 PO18 遍历日志：每本书详情显示总章、免费章、付费章和目录页数；目录处理显示可访问章节、候选章节、已缓存跳过、未购锁定和最终上传/失败摘要，避免把“全书总章数”和“当前可抓免费章数”误读成异常。
- 后台顶栏新增版本标识，显示当前镜像 tag 和应用版本，方便部署后确认是否已更新到最新镜像。
- 修复 PO18 发现页 404：发现页 POST 前会把后台旧配置值归一化为站点真实表单值，例如 `writing -> 1`、`finish -> 2`、`popularity -> 22`、`collect -> 42`，后台排序选项同步改为 PO18 实际支持项。
- 修复 PO18 遍历停止状态：手动停止不再把并发中的书记录为失败，也不再显示 `crawler finished`，而是向任务中心传递取消状态。
- 重写 GitHub README，补齐项目简介、功能介绍、单容器/Compose 部署流程、本地开发、配置说明、常用命令、目录结构、数据隐私和免责声明；新增 `assets/readme-hero.svg` 作为仓库宣传图。

## 2026-06-02：单镜像与初始化面板

- 完成 Docker 单镜像方案：`server-pg`、`cirno-src` 阅读器、Telegram Bot 合并到 `wenmoux/reader:v0.1`。
- 支持只映射 `/config`、`3100`、`3200` 后先进入 setup 面板。
- setup 面板可写入 `/config/app.env`，保存后容器自动重启进入正常服务。
- 增加状态检查、日志查看、配置诊断、重启入口。
- 明确 `/reader` 从后端 3100 跳转到阅读器 3200。

## 2026-06-03：后台 UI、榜单与加载体验

- 后台从旧静态页迁移到 `admin-ui`：Vite + Vue3。
- setup 面板和后台视觉风格统一。
- 后台补齐数据看板、书库、用户、交易、CDK、反馈、纠错、系统、Bot 等页面。
- 书库列表减少横向撑宽字段，去掉容易拉宽的最新章节名展示。
- 静态书单替换为动态榜单：
  - `GET /rank`
  - `GET /reader-api/rank`
  - `GET /admin-api/rank/status`
  - `POST /admin-api/rank/refresh`
- 后台增加部分短缓存、静态资源缓存和慢查询日志。

## 2026-06-04：安全、运维和可观测性

- 上传/写入 API 增加 `PO18_UPLOAD_API_TOKEN`：
  - 支持 `X-Upload-Token`
  - 支持 `X-PO18-Upload-Token`
  - 后台管理员 session 仍可调用
  - 未配置 token 时写入接口返回 `503`
- Bot API 改为 fail-closed：
  - `PO18_BOT_API_TOKEN` 为空时 `/bot-api/*` 返回 `503`
- 阅读器 HTML 清洗接入 DOMPurify，降低缓存正文/简介 XSS 风险。
- 阅读器 `axios` 升级到 1.17.x，根项目和后台生产依赖 audit 为 0 漏洞。
- 增加结构化日志、请求 ID、慢请求日志、日志轮转。
- 增加 `/health/live`、`/health/ready`、`/health/version`、`/health/deep`。
- `/health/deep` 增加 `upload-api-token`、`bot-api-token` 检查。
- 增加 Prometheus `/metrics`，支持可选 `PO18_METRICS_TOKEN`。
- 后台系统页加入备份上传/恢复、数据质量、Bot 运行概览。

## 2026-06-05：P1 稳定性与维护性收口

- PostgreSQL 迁移系统落地：
  - `schema_migrations`
  - 启动自动执行未执行迁移
  - advisory lock
  - `db/rollbacks/*.down.sql`
  - `npm run db:rollback`
- 新增迁移：
  - `004_trgm_indexes.sql`
  - `005_system_jobs.sql`
  - `006_book_stats.sql`
  - `007_bot_audit_logs.sql`
- 统一任务中心 `system_jobs`：
  - 后台 Jobs 页面
  - 备份、上传 dump、恢复、榜单刷新、Bot 导出/同步/共享上传、陈旧书清理、章节顺序修复入库
  - 支持部分失败任务重试
- `book_stats` 聚合表接入搜索、详情、榜单、书架、后台书籍列表、Bot 分享等场景。
- 后端模块化收口：
  - `services/system-jobs.js`
  - `services/backups.js`
  - `services/health.js`
  - `services/rank.js`
  - `services/telegram-push.js`
  - `services/user-currency.js`
  - `services/book-chapters.js`
  - `services/config.js`
  - `services/auth.js`
  - `services/events.js`
  - `services/hot-keywords.js`
  - `services/book-social.js`
  - `services/book-maintenance.js`
  - `services/chapter-maintenance.js`
  - `services/job-retry.js`
  - `services/tts.js`
- 路由模块化收口：
  - `routes/health.js`
  - `routes/rank.js`
  - `routes/admin-auth.js`
  - `routes/admin-system.js`
  - `routes/admin-backups.js`
  - `routes/admin-config.js`
  - `routes/admin-content.js`
  - `routes/upload-api.js`
  - `routes/reader-api.js`
  - `routes/bot-api.js`
- Bot 优化：
  - 命令注册表 `bot/command-registry.js`
  - 命令分组 `bot/commands/*`
  - 导出错误码 `bot/export-errors.js`
  - 群聊长结果转私聊摘要
  - Bot 长任务写入任务中心
  - `bot_audit_logs` 和后台 Bot 审计展示
- 最近验证记录：
  - `npm test`：72 项通过、1 项跳过
  - `npm run test:pg`：5 项通过
  - `npm run admin:build`：通过
  - 根项目与后台生产依赖 audit：0 漏洞
  - setup 无数据库冒烟：200
- 最新记录的 DockerHub 镜像：
  - `wenmoux/reader:v0.1`
  - digest `sha256:0d613a0a52ccf33cbd0a4a7a1d01bf4b36e02a43a419d3bf85eeadcfbeec97ae`

## 2026-06-05：文档整理

- 新增 `PROJECT_COMPREHENSIVE_ASSESSMENT.md`：综合现状评估和改善报告。
- 新增 `PROJECT_UPDATE_LOG.md`：替代旧报告中的长更新流水。
- 更新 `API.md`：补充任务中心、Bot 内部任务上报、Bot 审计、健康检查、metrics、上传 token 等新增接口。
- 删除旧重复文档：
  - `PROJECT_STATUS_AND_IMPROVEMENT_REPORT.md`
  - `PROJECT_OPTIMIZATION_AND_FEATURE_ROADMAP.md`
  - `bot/BOT_FUNCTIONS_IMPLEMENTATION.md`
- 归档并移除旧转换扫描产物：
  - `cirno-src/docs/conversion-scans/`

## 2026-06-05：P1 维护性与性能第一批

- P1-2 Bot 主入口继续减重：
  - 新增 `bot/search-platforms.js`，抽出平台后缀、平台标签、平台解析逻辑。
  - 新增 `tests/bot-search-platforms.test.js`。
- P1-3 路由热点继续拆分：
  - 新增 `routes/bot-api-system.js`，承载 `/bot-api/health`、`/bot-api/audit`、`/bot-api/jobs`、`PATCH /bot-api/jobs/:id`。
  - 新增 `routes/reader-auth.js`，承载 `/reader-auth/*` 注册、登录、TG 登录、签到、资料、退出。
  - 新增 `routes/reader-tts.js`，承载 `/reader-api/tts/*` 代理、Edge TTS、云 TTS provider。
  - 新增 `routes/admin-maintenance.js`，承载陈旧 PO18 清理和章节顺序修复维护任务。
  - `routes/reader-api.js` 从约 715 行降到约 399 行，已低于 500 行验收线。
  - `routes/bot-api.js` 从约 927 行降到约 859 行。
  - `routes/admin-content.js` 从约 1142 行降到约 981 行。
- P1-4 统一入参校验底座：
  - 新增 `services/validation.js`，提供 `httpError`、`badRequest`、`bodyString`、`bodyNumber`、`paramPositiveInt`、`enumValue`、`requireConfirm`、`compactJson`。
  - `routes/bot-api-system.js` 已接入 validation helper。
  - 新增 `tests/validation.test.js`。
- P1-5 浏览器冒烟底座：
  - 新增 `playwright.config.js`。
  - 新增 `tests/smoke/app-smoke.spec.js`。
  - 新增 `npm run test:smoke`，通过 `PO18_SMOKE_BASE_URL` 和 `PO18_SMOKE_READER_URL` 指向真实 3100/3200 实例。
  - 新增 devDependency `@playwright/test`，安装时使用 `--ignore-scripts`，不自动下载浏览器。
- P1-6 Docker build context 瘦身：
  - 新增 `scripts/check-build-context.js` 和 `npm run check:context`。
  - `.dockerignore` 继续排除 `tests`、`playwright.config.js`、`public/assets`、`cirno-src/docs`、`cirno-src/imgs`、`cirno-src/scripts`、`cirno-src/test`、`cirno-src/scf`、`cirno-src/yarn.lock`。
  - `npm run check:context` 当前估算：169 个文件，2.83 MiB，低于 80 MiB 阈值。
- 验证：
  - `node --check`：新增/改动 JS 文件通过。
  - `npm run check:context`：通过。
  - `npm test`：75 项通过、1 项 PG 环境缺省跳过。
  - `npm run admin:build`：通过。
  - `npm audit --omit=dev`：0 漏洞。
  - `npm audit`：0 漏洞。
  - `npx playwright --version`：1.60.0。

## 2026-06-05：P1 维护性与性能第二批

- P1-2 Bot 主入口达到行数验收线：
  - 新增 `bot/epub-builder.js`，拆出 EPUB 文件生成和 ZIP 构建。
  - 新增 `bot/po18-client.js`，拆出 PO18 Cookie、登录字段、书架和已购章节解析/抓取。
  - 新增 `bot/remote-storage.js`，拆出 WebDAV/PikPak 列表、搜索和 URL 编码。
  - 新增 `bot/ui-formatters.js`，拆出按钮、书卡、众筹卡、资产/导出报价、红包参数格式化。
  - 新增 `bot/text-share-utils.js`，拆出 HTML 清洗、章节正文、分享上传 payload、缓存 ID 提取和流写入工具。
  - 新增 `bot/task-runtime.js`，拆出后台任务队列、system_jobs 同步和任务审计回写。
  - 新增 `bot/health-server.js`，拆出 Bot `/health/live`、`/health/ready`、`/health/status`。
  - 新增 `bot/message-runtime.js`，拆出命令解析、冷却、Bot 审计包装和群聊长文本转私聊。
  - 新增 `bot/search-query.js`，拆出搜索参数和书号解析。
  - 新增 `bot/export-builder.js`，拆出 TXT/EPUB 导出文件构建。
  - 新增 `bot/task-schedulers.js`，拆出导出、PO18 书架同步、共享上传调度器。
  - `bot/telegram-bot.js` 降到 999 行，已低于约 1000 行验收线。
- P1-3 路由热点达到行数验收线：
  - 新增 `routes/admin-users.js`，承载用户、交易、反馈、众筹、CDK 管理路由。
  - 新增 `routes/admin-library.js`，承载后台书籍、章节和导出路由。
  - 新增 `routes/bot-api-users.js`，承载 Bot 用户、钱包、签到、交易、导出权限路由。
  - `routes/admin-content.js` 降到 387 行。
  - `routes/admin-users.js` 为 274 行，`routes/admin-library.js` 为 350 行。
  - `routes/bot-api.js` 降到 468 行，`routes/bot-api-users.js` 为 406 行。
  - `routes/reader-api.js` 保持 399 行。
- P1-4 validation helper 扩大接入：
  - `routes/bot-api-users.js` 已接入 `bodyString`、`bodyNumber`、`enumValue`、`trimString`，覆盖注册、货币调整、排行榜和交易分页。
  - 新增 Bot 用户接口级 400 JSON 测试。
- 新增模块测试：
  - `tests/epub-builder.test.js`
  - `tests/bot-adapters.test.js`
  - `tests/bot-ui-formatters.test.js`
  - `tests/bot-text-share-utils.test.js`
  - `tests/bot-runtime-modules.test.js`
- 验证：
  - `node --check`：本轮新增/改动 JS 文件通过。
  - `npm test`：84 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：183 个文件、2.84 MiB，低于 80 MiB 阈值。
  - `npm run admin:build`：通过。
  - `npm audit --omit=dev`：0 漏洞。

## 2026-06-05：P1 维护性与性能第三批

- P1-1 阅读器迁移到 Vite + Vue3：
  - `cirno-src/package.json` 从 Vue2 + Vue CLI 切到 `vue@3.5.35`、`vue-router@4.6.4`、`vuex@4.1.0`、`ant-design-vue@4.2.6`、`vite@8.0.16`。
  - 新增 `cirno-src/vite.config.mjs` 和 Vite 入口 `cirno-src/index.html`。
  - Docker reader-build 阶段改为 `npm run build:standalone`，不再调用 `vue-cli-service`。
  - 移除旧 Vue CLI 配置：`cirno-src/vue.config.js`、`cirno-src/babel.config.js`、`cirno-src/.eslintrc.js`、旧 `public/index.html`、旧 `VUE_APP_*` env 文件。
  - 兼容改造覆盖 `createApp`、Vue Router 4、Vuex 4、Ant Design Vue 4、旧 `v-model`、旧 slot、`this.$set`、`beforeDestroy`、`require('@/assets')`、Node `crypto` 和 `::v-deep`。
- P1-1 性能收口：
  - 繁简转换大字典从 Reader 静态包拆成动态 chunk。
  - `Reader` JS 从约 1.22 MiB 降到约 76.7 KiB；`chinese-convert` 仅在切换简体/繁体时加载。
  - `npm --prefix cirno-src run reader:build`：通过，构建约 1.5 秒。
  - reader 子项目 `npm --prefix cirno-src audit --omit=dev`：0 漏洞。
- P1-5 冒烟测试落地执行：
  - setup 面板补齐 `GET /health/live`。
  - 已用临时本地服务启动 3100 setup 面板和 3200 reader。
  - `npm run test:smoke`：2 项通过。
  - 本机缺 Chromium 时已执行 `npx playwright install chromium` 后复测通过。
- P1-6 构建上下文继续保持低位：
  - `npm run check:context` 当前估算：181 个文件，2.29 MiB，低于 80 MiB 阈值。
- 本批最终验证：
  - `npm test`：84 项通过、1 项 PG 环境缺省跳过。
  - `npm run admin:build`：通过。
  - `npm run check:context`：通过。
  - `npm audit --omit=dev`：0 漏洞。
  - `npm --prefix cirno-src audit --omit=dev`：0 漏洞。
  - `npm run test:smoke`：2 项通过。

P1 当前结论：

- P1-1 已完成：reader 已迁移到 Vite + Vue3，旧 Vue2/Vue CLI 依赖移除，reader build 通过。
- P1-2 已完成当前验收：`bot/telegram-bot.js` 为 999 行，低于约 1000 行验收线。
- P1-3 已完成当前验收：主要路由文件均低于 500 行，最大 `routes/bot-api.js` 为 468 行。
- P1-4 已完成当前验收底座：validation helper 已落地并覆盖 Bot 系统/用户域，后续继续扩展属于持续治理。
- P1-5 已完成当前验收：Playwright smoke 已在本地 3100/3200 临时服务上通过。
- P1-6 已完成当前验收：Docker build context 估算 2.29 MiB，低于 80 MiB 阈值。

## 2026-06-06：P2-2 到 P2-6 第一批功能落地

- P2-2 Bot 管理增强：
  - 后台 TG Bot 页新增“Bot 命令管理”，支持命令开关、说明文案、禁用回复和帮助预览。
  - `GET/PUT /admin-api/bot/commands` 写入统一配置，Bot 运行时读取并阻断禁用命令。
- P2-3 指标面板：
  - 系统页新增指标摘要，展示 HTTP 请求/错误、阅读器 API、Bot 队列、数据库连接池、备份事件和 Top 路径。
  - 接口为 `GET /admin-api/metrics/summary`。
- P2-4 搜索体验：
  - 后端新增 `GET /reader-api/search/suggest`，返回书名、作者、标签、热词建议。
  - 阅读器搜索弹窗接入建议 chips，书名建议可直达详情，作者/标签/热词可填入搜索。
- P2-5 数据导入导出：
  - 后台书籍、用户、流水页新增按当前筛选条件导出 CSV 入口。
  - 接口：`/admin-api/books/export.csv`、`/admin-api/users/export.csv`、`/admin-api/transactions/export.csv`。
- P2-6 远程备份：
  - 新增远程备份状态和上传接口：`GET /admin-api/backup/remote/status`、`POST /admin-api/backup/remote/upload`。
  - 支持 WebDAV、S3、R2；状态只暴露非敏感配置摘要。
  - 系统页备份区新增远程配置状态和单文件上传远程按钮。
- 文档：
  - `API.md` 已记录 Bot 命令、指标摘要、CSV 导出、远程备份、阅读器搜索建议。
- 验证：
  - `npm run admin:build`：通过。
  - `npm --prefix cirno-src run reader:build`：通过。

## 2026-06-05：v0.1 发版后阅读器目录弹层修复

- 修复阅读器详情/正文目录弹层样式丢失：
  - 移除旧 `dialogClass="cata-dialog"` 依赖，改用 Ant Design Vue 4 可用的 `wrapClassName="catalog-modal-wrap"`。
  - 增加内部 `.catalog-panel` 包裹层，让目录头部、封面、章节行、当前章节高亮等 scoped 样式稳定命中。
  - Modal 外层、内容层和 body padding 改用拆平的全局选择器，避免 `Less + :global` 嵌套编译把样式压错层级。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过。
  - `npm run test:smoke`：2 项通过。
  - `npm test`：84 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：182 个文件、2.30 MiB，低于 80 MiB 阈值。

## 2026-06-06：阅读器首屏与目录加载优化

- 首页/书架：启动时不再额外请求固定本地书架列表；签到状态直接从 `/reader-auth/me` 返回的 `last_sign_date` 判断，减少初始化等待。
- 详情页：书籍信息和章节目录并发加载，目录直接按 `book_id` 拉取；“是否在书架”改为首屏后异步检查。
- 后端：新增轻量接口 `GET /reader-api/me/bookshelf/:bookId/status`，详情页不再为判断一本书拉完整书架；书架列表响应移除详情页才需要的大字段，降低首页负载。
- 正文页：跳过本地固定的章节命令请求，正文解析后先渲染，间贴数量和阅读进度写入改为非阻塞补充。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过，详情目录样式仍进入 `BookDetail-*.css`。
  - `npm test`：89 项通过、1 项 PG 环境缺省跳过。
  - `npm run test:smoke`：2 项通过。
  - `npm run check:context`：186 个文件、2.35 MiB，低于 80 MiB 阈值。
  - `wenmoux/reader:v0.1` 已重新构建并推送，digest：`sha256:706c217a807710c99c7f0adf9bfd5de6a8f8eb23164e4876b4ef803fced7eb66`。

## 2026-06-06：P2-4 搜索体验与旧代码清理

- P2-4 搜索体验继续收口：
  - 新增 `cirno-src/src/utils/search-intent.js`，统一解析 `作者:`、`author:`、`a:`、`标签:`、`tag:`、`t:`、`#标签` 等搜索意图。
  - 首页搜索弹窗和书库页共用同一套搜索意图逻辑，减少后续维护分叉。
  - 作者/标签建议点击后进入书库筛选页，并保留建议站点或当前选择站点。
  - 书库页支持 `author/tag/platform` 组合筛选，修复从建议进入 `/library?tag=...&platform=...` 时 platform 被丢掉的问题。
  - 书库页手动搜索作者/普通关键词时会清掉旧标签筛选，避免旧筛选隐藏影响结果。
- 维护性和旧代码清理：
  - 删除旧 `Shelf.vue` 和旧 `registerServiceWorker.js`。
  - 清理旧 Shelf 注释、旧路由命名残留、无用 `perfect-scrollbar` 导入和未使用的书架切换弹层逻辑。
  - 首页组件名保持 `Index`，关于页书架跳转改为明确跳转首页。
- 测试补充：
  - 新增 reader API 路由测试，覆盖 `author + tag + platform` 组合筛选 SQL 和参数。
- 验证与发布：
  - `npm --prefix cirno-src run reader:build`：通过。
  - `npm test`：90 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：185 个文件、2.34 MiB，低于 80 MiB 阈值。
  - `npm run test:smoke`：2 项通过；同时修正 smoke 对 Vue 首屏渲染的等待方式，避免过早读取空 `body.innerText`。
  - `wenmoux/reader:v0.1` 已重新构建并推送，digest：`sha256:6ccb76944d37984ca8edfb1bf3d4525760fd08b7b462d6e4bd67a81027efca70`。

## 2026-06-06：v1.0 正式发布

- Docker 发布脚本默认标签从 `wenmoux/reader:v0.1` 切换为 `wenmoux/reader:v1.0`。
- `wenmoux/reader:v1.0` 已构建并推送到 DockerHub。
- digest：`sha256:106f78a3cb454afc502475205f4049af4fc7196cf29caeac71062d75ce429358`。

## 2026-06-06：v1.0 发布漂移修复与性能/Bot 可见性 follow-up

- 阅读器性能预算：
  - `/admin-api/metrics/summary` 增加 `reader_performance` 和 `reader_assets`。
  - `/metrics` 增加 `po18_reader_endpoint_p95_ms` 和 `po18_reader_endpoint_budget_ms`。
  - 后台系统页展示搜索、详情、目录、正文 p95 预算，以及 reader 最大 JS/CSS 资源预算。
  - 新增预算环境变量：`PO18_SEARCH_P95_MS`、`PO18_DETAIL_P95_MS`、`PO18_CATALOG_P95_MS`、`PO18_CHAPTER_P95_MS`、`PO18_READER_ENTRY_JS_BYTES`、`PO18_READER_ENTRY_CSS_BYTES`。
- Bot 任务状态可见性：
  - 后台 Jobs 页支持取消仍处于 `queued` 的任务。
  - 新增 `POST /admin-api/jobs/:id/cancel`。
  - 新增 `GET /bot-api/jobs/:id`，Bot 启动长任务前会检查后台是否已取消。
  - Bot 长任务消息补齐“已排队/开始执行/已取消/失败”提示，运行中任务不强杀，避免导出、恢复、上传留下半完成状态。
- 继续拆主文件：
  - 新增 `cirno-src/src/utils/reader-settings.js` 和 `cirno-src/src/utils/reader-tts.js`，`Reader.vue` 降到约 2521 行。
  - 云 TTS provider 现在进入后端合成队列，不再误落到浏览器朗读分支。
  - 新增 `bot/bot-session.js`、`bot/polling-runtime.js`、`bot/account-formatters.js`，`bot/telegram-bot.js` 降到约 925 行。
- 文档：
  - `API.md` 已补充任务取消、Bot 任务查询、阅读器性能预算指标和预算环境变量。
  - `PROJECT_COMPREHENSIVE_ASSESSMENT.md` 已更新 v1.0 后当前行数、状态可见性和下一步重点。
- 验证：
  - `npm test`：97 项通过、1 项 PG 环境缺省跳过。
  - `npm --prefix cirno-src run reader:build`：通过。
  - `npm run admin:build`：通过，后台 dist 已发布到 `public/`。
  - `npm run check:context`：190 个文件、2.37 MiB，低于 80 MiB 阈值。
  - `admin-ui/dist` 和 `public` 已复扫，未发现当前构建产物残留 `wenmoux/reader:v0.1`。
  - `npm run docker:build`：通过。
  - `npm run docker:push`：`wenmoux/reader:v1.0` 已推送，digest：`sha256:b7fc41a24466ff2d39f6020964e2ce49db23dd61247556163673ef75cfa3697f`。

## 2026-06-07：阅读页可选自定义章头与头图

- 阅读页设置面板新增“启用自定义章头和头图”：
  - 默认关闭，关闭时保持原阅读页标题和正文布局。
  - 支持自动从章节名拆出“第 N 章”和短标题，也支持手动覆盖章节数/标题。
  - 支持选择自定义头图；图片只写入当前浏览器 `localStorage`，不上传服务器、不进入仓库或 Docker 镜像。
  - 章头布局参考用户提供样式：左侧头图、右侧大章节号、圆角深色标题条，并补充移动端约束。
- 备份：
  - 原阅读页、阅读设置文件和参考素材已备份到 `backups/reader-custom-header-20260607-045446`。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过。
  - 本地 mock 后端加载 `/#/book?bid=mock&cid=184`：默认无自定义章头；勾选后显示“第184章 / 回国”，正文顶部 padding 切换为 `0px`。

## 2026-06-07：内置默认仙鹤章头图

- 从用户提供的 `自用仙鹤.styles` 中提取 `htmlTemplate` 里的 base64 仙鹤图，作为阅读器内置章头资源：
  - 新增 `cirno-src/src/assets/reader-crane-header.png`。
  - 自定义章头开启时，未选择自定义图片会自动使用内置仙鹤。
  - 用户上传自定义图片时仍优先使用用户图片；点击“恢复默认仙鹤”会清除浏览器本地图片并回到内置仙鹤。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过，产物包含 `reader-crane-header-*.png`。
  - 本地 mock 阅读页确认章头图片源为 `/static/reader-crane-header-*.png`。

## 2026-06-07：EPUB 导出章头同步仙鹤样式

- Bot EPUB 导出同步使用内置仙鹤章头图：
  - 新增 `bot/assets/reader-crane-header.png`，保证 Docker bot/app 阶段仅复制 `bot/` 时仍可导出章头图。
  - EPUB 包内新增 `OEBPS/Images/reader-crane-header.png`，所有普通章节复用同一图片资源。
  - 普通章节页从旧 `h2` 标题改为“左仙鹤、右章节号、标题胶囊”的章头结构。
  - 自动从章节名拆出“第 N 章”和短标题；拆不出时使用导出章节序号兜底。
  - 简介页、卷标题页、TXT 导出不受影响。
- 验证：
  - `node --test tests/epub-builder.test.js`：通过。
  - `node --test tests/bot-export-errors.test.js tests/bot-runtime-modules.test.js tests/epub-builder.test.js`：8 项通过。
  - 默认真实资源生成检查：EPUB 包含 358893 字节的 `reader-crane-header.png`，章节 HTML 引用正常。

## 2026-06-07：v1.0 镜像重新构建并推送

- 已重新构建并推送 `wenmoux/reader:v1.0`，包含阅读页内置仙鹤章头图和 EPUB 导出章头样式。
- digest：`sha256:51bbba9360f4684889b31e6edcb72b23313b4d4b7a02c7faf5d73735ad5baf2d`。
- 验证：
  - `npm run docker:build`：通过。
  - `npm run docker:push`：通过。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-07：书库填充与书架加载优化

- `/library` 书库网格从固定 `108px` 列改为自适应列宽，卡片居中分布，避免宽屏右侧大面积空白。
- `/library` 首屏拉取数量按视口估算，范围限制在 40-100，本地窗口变化时防抖重拉。
- `/library` 判断“已在书架”改走 `idsOnly=1` 轻量接口，只取 `book_id`，不再拉完整书架 metadata。
- 书架首页封面和搜索结果封面启用浏览器原生 lazy image decode；书架列表拿到数据后立即结束 loading。
- `/reader-api/me/bookshelf` 增加：
  - `idsOnly=1`
  - `limit` / `count`
  - `page`
- 普通书架查询改为 CTE：先分页取书架行，再只查询这些书的最新 metadata，减少大书架重复 metadata 扫描。
- 备份：`backups/library-fill-speed-20260607-101743`。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过。
  - `node --test tests/reader-api-routes.test.js`：7 项通过。
  - `npm test`：99 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.08 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `npm run docker:push`：`wenmoux/reader:v1.0` 已推送，digest：`sha256:7e939779c243035b59910cfbd36da87393959ccad9ead9810982257f5370cc07`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。
  - 本地浏览器访问 `/library` 在未登录状态正常跳转到 `/#/login?redirect=/library`。
  - `npm run check:context`：192 个文件、3.07 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `npm run docker:push`：`wenmoux/reader:v1.0` 已推送，digest：`sha256:ad14a3d63ed9e9a940d62bfca8980a3ae3119be89a62d538ab5920ca9314f133`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-07：书库首屏轻量化与下一页预取

- `/library` 首屏数量从上一版按视口 40-100 本调整为轻量一页：
  - 移动端约 12 本。
  - 桌面按宽度约 12-24 本。
  - 宽屏最多约两行，避免一次加载太多封面和 DOM 节点。
- 当前页加载完成后，浏览器空闲时后台预取下一页：
  - 预取内容只进入内存缓存。
  - 不直接追加到当前页，所以页面不会越刷越长。
  - 点击下一页时如果缓存命中，会直接显示，减少等待。
- 搜索、刷新、切换排序、切换分类、切换筛选、窗口尺寸导致 pageSize 变化时，会清空旧缓存，避免条件串页。
- 备份：`backups/library-progressive-page-20260607-183731`。
- 验证：
  - `npm --prefix cirno-src run reader:build`：通过。
  - `node --test tests/reader-api-routes.test.js`：7 项通过。
  - `npm test`：99 项通过、1 项 PG 环境缺省跳过。

## 2026-06-09：Bot 搜索默认全站点

- Telegram Bot 普通搜索不再默认限制 PO18：
  - `/search 关键词`、直接发关键词触发的隐式搜索，默认查询全部站点。
  - `/search 关键词 -po18`、`-qd`、`-fq` 等平台后缀仍可手动限制站点。
  - 未识别的平台后缀不再回退成 PO18，避免误过滤结果。
- `/hot` 和 `/random` 仍默认 PO18，避免推荐/随机入口跨站点变得过杂；显式平台后缀仍可覆盖。
- Bot 搜索继续使用 `cache_desc`，有正文缓存的书排在前面，没缓存的结果保留但靠后。
- reader-api 测试同步当前默认缓存过滤行为：作者/标签类无关键词筛选会默认要求 `cache_count >= 1`。
- 备份：`backups/bot-search-all-platform-20260609-024631`。
- 验证：
  - `node --test tests/bot-search-platforms.test.js tests/bot-runtime-modules.test.js tests/bot-ui-formatters.test.js tests/reader-api-routes.test.js`：15 项通过。
  - `npm test`：99 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.08 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `npm run docker:push`：`wenmoux/reader:v1.0` 已推送，digest：`sha256:9c02515191c600e1b611b8f3b9f7d2b68c7b4c1c0b24e2e804ed6f7ff23483fe`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-09：Bot 搜索过滤无缓存书籍

- Telegram Bot 搜索参数增加 `cache_min=1`：
  - `/search 关键词`
  - `/search #标签`
  - 直接发关键词触发的隐式搜索
- `/hot` 和 `/random` 也增加 `cache_min=1`，避免热门/随机推荐返回没有正文缓存、无法直接阅读的书。
- 保留上一版“普通搜索默认全站点，推荐/随机默认 PO18”的平台策略。
- 备份：`backups/bot-search-cache-only-20260609-213200`。
- 验证：
  - `node --test tests/bot-runtime-modules.test.js tests/bot-search-platforms.test.js tests/bot-ui-formatters.test.js tests/reader-api-routes.test.js`：15 项通过。
  - `npm test`：99 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.08 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `docker push wenmoux/reader:v1.0`：已推送，digest：`sha256:6c8972a134a91b7c7862450b9532d24f9adbc41ac3ad0833615b13b3d6c86102`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-09：Bot 搜索快查询与数据库超时排查

- 针对线上日志中的 `/reader-api/search?...cache_min=1&keyword=...` 超时，新增 reader-api 快查询模式：
  - `fast=1` / `fast_search=1` / `no_total=1` 会跳过精确 `COUNT(*)`。
  - 快查询实际取 `limit + 1` 条，用额外一条判断是否还有下一页。
  - 返回 `has_more` 和 `total_is_estimated`，Bot 分页仍可继续使用。
- Telegram Bot 普通搜索、热门、随机推荐均改为带 `fast=1`，避免关键词搜索在大元信息库里被总数统计拖慢。
- Bot 搜索结果数量在估算场景显示为 `5+`、`10+` 这类形式，避免把估算值当精确总数。
- 日志判断：`startup failed: fetch failed` 后续已恢复连接 Telegram；持续报错的核心是数据库连接超时，需要在部署环境检查数据库地址、网络和连接池可用性。
- 备份：`backups/bot-fast-search-20260609-220500`。
- 验证：
  - `node --test tests/bot-runtime-modules.test.js tests/bot-search-platforms.test.js tests/bot-ui-formatters.test.js tests/reader-api-routes.test.js`：16 项通过。
  - `npm test`：100 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.08 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `docker push wenmoux/reader:v1.0`：已推送，digest：`sha256:ab5860e16af5d58a890c36d0d0a98ffe25d90df903acac9d9488fd5c103f045d`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-09：后台核心数据增加有缓存书籍数

- 后台总览“核心数据”新增 `有缓存书籍` 卡片。
- 统计口径：`book_stats.cache_count > 0` 的去重 `book_id` 数量，用于快速判断元信息库里已有正文缓存覆盖的书籍规模。
- `/admin-api/stats` 新增字段：`cachedBooks`。
- 核心数据区从四列扩展为五列，窄屏仍自动折为两列/一列。
- 备份：`backups/cached-books-stat-20260609-223000`。
- 验证：
  - `node --test tests/admin-content-routes.test.js`：4 项通过。
  - `npm --prefix admin-ui run build`：通过。

## 2026-06-13：后台元信息编辑补全字段并防误触关闭

- 后台书籍元信息编辑弹窗补全 `book_metadata` 可维护字段：
  - 分类、字数、章节数、订阅/免费/付费章节、收藏/评论/读者/购买数。
  - 日/周/月/总人气、最新章节日期、简介 HTML。
  - 创建时间、更新时间以只读方式展示；保存时仍由后端维持现有安全策略。
- 新增书籍保存路径补充 `chapter_count` 和 `description_html`，避免前端填了但入库时被忽略。
- 通用表单弹窗默认不再点击遮罩关闭，只能通过关闭/取消/保存完成，降低编辑长表单时误触丢失风险。
- 备份：`backups/admin-book-editor-all-fields-20260613-001500`。
- 验证：
  - `npm --prefix admin-ui run build`：通过。
  - `node --test tests/book-chapters.test.js tests/admin-content-routes.test.js`：6 项通过。
  - `npm test`：100 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.09 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：首次 Docker Desktop/BuildKit 卡死，重启 Docker Desktop 后通过。
  - `docker push wenmoux/reader:v1.0`：已推送，digest：`sha256:f6bb6c4f551300a3e702b9ddec88830e3736790d4b643af7c0bbd487931b9b01`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。
  - `npm test`：100 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.09 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `docker push wenmoux/reader:v1.0`：已推送，digest：`sha256:43e28c357f7a67186a6759bd53519c209066aeeaee845f596aad7ec9417f6da1`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。
  - `npm test`：100 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.08 MiB，低于 80 MiB 阈值。
  - `npm run docker:build`：通过。
  - `docker push wenmoux/reader:v1.0`：已推送，digest：`sha256:490703cb50fcc2c7138aa34f5af7a0413ab371feb0838c37e7f50e7cc6ff321b`。
  - `docker buildx imagetools inspect wenmoux/reader:v1.0`：远端 digest 一致。

## 2026-06-10：后台章节/书按有缓存书籍计算

- 后台总览“核心数据”的 `章节/书` 口径调整：
  - 原口径：章节缓存总数 / 全部去重书籍数。
  - 新口径：章节缓存总数 / 有缓存书籍数。
- UI 提示改为 `按有缓存书籍计算`，避免把无正文缓存书籍计入平均覆盖。
- 备份：`backups/avg-chapters-cached-books-20260610-002500`。
- 验证：
  - `node --test tests/admin-content-routes.test.js`：4 项通过。
  - `npm --prefix admin-ui run build`：通过。

## 2026-06-16：后台新增书籍完整度统计与排序

- 后台总览“核心数据”新增 `完整度` 卡片。
- 统计口径：按去重 `book_id` 取最新/最大章节元信息，`book_stats.cache_count > 总章节数 * 80%` 的书计入完整度。
- 后台书籍列表排序新增 `完整度 ↓ / 完整度 ↑`，排序权重为 `缓存章节数 / 总章节数`，并保留缓存数作为同分兜底。
- `bookOrder()` 支持传入 `book_stats` 别名，修复完整度表达式在分页 CTE 和最终列表查询中的别名作用域问题。
- 阅读搜索 API 同步兼容 `complete_desc / complete_asc` 排序参数，避免共用排序服务后路由不一致。
- `API.md` 补充 `completeBooks` 返回字段和 `complete_desc / complete_asc` 排序参数说明。
- 备份：`backups/admin-completeness-stat-sort-20260616-172928`。
- 验证：
  - `node --test tests/admin-content-routes.test.js tests/book-chapters.test.js`：7 项通过。
  - `npm --prefix admin-ui run build`：通过。
  - `npm run admin:build`：通过，并发布到 `public`。
  - `npm test`：101 项通过、1 项 PG 环境缺省跳过。

## 2026-06-17：Setup 面板补齐配置导入

- Setup 面板新增 `导入配置` 区域，与已有 `导出配置` 对称。
- 支持选择或粘贴 `app.env`，先“填入表单”检查，也可以“导入并重启”直接写入 `/config/app.env`。
- 后端新增 `POST /setup/import`，只接收白名单配置项，忽略未知键；兼容旧配置里的 `BOT_TOKEN` 自动映射到 `TELEGRAM_BOT_TOKEN`。
- 导入时沿用现有必填校验，避免半截配置覆盖当前配置后导致容器启动失败。
- 导入成功后会设置新 `po18_setup_token` Cookie，并返回带新 token 的状态页地址，防止 token 变化后立即 401。
- 表单保存现在会保留导出配置中的 `PO18_SERVER_URL` / `PO18_API_BASE`。
- 备份：`backups/setup-config-import-20260617-021055`。
- 验证：
  - `node --test tests/control-panel.test.js`：4 项通过。
  - `npm test`：103 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.10 MiB，低于 80 MiB 阈值。

## 2026-06-17：PostgreSQL 恢复期启动重试与降噪

- 新服务器迁移/恢复数据库时，PostgreSQL 可能返回 `57P03`、`the database system is in recovery mode` 或 `not yet accepting connections`。
- 服务端启动初始化现在识别该类数据库不可用错误，并按 `PO18_STARTUP_DB_RETRY_MS` 退避重试，默认 5 秒，不再只失败一次。
- `/reader-api`、`/bot-api`、上传等请求遇到该类错误时继续返回 503，但响应文案改为 `Database is starting or recovering, please retry later`，并带上 PG code。
- health 服务把 `57P03` 折叠成 `PostgreSQL is starting or recovering`，setup 状态页/健康检查更容易判断是数据库恢复中，而不是应用代码崩溃。
- 备份：`backups/pg-recovery-startup-retry-20260617-023622`。
- 验证：
  - `node --test tests/health.test.js tests/control-panel.test.js`：9 项通过。
  - `node -c server-pg.js` / `node -c services/health.js`：通过。
  - `npm test`：104 项通过、1 项 PG 环境缺省跳过。
  - `npm run check:context`：192 个文件、3.11 MiB，低于 80 MiB 阈值。

## 2026-06-18：PO18 自动遍历与定时补缓存

- 后台新增“PO18 遍历”页面：
  - 可配置 PO18 Cookie、发现页范围、每次最多书籍、书籍并发、章节并发、请求间隔、定时间隔。
  - 支持立即运行、暂停、继续、停止和 Cookie 检测。
  - 默认上传元信息和新增章节，已有缓存章节跳过；可选择覆盖重抓。
- 后端新增 `services/po18-crawler.js`：
  - 参考 `wudi.js` 的 PO18 发现页、详情页、目录和正文解析逻辑。
  - 服务端直接写入 `book_metadata` / `chapter_cache`，复用现有 `upsertBook` / `saveChapter`。
  - Cookie 失效或返回登录/验证页时，运行任务进入暂停状态，等待后台更新 Cookie 后继续。
- 新增管理接口：
  - `GET/PUT /admin-api/po18-crawler`
  - `POST /admin-api/po18-crawler/run|pause|resume|stop|test-cookie`
- 任务中心：
  - 新增任务类型 `po18_crawler_run`。
  - 运行进度和结果写入 `system_jobs`，失败/取消后支持重试。
- 安全：
  - Cookie 存在 `admin_config`，状态接口和任务输入只返回脱敏摘要，不返回明文 Cookie。
- 备份：
  - `backups/po18-crawler-20260618-121143`。

## 2026-06-18：PO18 遍历来源模式与 Cookie 档案增强

- PO18 后台遍历新增四种来源：
  - `discover`：继续按 PO18 发现页分页遍历。
  - `bookshelf`：按已购书架 `/panel/stock_manage/buyed_lists` 遍历已购书籍章节。
  - `cache`：从已有 PO18 `chapter_cache.book_id` 反推更新，适合补已有缓存书。
  - `subscription`：按后台订阅列表固定更新，可粘贴一行一个 book_id。
- Cookie 处理改为档案模式：
  - 后台可选择当前 Cookie 档案，也可输入新 Cookie 并保存为指定档案名。
  - 服务端请求会合并 PO18 返回的 `Set-Cookie`，保留可复用的 Cookie 快照。
  - 接口和任务输入只返回脱敏 Cookie 档案状态，不回传明文 Cookie。
- PO18 章节顺序保存改为严格按网站目录显示编号，油猴脚本上传和后台遍历都会按传入的 `chapterOrder/chapter_order` 保存；`1,2,4` 会保持 `1,2,4`，不再补排成连续 `1,2,3`。
- 已生成 PO18 缓存率大于 90% 的订阅导入清单：
  - `tmp/po18-cache90-bookids.txt`：1433 个 book_id，一行一个，可直接粘贴到后台订阅列表。
  - `tmp/po18-cache90-books.json`：同批书籍的明细、缓存数和比例。
- 备份：
  - `backups/po18-crawler-cookie-modes-20260618-203111`。
- 验证：
  - `node -c services/po18-crawler.js` / `node -c services/book-chapters.js`：通过。
  - `node --test tests/po18-crawler.test.js tests/book-chapters.test.js`：11 项通过。
  - `npm run admin:build`：通过，并发布到 `public`。

## 2026-06-18：PO18 遍历并发状态与实时日志

- PO18 遍历运行状态新增实时并发指标：
  - `activeBooks`：当前正在处理的书籍数。
  - `activeChapters`：当前正在抓取/上传的章节数。
  - `chapterCandidates`：本次识别到的待处理章节候选数。
  - `currentChapterId/currentChapterTitle`：当前章节进度提示。
- 后端日志补充并发启动信息：
  - 书籍批处理会记录 `processing N books with book concurrency X`。
  - 每本书目录解析后会记录 `book {id} has N chapters to upload with chapter concurrency X`。
- 后台 PO18 遍历页新增“并发”状态卡，显示 `书 active/limit · 章 active/limit`，并在卡片下方展示当前书籍或章节。
- 后台运行日志新增实时刷新：
  - 运行中/暂停中每 1.5 秒刷新。
  - 空闲时每 5 秒自动刷新。
  - 提供手动“刷新日志”按钮和刷新状态提示。
  - 自动刷新只更新状态和日志，不覆盖正在编辑的 Cookie、订阅列表和配置表单。
  - 日志滚动条在用户停留底部时自动跟随，手动上翻后不会强行拉回底部。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js tests/book-chapters.test.js`：14 项通过。
  - `npm run admin:build`：通过，并发布到 `public`。
  - `npm test`：116 项通过、1 项 PG 环境缺省跳过。
- Docker：
  - 已构建并推送 `wenmoux/reader:v1.0`。
  - 远端 digest：`sha256:b7bf816da034f98bb9e6e2a912485ff88d8a4d2017bd3c5522f1aac8ae4c84be`。

## 2026-06-19：PO18 遍历请求重试

- PO18 后台遍历新增请求级自动重试：
  - 默认 `requestRetries=2`，即超时/网络失败后最多再试 2 次。
  - 默认 `requestRetryDelayMs=1200`，按尝试次数线性退避。
  - 适用于发现页、已购书架、详情页、目录页和章节正文请求。
  - Cookie 失效/登录验证页不做普通重试，仍按原逻辑暂停，等待后台更新 Cookie 后继续。
- 后台 PO18 遍历配置新增：
  - `请求重试次数`
  - `重试间隔（ms）`
- 后台运行状态新增 `请求重试` 统计卡，方便判断是否因为 PO18 响应慢或网络抖动导致重试。
- 日志新增 `request retry x/y after Nms: ...`，可直接看到每次重试。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js tests/book-chapters.test.js`：14 项通过。
  - `npm run admin:build`：通过，并发布到 `public`。
  - `npm test`：116 项通过、1 项 PG 环境缺省跳过。

## 2026-06-19：PO18 目录多页遍历修正

- 确认后台遍历不是固定只抓第一页：`fetchChapterList()` 会按 `1..pageNum` 请求 `/books/{bookId}/articles?page=N`。
- 修正 `pageNum` 计算逻辑，按 `wudi.js` 同源规则处理：
  - 若页面直接显示页数，例如 `共 3 頁`，按页数读取。
  - 若页面只显示章节总数，例如 `250 chapters` / 总章节数，则按 PO18 每页 100 章计算为 `Math.ceil(total / 100)`。
  - 若详情元信息里已有 `免費章回 + 付費章回`，也用总章节数兜底计算目录页数。
  - 继续兼容分页链接里的 `page=` 参数。
- 新增测试覆盖 250 章应遍历 3 页，避免超过 100 章的书只补第一页。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js tests/book-chapters.test.js`：15 项通过。
  - `npm test`：117 项通过、1 项 PG 环境缺省跳过。

## 2026-06-19：Bot 搜索无结果缺书需求提交

- Bot 搜索无结果时，回复新增“提交缺书需求”按钮。
- 用户点击后会提交搜索词、搜索类型、平台、Telegram 用户信息到服务端缺书需求列表。
- 服务端新增 `reader_search_requests` 表，并通过 `008_reader_search_requests` 迁移创建；同一用户、同一搜索词、同一平台和类型会去重。
- 新增 Bot 内部接口：
  - `POST /bot-api/search-requests`
- 新增后台接口：
  - `GET /admin-api/search-requests`
- 后台“反馈统计”页新增“缺书需求”表，显示搜索词、站别、类型、提交次数、用户数、最近用户和最近提交时间。
- `API.md` 已记录新增接口。
- 验证：
  - `node -c bot/telegram-bot.js` / `node -c bot/pg-bot-client.js` / `node -c routes/bot-api.js` / `node -c routes/admin-users.js` / `node -c pg-store.js`：通过。
  - `node --test tests/bot-ui-formatters.test.js tests/bot-api-routes.test.js tests/admin-content-routes.test.js tests/migrations.test.js`：13 项通过。
  - `npm run admin:build`：通过，并发布到 `public`。
  - `npm test`：118 项通过、1 项 PG 环境缺省跳过。

## 2026-06-19：PO18 详情页状态解析修正

- 修正 PO18 详情页状态读取：支持从 `dl.book_info_list` 的“狀態/状态”字段读取 `已完結(目前 N 章回)`。
- 修正章节页数误判：详情页评论区 `/view?page=N` 不再被当成章节目录分页，避免 52 章误扫 155 页这类情况。
- 使用用户提供的 PO18 详情页 HTML 回归验证：
  - 状态解析为 `完结`。
  - 章节数解析为 `52`。
  - 目录页数解析为 `1`。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js`：11 项通过。

## 2026-06-19：PO18 现有 Cookie 会话刷新重试

- 不新增浏览器 Cookie 上传接口，不从用户浏览器主动上传 Cookie。
- 后台遍历使用已配置 Cookie 时，遇到登录/验证页会先访问 PO18 首页、当前书详情页和发现页暖会话，再自动重试一次。
- 若重试后仍失败，仍按原逻辑暂停并提示更新 Cookie。
- Cookie 请求头发送前按浏览器 `document.cookie` 行为收敛为“同名最后值胜出”，减少复制 Cookie 或站点 `Set-Cookie` 后旧 token 混发。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js`：12 项通过。

## 2026-06-19：Bot PO18 登录验证码空图保护

- 修复 `/loginpo18` 在 PO18 验证码接口返回空 body 或页面内容时，仍调用 Telegram `sendPhoto` 导致 `Bad Request: file must be non-empty` 的问题。
- 验证码请求允许跟随跳转；登录 POST 仍保留手动跳转以捕获 Cookie。
- 发送图片/文件前增加空内容校验，错误会在本地变成可读提示，不再把空文件交给 Telegram。
- `/loginpo18` 会在验证码 HTTP 异常、空图片、返回 HTML/JSON/text 时给用户明确提示。
- 验证：
  - `node -c bot/telegram-bot.js` / `node -c bot/po18-client.js` / `node -c bot/telegram.js`：通过。
  - `node --test tests/bot-adapters.test.js`：4 项通过。
  - `npm test`：122 项通过、1 项 PG 环境缺省跳过。

## 2026-06-20：Bot PO18 登录提交修正

- `/loginpo18` 登录页改为手动跟随跳转并合并每一跳 `Set-Cookie`，避免 Node fetch 自动跳转时丢中间 Cookie。
- 登录表单解析改为读取所有 `<input name value>` 字段，包含 `_po18rf-tk001` 等隐藏 CSRF 字段，不再只解析固定字段。
- `/po18code` 登录 POST 增加 `Origin` 和 `Referer`，更贴近浏览器提交。
- Cookie 请求头按浏览器行为同名最后值胜出，减少旧值混发。
- 验证：
  - `node -c bot/po18-client.js` / `node -c bot/telegram-bot.js`：通过。
  - `node --test tests/bot-adapters.test.js`：5 项通过。
  - `npm test`：123 项通过、1 项 PG 环境缺省跳过。

## 2026-06-20：PO18 目录结构兼容与 Cookie 误判修正

- 对照 `po18_cli_upload.js` 补齐 PO18 当前目录结构解析：
  - 支持 `div[data-key] > div.c_l`。
  - 支持章节链接在 `.l_chaptname a` 内。
  - 保留旧版 `#w0 > div` 结构兼容。
- 目录页已有章节行但没有可上传链接时，不再直接判定 Cookie 失效，避免页面含“會員登入”入口文案时误暂停。
- 章节访问状态增加 `購買/购买` 识别。
- 新增回归测试覆盖当前 PO18 目录结构和“非可上传章节行不误判 Cookie”的场景。
- 验证：
  - `node -c services/po18-crawler.js`：通过。
  - `node --test tests/po18-crawler.test.js`：14 项通过。

## 2026-06-20：Bot 导出提示和低等级免费额度调整

- TXT/EPUB 导出完成后的文件 caption 和群聊进度提示精简为：
  - 书名。
  - `已导出 N 章`。
- 不再在导出完成提示里显示“本次扣费/每日免费额度/今日剩余”等尾句。
- 书圣等级免费导出规则调整：
  - LV1 每天 1 本。
  - LV2 每天 1 本。
  - LV3 及以上保持按等级数作为每日免费本数。
- `services/user-currency.js` 增加后端防线，即使外部传入旧的 LV2=2，也按 1 本执行；同一本当天重复导出仍复用额度。
- 验证：
  - `node -c bot/telegram-bot.js` / `node -c services/user-currency.js` / `node -c server-pg.js`：通过。
  - `node --test tests/user-currency.test.js`：4 项通过。
  - `node --test tests/bot-ui-formatters.test.js tests/bot-runtime-modules.test.js tests/bot-api-routes.test.js`：13 项通过。

## 2026-06-20：书卷等级升级速度放缓

- 默认 `PO18_SCHOLAR_EXP_BASE` 从 `120` 调整为 `1200`。
- 默认签到经验不变：连续 7 天分别为 `60/68/76/84/92/100/108`，平均每天 84 经验。
- 新默认曲线下：
  - LV1 -> LV2 需要 1200 经验。
  - LV2 -> LV3 需要 1656 经验。
  - 从 0 经验到 LV3 合计 2856 经验，连续签到约 34 天。
- 仍可通过环境变量覆盖：
  - `PO18_SCHOLAR_EXP_BASE`
  - `PO18_SCHOLAR_EXP_GROWTH`
  - `PO18_SIGN_EXP_BASE`
  - `PO18_SIGN_EXP_STREAK_BONUS`
- 验证：
  - `node -c server-pg.js`：通过。

## 2026-06-20：Bot PO18 已购共享补抓接入

- 修复 `共享 书号` 只共享本地缓存的问题：
  - 本地没有正文缓存时，若该书是 PO18 且用户已通过 `/loginpo18` 保存 Cookie，会自动用 PO18 登录态拉取已购章节正文再上传。
  - 未登录或拉不到已购章节时，提示先 `/po18set` 和 `/loginpo18`。
- Bot PO18 目录解析同步兼容当前页面结构：
  - 支持 `div[data-key] > div.c_l`。
  - 支持章节链接在 `.l_chaptname a` 内。
  - 保留旧正则兜底。
- PO18 已购章节共享时保留网站显示序号，上传 payload 增加 `chapterOrder`，避免 `1,2,4` 被重排成 `1,2,3`。
- 验证：
  - `node -c bot/po18-client.js` / `node -c bot/telegram-bot.js` / `node -c bot/text-share-utils.js`：通过。
  - `node --test tests/bot-adapters.test.js tests/bot-text-share-utils.test.js`：7 项通过。
