# PO18 Reader 综合评估与改善报告

生成日期：2026-06-06

## 1. 评估范围

本报告综合了当前代码扫描、旧版 `PROJECT_STATUS_AND_IMPROVEMENT_REPORT.md`、旧版 `PROJECT_OPTIMIZATION_AND_FEATURE_ROADMAP.md`、`API.md`、`README.md`、`DOCKER.md`、`db/MIGRATIONS.md` 以及最近更新记录。

扫描重点：

- 单镜像部署、初始化面板、Docker 运行路径。
- 后台管理、阅读器、Bot、上传 API、数据库迁移、备份恢复、任务中心。
- 代码规模、模块边界、测试覆盖、发布与敏感信息暴露风险。
- 从用户使用体验和开发维护体验两个角度评估后续改善点。

## 2. 总体结论

当前项目已经从“上传旁路服务”演进成完整的小说库运营套件。核心闭环已经具备：

- 单镜像 `wenmoux/reader:v1.0` 同时包含后台/API、阅读器和 Bot。
- 无数据库配置时进入初始化面板，保存配置后自动重启进入正常服务。
- 后台使用 Vite + Vue3，已覆盖书库、用户、交易、CDK、反馈、纠错、系统、任务中心、数据质量、Bot 概览、备份恢复。
- 阅读器提供搜索、详情、章节阅读、书架、历史、TTS、繁简转换、纠错。
- Bot 已支持搜索、导出、签到、钱包、收藏、红包、众筹、PO18 账号/书架同步、共享上传、审计和后台任务记录。
- PostgreSQL 已成为默认数据库，已有迁移系统、显式 rollback、`system_jobs`、`book_stats`、`bot_audit_logs`、`pg_trgm` 索引迁移。
- 后端已经完成 P1 级别模块化：`server-pg.js` 约 841 行，主要负责启动、依赖注入和路由挂载。

主要剩余问题不是“功能不够”，而是长期维护和公开部署质量：

- 阅读器已迁移到 Vite + Vue3 + ant-design-vue 4.x，Vue2/Vue CLI 依赖风险已清掉；后续主要是继续拆 `Reader.vue` 和优化 Ant 基础包。
- Bot 主入口 `bot/telegram-bot.js` 已降到约 925 行，达到 P1 行数验收线；后续可继续按 handler/场景拆细。
- 阅读器性能预算已接入系统页和 Prometheus，搜索、详情、目录、正文 p95 以及 reader 最大 JS/CSS 资源体积可持续观察。
- Bot 长任务已经具备排队、运行、成功、失败、取消的可见状态；后台可取消 queued 任务，Bot 启动任务前会检查取消状态并提示用户。
- 路由热点已拆到单文件 500 行以内，后续新增接口需要继续按领域落位。
- PO18 账号、cookie、备份文件等高敏数据还需要更强保护策略。
- 后台只有登录态，没有角色权限和统一管理员操作审计。
- 自动化测试已包含 Node 单元/路由测试和 Playwright 3100/3200 冒烟；PG 集成测试仍需外部 `PO18_TEST_PG_URL`。
- 本地 `backups/` 和旧扫描产物不会进 Docker 镜像，但如果手动打包整个目录仍可能暴露本地历史快照。

## 3. 当前架构快照

| 模块 | 当前状态 | 评价 |
| --- | --- | --- |
| Docker 单镜像 | `Dockerfile` 的 `app` 阶段包含 server、reader、bot、setup、healthcheck | 部署体验已经可用 |
| 初始化面板 | `docker/control-panel.js`，无配置时启动 `/setup` | 适合首次部署和后续改配置 |
| 后端主服务 | `server-pg.js` 约 841 行，挂载 `routes/` 与 `services/` | 已从超大单文件降到可控范围 |
| 管理后台 | `admin-ui/`，Vite + Vue3 | UI 风格统一，功能覆盖完整 |
| 阅读器 | `cirno-src/`，Vite + Vue3 | Vue2 构建债已清理，转换字典按需加载 |
| Bot | `bot/telegram-bot.js` + `bot/commands/*` | 功能强，仍需继续拆主入口 |
| 数据库 | `pg-store.js` + `db/migrations` + `db/rollbacks` | 已具备正式迁移和回滚基础 |
| 任务中心 | `system_jobs` + 后台 Jobs 页面 + Bot 上报 API | 已覆盖备份、恢复、榜单、Bot 长任务、维护任务；支持失败/取消任务重试和 queued 任务取消 |
| 可观测性 | `/health/*`、`/metrics`、结构化日志、系统页 | 排障基础明显提升 |
| 文档 | README/DOCKER/API/db migration/bot README + 本报告 | 需要继续保持 API 与实现同步 |

