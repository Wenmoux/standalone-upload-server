# bot/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Telegram 交互边界与跨平台导出内核。消息与按钮回调在本模块归一化，通过 `PgBotClient` 访问 server API；TXT/EPUB 生成、计费格式与 HTTP 客户端同时供 `qq-bot/` 复用，模块内禁止建立数据库连接。

## 成员清单

`assets/`: Bot/EPUB 共用的旧仙鹤章头静态资源；只提供只读候选文件，不承载业务配置。
`account-view.js`: Telegram/QQ 共用账户展示模型，统一书卷等级和经验文案，不携带具体平台标记。
`book-card-view.js`: Telegram/QQ 共用书卡展示模型，统一字段回退、标签截断与统计口径，各平台只负责自身标记和按钮协议。
`account-handlers.js`: 账户交互层，提供注册保障、start/menu/help/reg/me/sign 处理，并消费私聊导出续接而不持有任务状态机。
`automatic-push-unpin.js`: 识别置顶服务消息中的频道自动转发与根级系统标记，并用精确消息 ID 容错取消置顶，拒绝触碰人工消息。
`commands/`: 按账户、搜索、导出、社交和外部集成拆分的命令注册器；命令名需与 `command-catalog.js` 同步。
`epub-styles/`: EPUB 视觉插件与资源契约；生成器注册五种样式（含兼容样式），Telegram 暴露四种直选按钮。
`account-formatters.js`: 把账户、签到、帮助及主/PO18 宫格面板转换为 Telegram HTML/inline keyboard，隔离展示规则与请求逻辑。
`bot-session.js`: 提供有界搜索查询缓存、按聊天与用户隔离且携带稳定发布键的短期书评草稿、管理员广播草稿及帮助文本，避免重试重复结算或群聊输入串线。
`broadcast-handlers.js`: 管理员全员通知交互与批量投递器，执行身份复核、草稿确认、收件人分页、限速发送和失败统计。
`command-catalog.js`: 命令名称、分组、帮助、别名、管理员与 Telegram 系统菜单显隐标记的单一元数据源，驱动后台配置、帮助和精简命令投影。
`command-registry.js`: 注册、别名解析、启停配置和显式白名单 Telegram command list 的运行时注册表，不实现具体业务。
`epub-builder.js`: 组装 EPUB 2 容器、原始/长屏封面、可选书籍信息页、全屏 spine、XHTML、目录、资源与样式插件；章页只拆分源标题已有的“第 X 章”，不按数组位置合成章号。
`epub-style-picker.js`: 定义 Telegram EPUB 直选样式白名单和 inline keyboard 回调协议，刻意不暴露兼容样式 `crane`。
`economy-handlers.js`: 用户经济交互层，转换 CDK、管理员发币、排行榜、流水和红包命令，并以 Telegram chat/message 生成稳定红包创建键；余额事务仍由 server API 裁决。
`export-builder.js`: 从 Bot 鉴权 API 分页读取缓存，并在 PO18 元信息显示缺章时补抓账号实际可读内容，以章节 ID 合并后按来源顺序流式生成 TXT 或调用 EPUB 生成器；TXT 保留源标题与合法顺序缺口。
`export-delivery.js`: 导出投递状态机，管理群聊私聊可达性探测、保留样式的 `/start` 续接、文件发送后幂等扣费和临时目录清理。
`export-errors.js`: 归一化导出失败码、私聊不可达特征、可重试语义和用户提示，避免 Telegram/网络/配额/内容错误在调用点分叉。
`health-server.js`: 提供 Bot live/ready/status 端点，将 polling 新鲜度与 server API 连通性折叠为健康状态。
`job-queue.js`: 提供进程内有界并发、同键互斥和取消信号；持久状态由上层 task runtime 负责。
`message-runtime.js`: 编排命令解析、普通文本回退与审计包装，将 Telegram update 转换为注册器调用。
`menu-handlers.js`: 功能面板 callback 分派器，把宫格入口委托给既有搜索、账户、任务和 PO18 处理器，不重复书籍卡片动作。
`pg-bot-client.js`: Bot 到 server-pg 的唯一 HTTP 客户端，封装 Bot Token、超时、缓存、动态平台读取、操作键和分页聚合。
`pikpak-handler.js`: PikPak 外部存储交互层，封装目录、搜索、WebDAV 下载流与 Telegram 临时文件投递。
`po18-account-handlers.js`: 处理仅私聊可用的 PO18 凭据绑定、验证码登录、受保护页状态验证、保留绑定登出和已购同步。
`po18-client.js`: 封装 PO18 上游会话、登录失效判定、页面改版容错与跨年已购访问，正文拉取会跳过已缓存免费章和标记为订购的未购章。
`polling-runtime.js`: 管理 Telegram getUpdates 长轮询、offset、退避和启动状态，不承载业务命令。
`process-runtime.js`: 编排命令同步、持久任务恢复、管理员广播轮询、健康服务与 polling 启动，把进程生命周期从业务组合根隔离。
`rate-limit.js`: 为搜索、详情、导出和集成命令提供按用户/动作的冷却时间计算。
`README.md`: 当前 Bot 启动、命令、任务和维护边界的运行文档。
`remote-storage.js`: 抽象共享文件的远端上传请求和错误处理，由共享任务调用。
`search-handlers.js`: 实现搜索、热门、词云、随机与详情交互，在解析前刷新动态平台，并区分全库元信息搜索与有缓存推荐。
`search-platforms.js`: 消费共享平台语义并吸收 Reader 动态平台配置，把 Telegram 后缀稳定映射到历史别名组。
`search-query.js`: 解析搜索词、中英文标签语法、动态平台后缀与书号，为普通搜索显式声明包含未缓存元信息。
`share-handlers.js`: 编排缓存先行的单书/跨年已购书架共享，免费章仅在本地和目标都缺失时补抓，付费章只上传账号实际可读内容并幂等结算奖励。
`social-handlers.js`: 实现收藏、红包、众筹及书评治理交互，以 Telegram 消息/草稿事实生成稳定发布键；私聊消费普通输入，群聊只消费手动回复，取消时清理提示且不遗留 ForceReply。
`task-runtime.js`: 把进程内队列映射到 `system_jobs`，负责 claim、lease、心跳、带分类原因的退避重试、恢复、取消、审计及 worker/attempt fencing token 回写。
`task-schedulers.js`: 定义导出、仅私聊 PO18 书架同步/共享和全员通知任务的持久类型、幂等键、互斥键与恢复工厂。
`task-status-handlers.js`: 提供 `/tasks`、`/task`、`/canceljob` 的状态查询与权限边界。
`telegram.js`: Telegram HTTP API 客户端，统一请求超时、消息编辑、文件发送和文本截断。
`telegram-bot.js`: Bot 业务组合根，只注入客户端、注册器、领域处理器、任务运行时并分派 update；进程恢复、polling 与健康启动委托 process-runtime。
`text-share-utils.js`: 规范长文本分享、书籍元数据和文件命名，隔离 Telegram 长度限制与 HTML 清洗。
`ui-formatters.js`: 生成书卡、分页、收藏、导出、书评发布/取消与投票等 Telegram HTML 和 keyboard。
`word-cloud.js`: 将热搜词统计渲染为受限尺寸图片，并提供字体/布局回退。

## 依赖与数据流

```text
Telegram update
  → polling-runtime / message-runtime
  → command-registry → commands + handlers
  → PgBotClient → server-pg:3100 → PostgreSQL
  → task-runtime ↔ system_jobs
```

- `command-catalog.js` 管声明，`commands/` 管注册，领域 handler 管行为；三者不可互相复制命令分支。
- `job-queue.js` 只管理单进程并发，跨重启/跨实例正确性由 `task-runtime.js` 与服务端 lease/fencing token 保证；恢复任务不得在 `onQueued` 阶段回写数据库状态。
- Bot 搜索平台每分钟从 `/reader-api/platforms` 刷新，同时复用 `services/platforms.js` 的内置别名；普通搜索包含未缓存元信息，热门、随机与导出仍以可读缓存为边界。
- EPUB 样式只扩展 `epub-styles/` 插件契约，ZIP、长屏封面、前置页、清单、全屏 spine、源章节标题和转义始终由 `epub-builder.js` 统一；样式不得补写来源中不存在的章号。
- 自动取消置顶只消费 `pinned_message.is_automatic_forward` 且携带根级系统标记的消息，并始终传入精确 `message_id`；普通群消息和未标记频道帖不受影响。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
