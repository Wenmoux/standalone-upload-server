# bot/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Telegram 交互边界。消息与按钮回调在本模块归一化，通过 `PgBotClient` 访问 server API；耗时导出、书架同步、共享和注册用户全员通知写入 `system_jobs` 后由可恢复 Worker 执行，模块内禁止建立数据库连接。

## 成员清单

`assets/`: Bot/EPUB 共用的旧仙鹤章头静态资源；只提供只读候选文件，不承载业务配置。
`account-handlers.js`: 账户交互层，提供注册保障与 start/reg/me/sign 处理，并消费私聊导出续接而不持有任务状态机。
`automatic-push-unpin.js`: 识别置顶服务消息中的频道自动转发与根级系统标记，并用精确消息 ID 容错取消置顶，拒绝触碰人工消息。
`commands/`: 按账户、搜索、导出、社交和外部集成拆分的命令注册器；命令名需与 `command-catalog.js` 同步。
`epub-styles/`: EPUB 视觉插件与资源契约；生成器注册四种样式，Telegram 只暴露前三种直选按钮。
`account-formatters.js`: 把账户、签到、流水与排行榜领域数据转换为 Telegram HTML，隔离展示规则与请求逻辑。
`bot-session.js`: 提供有界搜索查询缓存、按聊天与用户隔离的短期书评/管理员广播草稿，以及按配置生成的帮助文本，避免分页回调携带过长原始查询或群聊输入串线。
`broadcast-handlers.js`: 管理员全员通知交互与批量投递器，执行身份复核、草稿确认、收件人分页、限速发送和失败统计。
`command-catalog.js`: 命令名称、分组、帮助、别名和管理员标记的单一元数据源，驱动后台配置与帮助展示。
`command-registry.js`: 注册、别名解析、启停配置和 Telegram command list 的运行时注册表，不实现具体业务。
`epub-builder.js`: 组装 EPUB 2 容器、原始/长屏封面、全屏 spine、XHTML、目录、资源与样式插件，是所有 EPUB 外壳逻辑的唯一实现。
`epub-style-picker.js`: 定义 Telegram EPUB 直选样式白名单和 inline keyboard 回调协议，刻意不暴露兼容样式 `crane`。
`economy-handlers.js`: 用户经济交互层，转换 CDK、管理员发币、排行榜、流水和红包命令，并以 Telegram chat/message 生成稳定红包创建键；余额事务仍由 server API 裁决。
`export-builder.js`: 从 server API 拉取缓存/已购章节并流式生成 TXT 或调用 EPUB 生成器，管理任务临时文件边界。
`export-delivery.js`: 导出投递状态机，管理群聊转私聊续接、EPUB 样式提示、文件发送后幂等扣费和临时目录清理。
`export-errors.js`: 归一化导出失败码、可重试语义和用户提示，避免网络/配额/内容错误在调用点分叉。
`health-server.js`: 提供 Bot live/ready/status 端点，将 polling 新鲜度与 server API 连通性折叠为健康状态。
`job-queue.js`: 提供进程内有界并发、同键互斥和取消信号；持久状态由上层 task runtime 负责。
`message-runtime.js`: 编排命令解析、普通文本回退与审计包装，将 Telegram update 转换为注册器调用。
`pg-bot-client.js`: Bot 到 server-pg 的唯一 HTTP 客户端，封装 Bot Token、超时、缓存和分页聚合。
`pikpak-handler.js`: PikPak 外部存储交互层，封装目录、搜索、WebDAV 下载流与 Telegram 临时文件投递。
`po18-account-handlers.js`: 处理 PO18 凭据绑定、验证码登录、状态和登出，只通过服务端加密凭据 API 工作。
`po18-client.js`: 封装 PO18 上游会话与已购内容访问，供账号和导出流程复用。
`polling-runtime.js`: 管理 Telegram getUpdates 长轮询、offset、退避和启动状态，不承载业务命令。
`rate-limit.js`: 为搜索、详情、导出和集成命令提供按用户/动作的冷却时间计算。
`README.md`: 当前 Bot 启动、命令、任务和维护边界的运行文档。
`remote-storage.js`: 抽象共享文件的远端上传请求和错误处理，由共享任务调用。
`search-handlers.js`: 实现搜索、热门、词云、随机与详情交互，协调平台参数、分页缓存和按钮卡片。
`search-platforms.js`: 定义支持的平台后缀、默认平台和展示名称，保持命令与回调参数一致。
`search-query.js`: 解析搜索词、标签、平台后缀与书号，集中处理用户输入边界。
`share-handlers.js`: 编排单书/书架共享、上传进度与奖励结算，通过幂等任务避免重复奖励。
`social-handlers.js`: 实现收藏列表、红包、众筹、私聊普通输入/群聊手动回复收集且取消时清理提示的书评发布、举报和申诉交互层；禁止 ForceReply 遗留客户端回复状态。
`task-runtime.js`: 把进程内队列映射到 `system_jobs`，负责 claim、lease、心跳、重试、恢复、取消、审计及 worker/attempt fencing token 回写。
`task-schedulers.js`: 定义导出、书架同步、共享和全员通知任务的持久类型、幂等键、互斥键与恢复工厂。
`task-status-handlers.js`: 提供 `/tasks`、`/task`、`/canceljob` 的状态查询与权限边界。
`telegram.js`: Telegram HTTP API 客户端，统一请求超时、消息编辑、文件发送和文本截断。
`telegram-bot.js`: Bot 组合根，只注入客户端、注册器、领域处理器、任务运行时、polling 与健康服务，并分派 update；不持有账户、经济、导出或外部存储规则。
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
- EPUB 样式只扩展 `epub-styles/` 插件契约，ZIP、长屏封面、清单、全屏 spine 和转义始终由 `epub-builder.js` 统一。
- 自动取消置顶只消费 `pinned_message.is_automatic_forward` 且携带根级系统标记的消息，并始终传入精确 `message_id`；普通群消息和未标记频道帖不受影响。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