当前大文件热点：

| 文件 | 规模 | 风险 |
| --- | ---: | --- |
| `cirno-src/src/views/Reader.vue` | 约 2521 行 | 阅读、TTS 播放状态、滚动、章节处理仍耦合；设置和 TTS 纯逻辑已开始拆出 |
| `server-pg.js` | 约 841 行 | 启动、依赖注入、缓存和路由挂载仍集中 |
| `pg-store.js` | 约 641 行 | 初始化、迁移、兼容补丁继续增加会变重 |
| `bot/telegram-bot.js` | 约 925 行 | 已达 P1 线，后续可继续按 handler 拆细 |
| `routes/bot-api.js` | 468 行 | 已低于 500 行，需保持领域边界 |

## 4. 用户视角评估

### 4.1 部署与初始化

优点：

- 用户只需要一个镜像，映射 `3100`、`3200` 和 `/config` 即可启动。
- 不提前配置数据库时也能先进入安装向导，降低新用户拉取镜像后的门槛。
- `/setup/status`、后台系统页、`docker/status-check.js` 能检查 server、reader、bot、数据库和 token 配置。

问题：

- 首次部署仍依赖 setup token，日志过长时用户容易找不到 token。
- 如果用户手动打包整个目录给别人，`backups/`、`.alma/`、`.alma-snapshots/`、`tmp/`、`.env`、本地日志仍需要排除。
- 外部 PostgreSQL、反代域名、reader 公网 URL、Bot token 的关系还可以在 UI 里做更直接的诊断。

改善建议：

- setup 面板增加“重新显示当前 token 获取方式”和“一键复制当前访问 URL”。
- 系统页增加“分享前检查”，列出 `.env`、`backups`、本地数据库、日志、cookie 文件是否存在。
- 反代部署场景下增加 `PO18_PUBLIC_URL`、`PO18_READER_PUBLIC_URL` 的连通性检测。

### 4.2 后台管理体验

优点：

- Vite + Vue3 后台已替代旧静态后台，页面风格和 setup 面板一致。
- 书库、章节、用户、交易、CDK、反馈、纠错、榜单、任务、备份、数据质量、Bot 观测都已可视化。
- Jobs 页面能查看失败原因，支持部分失败/取消任务重试，并可取消仍在排队的任务。

问题：

- 删除书籍、改用户货币、恢复数据库、重启服务等高风险操作没有统一审计表。
- 大列表仍依赖手动筛选和分页，批量操作、保存视图、快速搜索体验还有提升空间。
- 真实浏览器端到端测试缺失，UI 改动主要靠构建和人工验证。

改善建议：

- 新增 `admin_audit_logs`：记录管理员、IP、动作、目标、变更前后摘要、结果和耗时。
- 加角色权限：只读、内容运营、财务/货币、系统维护、超级管理员。
- 对书库、用户、任务、交易页面增加保存筛选、导出当前筛选、批量操作二次确认。
- 增加 Playwright 冒烟：登录、切换主要页面、加载书籍、打开任务详情、发起备份预检查。

### 4.3 阅读器体验

优点：

- 阅读功能完整：搜索、详情、目录、正文、书架、历史、主题、TTS、纠错、繁简转换。
- `/reader` 已从 3100 跳转到 3200，后台和阅读器端口边界清楚。
- 正文 HTML 已加入清洗，TTS provider 已尽量走后端配置，安全性比早期更好。

问题：

- Vite + Vue3 构建已落地，reader build 当前约 1.5 秒，Vue2/Vue CLI 依赖已移除。
- `Reader.vue` 仍偏大，TTS 播放状态、滚动定位、章节渲染、快捷操作耦合；阅读设置和 TTS 纯逻辑已拆出一部分。
- Ant Design Vue 仍在基础包里占比较高，后续可做按页面/按组件拆包。
- 移动端、长书名、超长标签、章节列表宽度等体验仍需要持续细测。
- 系统页和 `/metrics` 已有阅读器性能预算：搜索、详情、目录、正文 p95，以及 reader 最大 JS/CSS 资源体积；浏览器侧 LCP/CLS/INP 仍未进入自动报告。

