# PO18 Reader Stack 综合审计报告（2026-07-23）

> 当前事实优先级：代码/测试 → 运行时 `/openapi.json` → [README](README.md)、[Docker 手册](DOCKER.md) 与 [docs/](docs/README.md) → [API 说明](API.md) 与 [迁移手册](db/MIGRATIONS.md) → 历史报告。本报告取代旧报告中的测试数字、风险排序和“公开正文兼容面”等过期判断。

## 1. 审计范围与验证证据

本轮检查覆盖后端 routes/services、PostgreSQL 迁移、Admin、Reader、Telegram Bot、EPUB 导出、测试、发布链和文档系统。审计同时对照了 [2026-06-06 综合评估](PROJECT_COMPREHENSIVE_ASSESSMENT.md)、[2026-07-11 综合改善报告](PROJECT_COMPREHENSIVE_IMPROVEMENT_REPORT_2026-07-11.md) 与 [v2.0 优化进度](V2_OPTIMIZATION_PROGRESS.md)。

本机验证环境使用 Node `v24.18.0`。本轮未在本机执行 Docker 构建或真实 PostgreSQL 集成库；真实 PG 与 Docker smoke 仍由发布工作流承担。

已通过的本地验证：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 482 项，481 通过，1 项真实 PG 测试因未配置 `PO18_TEST_PG_URL` 跳过 |
| `npm run test:coverage` | 总行覆盖率 81.16%，分支 54.96%，函数 81.39% |
| `npm run lint` / `format:check` | 通过 |
| `check:docs` / `check:utf8` / `check:schema` | 通过；后续功能迭代最新迁移为 `025_reader_daily_chapter_quota` |
| `npm run admin:build` | 通过；Admin 主包 gzip 48.73 KiB，`TelegramView` chunk gzip 23.77 KiB |
| `npm --prefix cirno-src run build:standalone` | 通过；Reader 主包 gzip 70.31 KiB，`chinese-convert` gzip 496.14 KiB |
| `npm run check:context` | Docker 上下文估算 456 文件，11.35 MiB，低于 80 MiB |

## 2. 当前架构判断

系统已经从“可用脚本集合”进入“自托管产品”阶段：`server-pg` 是唯一业务入口，Bot 不直连数据库，Reader `3200` 只提供静态文件和 Reader Auth/API 代理，长任务进入 `system_jobs`，发布链只更新 `wenmoux/reader:v2.0`。

仍然不能把它定位成开放式多租户平台。核心原因不是 UI 或部署，而是书籍身份模型仍有平台无感 `book_id` 兼容路径；Manifest 已经拒绝可见跨平台同号冲突，但 `book_key` 迁移未完成前，新增跨平台写功能都必须谨慎。

综合评分：

| 维度 | 评分 | 判断 |
| --- | ---: | --- |
| 架构一致性 | 8/10 | 依赖方向清楚，`book_key` 是最大结构债 |
| 安全与权限 | 8/10 | 本轮关闭正文匿名导出和后台 Token 回显；仍需继续收紧任务重试授权 |
| 数据一致性 | 7/10 | 章节顺序唯一和合法缺口语义已清楚；跨平台身份仍未根治 |
| Admin UI | 8/10 | 高密度工具型方向正确，权限可见性更稳；仍有局部工作区可继续减负 |
| Reader UI | 7/10 | 已删除假功能，举报交互从阻塞 prompt 改为对话框；搜索竞态仍可优化 |
| Bot 交互 | 8/10 | 宫格面板、动态平台、书评、共享和导出均明显成熟；callback 启停权限仍需统一 |
| 测试与发布 | 8/10 | 覆盖率和门禁扎实；PR CI 的真实 PG/Playwright 仍不足 |
| 文档完整度 | 8/10 | GEB L1/L2/L3 生效；旧报告需要继续作为快照而非操作手册 |

## 3. 本轮直接改善

- Admin 权限收紧：非 owner 不再读取敏感配置、备份下载、CDK、API Token；Telegram Bot Token 不再回显，清除 Token 需要显式动作。
- Reader 正文收紧：`includeContent=1` 不再作为公开整本正文兼容面；Bot 改用 `/bot-api/books/:bookId/chapters/export` 内部鉴权分页端点。
- 回滚脚本加固：非法 steps、未知目标版本、缺失 rollback 文件在事务前拒绝，避免半截回滚。
- Reader 假功能清理：移除无后端事实源的票券、站点购买、间贴相关 UI/状态/图标。
- Reader 书评举报改为非阻塞 Modal，支持原因、字数、提交态和错误保留。
- Bot 导出补强：部分缓存时补抓 PO18 账号实际可读缺章，按章节 ID 合并，保留真实标题和合法顺序缺口。
- 图标子集生成器修复自扫描问题，当前 Reader 图标测试锁定源代码使用的 30 个图标。
- README、API、Bot README、架构、配置和文档索引已按当前事实更新。

## 4. 历史报告对账

已经关闭或显著改善：

- 旧 Vue2/CLI、依赖漏洞、TTS SSRF、CORS/CSRF、Session、默认生产配置、Setup Token 泄露、凭据明文、任务持久化、迁移双轨、备份校验、API Token 哈希、Admin RBAC、Docker 发布标签混乱、Bot 导出分页和 EPUB 样式漂移等问题。
- 7 月 11 日报告中的多数 P0/P1 已落为代码、测试和运行文档；旧报告仍作为问题来源快照保留。

仍开放：

- `book_key` 统一身份迁移。
- PR CI 中真实 PostgreSQL、Playwright/浏览器级端到端覆盖不足。
- Admin 若重试 owner 创建的高风险任务，仍需按任务类型做更细授权。
- Bot command disabled 目前主要约束斜杠命令，callback 按钮仍应映射到命令开关后统一判断。
- Reader 搜索旧请求覆盖新条件的竞态仍可在弱网中出现。
- 原始 HTML 调试路由虽然有 Reader 权限，但仍需从 CSP/sandbox 角度继续降低同源 XSS 风险。

## 5. 后续路线

P0：

- 设计并演练 `book_key`：先做碰撞审计，再迁移元信息、章节、书架、历史、书评、推送去重和任务输入，不允许静默选择同号书。
- Bot callback 与命令启停统一：建立 callback action 到 command 的映射，在 `handleCallback` 前做同一套 `registry.isEnabled()`。
- Admin 高风险任务重试授权按 job type 复核，restore、导入、清理类任务只允许 owner 或原创建者的同级权限。

P1：

- Reader 搜索引入 request sequence 或 AbortController，避免旧响应覆盖新条件。
- 为 PR CI 增加轻量真实 PostgreSQL 服务和关键 Playwright smoke，至少覆盖登录、搜索、阅读正文、Admin 登录和 Bot API 鉴权。
- 原始章节 HTML 调试端点增加更强隔离响应头，或改成下载/只读预览。
- 继续拆本地书库上传 CLI、`docker/control-panel.js` 和 Reader 转换报告脚本。

P2：

- Admin 后台继续做信息密度优化：任务结果用可读差异摘要，长表格保留筛选状态和批量操作预览。
- 平台筛选彻底由动态平台注册表驱动，减少硬编码站点列表。
- OpenCC 词典继续评估懒加载和分片，目标是降低 `chinese-convert` chunk，而不是恢复旧平行字表。

结论：当前 v2.0 适合作为个人/小团队可信自托管平台继续迭代，已经具备发布、恢复、审计、任务和文档回环的产品骨架。下一次真正的架构跃迁应优先做 `book_key`，否则功能越多，跨平台身份债会越难清。
