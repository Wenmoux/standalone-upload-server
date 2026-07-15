# tests/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Node.js 契约与回归测试层；路由测试使用受控依赖替身，`pg-flows` 与发布工作流另行覆盖真实 PostgreSQL 和容器边界。

## 成员清单

- `smoke/`: Playwright 真实浏览器烟雾测试；成员见 [smoke/CLAUDE.md](smoke/CLAUDE.md)。

- `admin-audit.test.js`: 管理审计 actor/target/reason、查询、过滤与脱敏契约。
- `admin-lazy-workspace.test.js`: Admin 页内工作区按需加载、并发去重、失败重试与缓存刷新语义。
- `admin-auth-routes.test.js`: Admin 登录、会话、角色和 CSRF 路由契约。
- `admin-exports.test.js`: Admin CSV 公式注入防护、编码、文件名与响应协议。
- `admin-content-routes.test.js`: 管理端书籍、章节与 Reader/Bot 管理员授权路由契约。
- `admin-modules.test.js`: Admin 领域服务组合与边界回归。
- `admin-ui-contract.test.js`: Admin 导航、会话恢复、无障碍公共控件、非阻塞输入与高密度工作区分层契约。
- `api-tokens.test.js`: API Token 创建、哈希、权限与吊销语义。
- `auth-service.test.js`: 密码、会话用户和管理员鉴权服务。
- `backups.test.js`: 备份索引、保留、远端上传与恢复演练状态。
- `body-limits.test.js`: 分路由请求体限制、旧身份入口无类型 JSON 与兼容隔离语义。
- `book-chapters.test.js`: 章节读取、写入、顺序与缓存行为。
- `book-crowd.test.js`: 书籍反馈、众筹榜单、服务端成本、重复支持与事务回滚语义。
- `book-manifest.test.js`: 书籍清单导入导出、校验和及确认边界。
- `book-maintenance.test.js`: 陈旧 PO18 书籍预览、事务锁定、平台隔离清理与回滚。
- `book-social.test.js`: 书评幂等发布扣费、操作键冲突、投票奖励、频率限制与权限语义。
- `bot-adapters.test.js`: Bot 外部适配器的请求和错误规范化。
- `bot-api-routes.test.js`: Bot API 账户、书籍、书评操作键、任务及 Worker fencing token 路由契约。
- `bot-audit.test.js`: Bot 管理操作审计记录。
- `bot-command-registry.test.js`: 命令目录、注册器和别名一致性。
- `bot-entry-handlers.test.js`: Bot 账户/经济/导出/PikPak 处理器的私聊续接、发送后结算、权限与文案契约。
- `bot-library.test.js`: Bot PO18 加密凭据、书架、缺书请求与分享事实持久化用例。
- `bot-menu-handlers.test.js`: Telegram 精简系统命令、宫格面板与 callback 领域委托契约。
- `bot-settings.test.js`: Bot 命令目录配置清洗、去重、合并与持久化语义。
- `bot-export-errors.test.js`: 导出错误分类与面向用户消息。
- `bot-job-queue.test.js`: Bot 持久任务队列提交与状态迁移。
- `bot-runtime-modules.test.js`: Bot 运行模块装配、搜索缓存、短期书评/管理员广播草稿、批量投递与依赖边界。
- `bot-search-platforms.test.js`: 搜索平台参数和别名解析。
- `bot-search-social-handlers.test.js`: 搜索与社交交互契约，覆盖私聊输入、群聊手动回复、书评草稿隔离、稳定发布键、失败保留及取消清理。
- `bot-task-runtime.test.js`: 持久任务领取、执行、续租、fencing token 回写和完成语义。
- `bot-task-status-handlers.test.js`: 任务查询、详情与取消命令。
- `bot-text-share-utils.test.js`: 文本分享切分、长度与文件名规则。
- `bot-ui-formatters.test.js`: Telegram 文案、书卡/书评发布按钮和转义格式。
- `chapter-maintenance.test.js`: 章节维护领域操作。
- `chapter-title-cleaner.test.js`: 标题清洗规则与幂等性。
- `clean-chapter-titles-script.test.js`: 标题清洗 CLI 参数与执行边界。
- `config-service.test.js`: 配置解析、默认值和安全校验。
- `control-panel.test.js`: Setup 控制面配置、鉴权、脱敏和诊断契约。
- `credential-crypto.test.js`: 外部账户凭据加解密与密钥轮换。
- `csrf.test.js`: CSRF 来源、旧版登录/注册内容类型与已有会话兼容、受保护写请求拒绝判定。
- `db-errors.test.js`: PostgreSQL 错误到 HTTP 语义的规范化。
- `docker-release.test.js`: 镜像标签、来源身份和发布清单规则。
- `docs-check.test.js`: Markdown 目标解析、断链识别和多语言源码 L3 完整性门禁。
- `epub-builder.test.js`: EPUB 长屏封面、全屏 spine、分卷目录、制作说明、标题去重与样式注入契约。
- `epub-style-picker.test.js`: EPUB 样式选择、默认值和兼容别名。
- `epub-style2-assets.test.js`: 老二次元样式资源解析与回退。
- `events.test.js`: 领域事件发布和监听隔离。
- `health-routes.test.js`: liveness、readiness、deep health HTTP 契约。
- `health.test.js`: 健康聚合服务与依赖状态。
- `hot-keywords.test.js`: 热词规范化、一次批量合并、串行累积和稳定排序。
- `http-security.test.js`: 生产绑定、Metrics Token 与安全响应头。
- `job-retry.test.js`: 持久任务重试分类、退避和耗尽行为。
- `local-library-upload.test.js`: 本地书库上传解析与批次状态。
- `migrations.test.js`: 迁移顺序、回滚配对和不可变约束。
- `network-security.test.js`: 出站 URL、私网与代理安全规则。
- `openapi-error-response.test.js`: OpenAPI 索引与统一错误响应契约。
- `pg-bot-client.test.js`: Bot HTTP 客户端分页、鉴权、书评操作键和错误映射。
- `pg-flows.test.js`: 真实 PostgreSQL 迁移、书评/红包幂等事务、领域流与查询计划集成测试。
- `po18-account-handlers.test.js`: PO18 账号绑定、验证码与书架命令。
- `po18-crawler-http.test.js`: 爬虫 HTTP 封装、Cookie 与错误策略。
- `po18-crawler.test.js`: PO18 配置/策略/运行状态/数据库来源边界、解析、抓取与落库流程。
- `process-supervisor.test.js`: 子进程重启退避、信号和退出策略。
- `rank-routes.test.js`: 排行 HTTP 参数与响应契约。
- `rank.test.js`: 排行聚合、窗口与并列规则。
- `rate-limit.test.js`: 内存限流窗口和响应元数据。
- `reader-api-routes.test.js`: Reader 查询、内容、会话和权限路由。
- `reader-account.test.js`: Reader CDK 注册、密码/Telegram 身份、Bot 注册奖励、邀请和批量导入事务。
- `reader-check-in.test.js`: Reader/Bot 签到行锁、周期、奖励流水与回滚原子性。
- `reader-icon-subset.test.js`: Reader 图标子集与产物约束。
- `reader-navigation.test.js`: Reader 章节导航与边界定位。
- `reader-offline.test.js`: 离线缓存、更新与失效策略。
- `reader-pwa.test.js`: PWA manifest、Service Worker 与安装资源。
- `reader-proxy.test.js`: Reader 3200 到 3100 代理的公网 Host、协议与 CSRF 来源传递契约。
- `reader-rum.test.js`: Reader 性能事件采样和写入。
- `reader-settings-mixin.test.js`: Reader 阅读设置状态机下沉、组合根接线与职责隔离契约。
- `reader-virtual-list.test.js`: 虚拟章节列表窗口计算。
- `red-packets.test.js`: 红包参数、创建幂等、定向结算、重复领取、过期退款与事务回滚。
- `review-governance.test.js`: 书评举报、申诉、审核与状态机。
- `schema-drift.test.js`: schema snapshot 与迁移目录一致性。
- `schema-validation.test.js`: 高成本请求体 JSON Schema 注册与拒绝契约。
- `search-benchmark.test.js`: 搜索基准预算和结果解析。
- `server-runtime-modules.test.js`: server-pg 下沉模块的成长/值清洗/纠错/观测/书评频道防重/启动重试与 HTTP 管线顺序契约。
- `share-handlers.test.js`: TXT/EPUB 分享、样式选择与投递流程。
- `source-health.test.js`: 内容来源熔断与健康评分。
- `startup-gate.test.js`: 数据库迁移及应用初始化期间的业务流量拒绝、健康放行与就绪切换契约。
- `system-jobs.test.js`: 持久任务创建、幂等、原子取消、领取租约、worker/attempt fencing、回滚和指标状态机。
- `telegram-push.test.js`: Telegram 推送类型、注册用户收件人分页、批次和失败恢复。
- `test-runner-script.test.js`: 根测试发现器和覆盖率门槛。
- `tts.test.js`: TTS 供应商、分段与代理安全。
- `upload-api-routes.test.js`: 上传鉴权、元数据、章节和删除路由。
- `user-currency.test.js`: 货币、签到、兑换、红包与幂等账本。
- `validation.test.js`: 通用输入校验与分页边界。
- `word-cloud.test.js`: 热词聚合、停用词和 SVG/图片输出。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