改善建议：

- 拆分 `Reader.vue`：章节数据、阅读设置、TTS、滚动定位、纠错弹窗、快捷键分别模块化。
- 将 Ant Design Vue 改为按组件/页面加载，降低 reader 首次 JS。
- 继续扩展性能预算：把当前接口 p95/资源体积预算延伸到真实浏览器 LCP、CLS、INP 和移动端截图报告。
- 对移动端书库、详情、目录、阅读页做 Playwright 截图回归。

### 4.4 Bot 体验

优点：

- Bot 功能完整，是除 Web 阅读器外的第二入口。
- 导出、PO18 书架同步、共享上传等长任务已进入后台任务中心，避免完全阻塞消息轮询。
- 群聊长结果能转私聊摘要，导出失败有错误码，后台能查看 Bot 审计和失败原因。

问题：

- `telegram-bot.js` 已继续拆到约 925 行，但仍是最大维护热点之一。
- Polling 模式适合单实例，但不适合多实例扩容。
- 导出、外部同步、上传仍可能受远端接口和本地缓存影响，用户反馈需要更明确。
- Bot 命令文档和实际命令模块需要持续同步。

改善建议：

- 继续拆 Bot：消息入口、callback 入口、导出编排、格式化、外部服务、错误提示分层。
- 将 Bot 长任务状态继续产品化：当前已提示排队、运行、取消、失败；下一步补后台/消息里的重试入口、取消入口和失败原因模板。
- 增加 webhook 模式作为可选部署方式，并明确单实例/polling 的边界。
- 后台 Bot 页增加“命令开关”和“命令帮助文案预览”。

### 4.5 数据、备份与安全

优点：

- PostgreSQL 默认方案统一，避免 SQLite/PG 双路径维护。
- `schema_migrations`、`db/rollbacks`、`npm run db:rollback` 已具备升级/回滚基础。
- 备份、上传 dump、恢复数据库已经有后台入口，并写入任务中心。
- 上传写入 API 和 Bot API 已改为 token fail-closed，避免空 token 放行。

问题：

- PO18 账号、密码、cookies、备份 dump 是最高敏数据，仍需要加密和生命周期策略。
- 备份文件默认在 `/config/backups`，如果服务器目录权限不当，风险较高。
- 管理员 session 和 token 策略可继续加强，例如过期时间、主动踢出、登录失败锁定。

改善建议：

- 对 `reader_po18_accounts` 的敏感字段做应用层加密，密钥来自 `/config/app.env`。
- 备份可选加密：导出 `.dump.enc`，恢复时要求 passphrase 或配置密钥。
- 系统页展示备份数量、总大小、最近成功时间、最近失败原因、保留策略。
- 增加生产配置检查：默认密码、短 secret、空 upload/bot token、公开 setup token 都应红色提示。

## 5. 开发者视角评估

### 5.1 后端与 API

当前优点：

- `routes/` 和 `services/` 已经把主服务拆到可维护状态。
- 核心共享逻辑已有测试：鉴权、配置、健康检查、榜单、备份、任务、TTS、章节维护、Bot API 等。
- 上传 API、Reader API、Bot API、Admin API 的边界比早期清楚。

待改善：

- 路由文件仍偏大，建议继续按领域拆分，例如 `admin/books`、`admin/users`、`admin/cdks`、`reader/auth`、`reader/books`、`bot/wallet`、`bot/social`。
- 入参校验仍多为手写判断，建议引入轻量 schema 校验函数或本地 validation helper。
- API 文档需要和路由测试绑定，避免新接口只写代码不写文档。

### 5.2 数据库与迁移

当前优点：

- `schema_migrations`、advisory lock、显式 rollback、PG 集成测试已经补齐。
- `book_stats` 降低搜索、榜单、书架、后台列表的实时统计压力。
- `system_jobs` 让长任务可观察、可诊断、部分可重试。

待改善：

- `pg-store.js` 仍包含初始化、兼容补丁、迁移执行等多种职责。
- 表字段枚举值仍可以加强 `CHECK` 约束，例如任务状态、交易类型、货币类型、审计状态。
- 大库下章节正文仍在 `chapter_cache`，长期可考虑正文分区或冷数据归档。

### 5.3 前端工程

当前优点：

- 后台已完成 Vite + Vue3 迁移，组件化基础已建立：`DataTable`、`FormModal`、`StatCard`、`StatusBadge`、`ToastHost`。
- 后台页面结构清晰，新增任务中心、数据质量、系统页后，运营能力明显增强。

待改善：

- 阅读器已完成 Vite + Vue3 迁移，当前最大技术债从构建栈转为 `Reader.vue` 继续组件化、Ant 基础包拆分和浏览器性能预算。
- 后台缺少端到端测试和视觉回归。
- 管理后台和阅读器还没有共享的 API 类型定义或响应契约。

### 5.4 Bot 工程

当前优点：

- 已有 `bot/command-registry.js` 和 `bot/commands/*`，命令注册开始模块化。
- 已有 `job-queue`、`rate-limit`、`export-errors`、`bot-audit`。
- Bot 只通过 HTTP API 访问后端，不直接连数据库，边界正确。

待改善：

- 主入口仍承担较多流程，但已拆出 `bot-session.js`、`polling-runtime.js`、`account-formatters.js`、`task-runtime.js`、`task-schedulers.js` 等模块。
- Bot 回归测试主要覆盖纯逻辑，缺少 Telegram update fixture 的完整流转测试。
- Webhook、多实例、后台发起 Bot 任务取消/重试、命令开关灰度还没有完整产品化。

### 5.5 测试与发布

当前优点：

- 根项目已有 `npm test`，覆盖 36 个测试文件。
- 最近记录显示：`npm test` 97 项通过、1 项 PG 环境缺省跳过；`npm --prefix cirno-src run reader:build` 通过；`npm run admin:build` 需要随后台改动固定执行。
- Docker 单镜像已发布到 `wenmoux/reader:v1.0`，最新 digest 以 `PROJECT_UPDATE_LOG.md` 发布记录为准。

待改善：

- 文档变更不需要运行全量测试，但代码变更应固定跑：`npm test`、`npm run test:pg`、`npm run admin:build`、必要时 reader build。
- 增加“API 文档覆盖检查”：路由新增后提示文档未更新。
- 增加 Docker build context 体积检查，避免扫描产物、日志、备份进入构建阶段。

## 6. 优先级改善路线

### P0：公开部署前必须收紧

| 编号 | 改善点 | 具体动作 | 验收标准 |
| --- | --- | --- | --- |
| P0-1 | PO18 敏感字段加密 | 加密账号密码、cookie、refresh 信息，密钥来自 `/config/app.env` | 数据库明文查询看不到真实 cookie/密码 |
| P0-2 | 管理员操作审计 | 新增 `admin_audit_logs`，覆盖删除、恢复、重启、改货币、改配置 | 后台可按管理员/动作/目标筛选审计 |
| P0-3 | 生产配置检查 | 检查默认密码、短 secret、空 token、公开 setup token、过宽 CORS | 系统页给出红色阻断或强提醒 |
| P0-4 | 备份安全 | 备份保留策略、可选加密、恢复前校验、恢复后记录审计 | 备份列表展示大小/时间/校验/来源 |

### P1：维护性和性能继续提升

| 编号 | 改善点 | 具体动作 | 验收标准 |
| --- | --- | --- | --- |
| P1-1 | 阅读器迁移 Vite + Vue3 | 重建 reader 构建链，逐页迁移 | 旧 Vue2 audit 风险基本清除，reader build 更快 |
| P1-2 | 拆 Bot 主入口 | update 入口、callback、导出、格式化、命令帮助分层 | `telegram-bot.js` 降到约 1000 行以内 |
| P1-3 | 继续拆路由大文件 | admin/book/user/cdk、reader/auth/books/tts、bot/wallet/social | 单个路由文件尽量低于 500 行 |
| P1-4 | 统一入参校验 | 新增 validation helper，替换重复手写校验 | 常见 400 错误格式一致 |
| P1-5 | 浏览器冒烟测试 | Playwright 覆盖 setup、后台、reader 关键流程 | PR/发布前可自动发现空白页和主要接口失败 |
| P1-6 | 构建上下文瘦身 | 忽略旧扫描产物、临时报告、日志和本地缓存 | Docker build context 明显下降 |

当前进度（2026-06-05 第一批）：

- P1-2：已抽出 `bot/search-platforms.js` 和测试，Bot 主入口继续减重，但 `telegram-bot.js` 仍需继续拆。
- P1-3：已抽出 `routes/bot-api-system.js`、`routes/reader-auth.js`、`routes/reader-tts.js` 和 `routes/admin-maintenance.js`；`reader-api.js` 降到约 399 行，已低于 500 行验收线；`bot-api.js` 降到约 859 行，`admin-content.js` 降到约 981 行。
- P1-4：已新增 `services/validation.js`，并接入 Bot 系统路由；后续继续覆盖 admin/reader/upload 高频接口。
- P1-5：已新增 Playwright 冒烟测试底座和 `npm run test:smoke`，后续需要在真实运行的 3100/3200 实例上执行。
- P1-6：已新增 `npm run check:context`，当前 Docker build context 估算 169 个文件、2.83 MiB。

当前进度（2026-06-05 第二批）：

- P1-2：已继续拆出 `bot/epub-builder.js`、`bot/po18-client.js`、`bot/remote-storage.js`、`bot/ui-formatters.js`、`bot/text-share-utils.js`、`bot/task-runtime.js`、`bot/health-server.js`、`bot/message-runtime.js`、`bot/search-query.js`、`bot/export-builder.js`、`bot/task-schedulers.js`、`bot/bot-session.js`、`bot/polling-runtime.js`、`bot/account-formatters.js`；`bot/telegram-bot.js` 已降到约 925 行，低于约 1000 行验收线。
- P1-3：已继续拆出 `routes/admin-users.js`、`routes/admin-library.js`、`routes/bot-api-users.js`；当前 `admin-content.js` 387 行、`admin-users.js` 274 行、`admin-library.js` 350 行、`bot-api.js` 468 行、`bot-api-users.js` 406 行、`reader-api.js` 399 行，均低于 500 行验收线。
- P1-4：`routes/bot-api-users.js` 已接入 validation helper，覆盖注册、货币调整、排行榜和交易分页；新增接口级 400 JSON 测试。
- P1-5：冒烟测试底座保留；本批未执行 `npm run test:smoke`，原因是本地未启动真实 3100/3200 服务和 Chromium 浏览器。
- P1-6：`npm run check:context` 当前估算 183 个文件、2.84 MiB，仍低于 80 MiB 阈值。
- 本批验证：`npm test` 84 项通过、1 项 PG 环境缺省跳过；`npm run admin:build` 通过；`npm audit --omit=dev` 0 漏洞。

当前进度（2026-06-05 第三批）：

- P1-1：阅读器已从 Vue2 + Vue CLI 迁移到 Vite + Vue3；`cirno-src/package.json` 移除 `@vue/cli-service`、`vue-template-compiler`、`core-js`、`register-service-worker` 等旧栈，升级到 `vue@3.5.35`、`vue-router@4.6.4`、`vuex@4.1.0`、`ant-design-vue@4.2.6`。
- P1-1：新增 `cirno-src/vite.config.mjs` 和 Vite 入口 `cirno-src/index.html`；Docker reader-build 阶段改为 `npm run build:standalone`，避免 DockerHub 构建继续依赖 Vue CLI。
- P1-1：已移除旧 Vue CLI 配置和旧 env 文件，包括 `vue.config.js`、`babel.config.js`、`.eslintrc.js`、旧 `public/index.html`、`.env.development`、`.env.production`。
- P1-1：Vue3 兼容改造已覆盖入口、router、store、Ant 插件、旧 `v-model`、旧 slot、`this.$set`、`beforeDestroy`、`require('@/assets')`、Node `crypto` 浏览器依赖和 `::v-deep` deprecated 写法。
- P1-1 性能：繁简转换字典从 Reader 静态包拆成动态 chunk；`Reader` JS 从约 1.22 MiB 降到约 76.7 KiB，转换字典 `chinese-convert` 仅在切换简体/繁体时按需加载。
- P1-5：setup 面板补齐 `/health/live`，已用临时本地 3100 setup 面板和 3200 reader 服务执行 `npm run test:smoke`，2 项通过。
- P1-6：`npm run check:context` 当前估算 181 个文件、2.29 MiB，低于 80 MiB 阈值。
- 本批验证：`npm --prefix cirno-src run reader:build` 通过，reader 生产依赖 audit 0 漏洞；`npm test` 84 项通过、1 项 PG 环境缺省跳过；`npm run admin:build` 通过；根项目 `npm audit --omit=dev` 0 漏洞；`npm run test:smoke` 2 项通过。

当前进度（2026-06-06 v1.0 follow-up）：

- 阅读器性能预算已进入系统页和 `/metrics`：搜索、详情、目录、正文 p95，以及 reader 最大 JS/CSS 资源体积。
- `Reader.vue` 继续拆出 `cirno-src/src/utils/reader-settings.js` 和 `cirno-src/src/utils/reader-tts.js`，当前约 2521 行；云 TTS provider 现在走后端合成队列，不再误落到浏览器朗读分支。
- Bot 任务状态可见性增强：任务支持 queued/running/succeeded/failed/canceled，后台 Jobs 可取消 queued 任务，Bot 启动任务前检查取消状态并提示用户。
- Bot 主入口继续拆出 `bot/bot-session.js`、`bot/polling-runtime.js`、`bot/account-formatters.js`，`bot/telegram-bot.js` 当前约 925 行。
- API 文档已记录 `POST /admin-api/jobs/:id/cancel`、`GET /bot-api/jobs/:id`、阅读器性能预算指标和相关环境变量。
- 本批验证：`npm test` 97 项通过、1 项 PG 环境缺省跳过；`npm --prefix cirno-src run reader:build` 通过。

### P2：体验和运营能力

| 编号 | 改善点 | 具体动作 | 验收标准 |
| --- | --- | --- | --- |
| P2-1 | 角色权限 | 超级管理员/运营/只读/财务/维护 | 高风险按钮按角色隐藏或禁用 |
| P2-2 | Bot 管理增强 | 命令开关、文案预览、失败重试指引 | 不改代码即可调整常用 Bot 行为 |
| P2-3 | 指标面板 | 把 `/metrics` 与后台图表结合 | 后台能看请求、失败、队列、任务趋势 |
| P2-4 | 搜索体验 | 同义词、作者页、标签页、最近热搜、错别字提示 | 用户能更快找到书 |
| P2-5 | 数据导入导出 | 书库元数据导出、用户/交易筛选导出 | 运营数据可迁移、可审计 |
| P2-6 | 远程备份 | WebDAV/S3/R2 上传备份 | 本地服务器损坏时仍可恢复 |

## 7. 文档与清理结论

保留文档：

- `README.md`：快速启动。
- `DOCKER.md`：部署和运行。
- `API.md`：接口文档。
- `db/MIGRATIONS.md`：迁移和回滚。
- `bot/README.md`：Bot 启动和命令概要。
- `cirno-src/docs/chinese-conversion.md`：繁简转换维护说明。

替换/删除文档：

- 旧 `PROJECT_STATUS_AND_IMPROVEMENT_REPORT.md` 内容过长，包含大量历史流水，已由本报告和 `PROJECT_UPDATE_LOG.md` 替代。
- 旧 `PROJECT_OPTIMIZATION_AND_FEATURE_ROADMAP.md` 与状态报告高度重复，已由本报告的路线图替代。
- `bot/BOT_FUNCTIONS_IMPLEMENTATION.md` 是 2026-05 旧阶段说明，包含过期路径和过期功能描述，已由 `bot/README.md` 与本报告替代。
- `cirno-src/docs/conversion-scans/` 为旧扫描产物，适合归档，不适合继续占用项目文档区和 Docker build context。

备份位置：

- 本轮整理前已备份到 `backups/docs-consolidation-20260605-204647`。

## 8. 下一步建议

建议下一轮保持两条线并行：P0 继续收安全，P1 继续收性能和可维护性。

1. PO18 账号/cookie 应用层加密。
2. 管理员统一操作审计。
3. 生产配置安全检查。
4. Reader.vue 继续拆分到章节渲染、TTS 播放状态、滚动定位、纠错选择等模块。
5. 阅读器 Ant Design Vue 按需拆包，降低基础 `index` chunk，并把 LCP/CLS/INP 纳入系统页或测试报告。

这五项完成后，项目会从“功能完整、能交付”进一步变成“可以更放心公开部署、后续迭代不容易回退”。

