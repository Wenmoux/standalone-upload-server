# PO18 Reader 简化更新记录

> 文档状态：持续维护的阶段级变更记录，不是部署手册。当前运行事实依次以代码/测试、运行时 `/openapi.json`、[README](README.md)、[Docker 手册](DOCKER.md)、[当前文档索引](docs/README.md)、[API 说明](API.md) 和 [迁移手册](db/MIGRATIONS.md) 为准。

更新时间：2026-07-15

说明：本文件只保留阶段级更新，不再记录旧报告里的每条细碎构建流水。完整旧记录已备份到 `backups/docs-consolidation-20260605-204647`。

## 2026-07-15：Bot 群聊 EPUB 私聊续接错误语义

- Telegram `PEER_ID_INVALID` 归入私聊不可达，而非 `EXPORT_UNKNOWN`；群聊导出不再误报 EPUB 构建失败，也不会对该确定性错误自动重试，而是直接提供保留书号与样式的 `/start` 续接按钮。
- 网络/DNS/后端超时仍按任务退避重试，提示明确标为临时网络或后端异常并附分类原因，避免与 EPUB 模板生成失败混为一谈。

## 2026-07-15：Reader 繁转简语义与用户词表优化

- 繁转简改由 OpenCC `twp -> cn` / `tw -> cn` 主导，删除约 2,400 字的平行覆盖表和 800 篇整文 LRU；项目仅保留小型残留表、编译词组扫描及小说上下文补丁，简转繁能力继续兼容。
- 阅读设置增加默认开启的台湾用语转换和本地用户词表；词表支持繁简来源、`原词=>目标` 覆盖及同值专名保护，动态私用区占位避免与原文字符冲突，输入以 250ms 防抖重建当前章。
- 新增转换语义契约测试；本地报告在没有人工正文时使用内置语料，并把编码替换符、异常残留、段落/分片残留和二次转换差异纳入失败退出码。当前内置基准 11/11，异常残留与二次差异均为 0。

## 2026-07-15：Reader 章节与间贴状态机下沉

- 新增 `mixins/reader-chapter.js`，集中书籍/目录初始化、正文请求与旧内容解密、购买、最近阅读记录和离线固定；解密/解析失败进入可重试错误态，请求世代同时拦截迟到响应和已排队的旧章节渲染回调。
- 新增 `mixins/reader-tsukkomi.js`，集中段落间贴加载/失败/空状态、分页、点赞/点踩与发布入口；请求同时绑定序号、章节、段落和页码，快速切换或关闭侧栏时，迟到响应不能覆盖当前列表或重建已关闭滚动区。
- 删除未被模板、mixin 或工具消费的 `contentWidth`、`chapterCache`、`cataMarginLeft` 与章节 ID 镜像状态；Reader 组合根继续只保留页面布局、组件引用及各领域 mixin 的装配职责。

## 2026-07-15：Reader 阅读设置状态机下沉

- 将阅读设置持久化、主题变量、章节头图、繁简转换和正文显示重建从 `Reader.vue` 下沉到 `mixins/reader-settings.js`；组合根继续拥有章节请求与局部组件编排，不再直接依赖设置常量、正文转换工具和内置头图资源。
- 纠错和 TTS mixin 继续通过 Vue 组合根复用字符计数、正文转换和设置数据，避免产生第二套状态；设置加载与转换 watcher 保持原生命周期，外部界面与本地存储键不变。
- 增加源码接线契约回归并以 Reader 生产构建验证模板、mixin 合并和动态繁简转换边界；超大阅读页仍高于重构阈值，后续能力继续优先下沉而不扩大组合根。

## 2026-07-15：Bot 书评端到端幂等收口

- 书评草稿以 Bot 提示消息、直接命令以用户消息生成稳定操作键；发布事务先取得 advisory lock，再复用 `reader_operation_ledger`，同键重试只恢复原书评/流水/余额，异参复用明确返回冲突。
- 发布扣费流水写入唯一 `operation_key`，频率限制只裁决首次发布；服务端已提交但 HTTP 回包中断时，重试不会再建书评或重复扣铜。
- 频道外发增加数据库原子认领，已发送或正在发送的书评不会重复投递；失败状态允许重试，异常卡住的 `sending` 状态在 2 分钟后可重新认领。
- 增加 Bot 操作键透传、草稿重试、领域账本冲突、频道并发认领及真实 PostgreSQL 回归；复用既有 019 操作账本，无新增迁移。

## 2026-07-15：Bot 热词批量写入收口

- `POST /bot-api/hot-keywords` 的最多 500 行导入从逐行反复读写改为一次读取、内存归并、一次写回，响应增加实际配置写入次数 `writes`。
- 单条与批量累积共享同一串行更新队列，避免同进程并发搜索互相覆盖；配置读取上限与实际 200 条持久化容量统一。
- 增加有效批量只委托一次、超限请求零写入、重复词归并和并发累积回归；PO18 账号、Cookie、书架、缺书请求与持久任务仍由 PostgreSQL 承载，验证码/草稿/分页键继续保持有界短时内存状态。

## 2026-07-15：Bot 书库持久化边界下沉

- 新增 `services/bot-library.js`，集中 PO18 加密账号读取/保存/删除、书架增删查、缺书请求幂等更新和书籍分享事实；凭据解密与字段清洗不再散落在 HTTP 路由。
- `routes/bot-api-library.js` 从 340 余行缩至约 150 行，只保留 Bot Token、路径参数、响应包装和热词/词云协议，SQL 全部退出路由层；外部 API 路径与响应字段保持不变。
- 明确短时内存状态边界：验证码挑战、交互草稿和分页缓存无需跨重启恢复；用户账号、Cookie、书架、缺书请求、任务和业务事实继续持久化。
- 增加领域服务与路由委托回归，覆盖公开/特权凭据投影、加密保留、书架、字段规范化、缺书请求插入/更新及分享事件。

## 2026-07-15：Bot 红包与社交事务收口

- `routes/bot-api.js` 收缩为纯组合边界，红包、反馈/众筹/书评、PO18 凭据/书架/检索分别进入独立协议路由；余额和互动状态机下沉到领域服务。
- 红包创建使用 Telegram 消息稳定幂等键和操作账本，同键重试不重复扣款、异参复用明确冲突；定向红包即时结算并返回最终状态，用户锁按稳定顺序获取。
- 显式重复领取恢复原成功快照；过期红包原子退还剩余金额并写 `hb_refund`，随机金额受剩余份数钳制，异常历史余额不会继续错误拆分。
- 众筹成本由服务端裁决，首次支持的银币、支持记录与流水同事务提交；重复支持不二次扣款，余额不足或流水失败完整回滚，封禁用户不能写反馈或支持。
- 书评服务只保留发布/投票职责，投票先锁书评再按用户 ID 有序锁定投票人与作者，重复态度在频率限制前恢复成功；Bot 路由强制可信来源，热词批量导入限制为 500 条，PO18 凭据与检索兼容接口保留原路径。
- 新增红包、众筹、路由与真实 PostgreSQL 回归，覆盖并发幂等创建、并发领取、过期退款、失败回滚和来源伪造。

## 2026-07-15：Reader 账户与签到事务收口

- Reader CDK 注册改为单一事务：先行锁定 CDK，再创建用户并以条件更新消费；任一步失败都会回滚，用户名或同一 CDK 的并发注册不再留下孤立用户或重复消费。
- 密码登录统一拒绝封禁用户；Telegram 登录与 Bot 注册通过唯一键 upsert 和受控用户名重试消除“先查再写”竞争，注册赠送与邀请计数只在真实首次创建时同事务结算。
- Reader 与 Bot 签到复用同一行锁领域服务，固定服务端奖励，并在余额、经验、周期、日期与全部流水写入后才提交；任何流水失败都会撤销本次奖励。
- 普通 `bot:user` 注册不再接受 `is_admin`、封禁、初始币值或签到状态；分享奖励必须携带幂等键和书号，通用事件流水只允许零金额且强制标记 `telegram_bot` 来源。
- Bot 用户批量导入仍要求 `bot:admin`，新增 2000 条上限、整数/布尔/日期规范化、用户名冲突重试和全批事务；导入批次只计算一次不可知随机密码散列，避免对每行同步执行高成本 PBKDF2，坏行也不会造成前半批已写入、接口却失败的部分状态。
- 新增账户与签到领域测试，并扩充 Reader/Bot 路由回归，覆盖 CDK 回滚、封禁登录、幂等奖励、权限字段注入、伪造流水及签到事务失败。

## 2026-07-15：持久任务与运维边界加固

- `system-jobs` 改为可注入 PostgreSQL 依赖的服务工厂；排队/运行任务取消由“先查后改”收敛为单条条件更新，在数据库行锁下原子决定直接取消或发出运行中取消请求。
- Bot Worker 的全部任务 PATCH 携带 `worker_id + attempt` fencing token，服务端只允许当前租约所有者更新；移除内存队列 `onQueued` 的冗余异步写入，避免恢复任务或刚领取任务被迟到回写倒退为 queued。
- 心跳续租同样校验 worker、attempt 与未过期租约；旧定时器不能给新 attempt 续租，已经过期的租约也不能被迟到心跳复活。
- 任务优先级、重试数、分页、批量领取和租约秒数统一拒绝 `NaN`/无穷值并执行整数边界收敛，避免异常管理输入进入 PostgreSQL 整数字段。
- Admin CSV 输出统一防护 `= + - @` 公式前缀、换行和响应文件名；CDK 导出复用共享发送器，认证服务不再持有无关 CSV 职责。
- 陈旧 PO18 清理在事务内对目标元信息加行锁，避免并发刷新与破坏性删除交错；Bot 命令设置只接受真实目录命令，兼容字符串布尔值并清理控制字符、未知项和重复项。
- 新增四组直接服务回归，覆盖任务幂等/租约/回滚/原子取消、CSV 注入、命令目录持久化及陈旧书清理事务边界。

## 2026-07-15：PO18 爬虫职责收敛

- `services/po18-crawler.js` 从 1182 行降至 800 行以内，只保留来源访问、书章处理、缓存写入和持久任务结算；历史公共导出继续由入口转发，路由和组合根无需迁移。
- 配置清洗/脱敏、分类与关键词筛选、完结缓存判断、日志摘要、运行统计/暂停恢复/停止状态机分别下沉为纯规则或运行时边界。
- 元信息去重、缓存完整性筛选和全缓存跳过计数 SQL 下沉为独立数据库来源适配器，并从两次同类查询合并为一次 PostgreSQL 往返。
- 新增模块接线、任务生命周期、日志窗口、进度、控制命令和数据库映射回归，继续锁定 Cookie 加密轮换、来源熔断、断点任务与章节落库行为。

## 2026-07-15：后端组合根职责收敛

- `server-pg.js` 从 1210 行降至 787 行，只保留依赖图、领域路由挂载和启动入口；学者成长、PostgreSQL 值清洗、Unicode 纠错、运行观测和书评频道外发分别下沉为可独立测试的领域模块。
- 日志、CORS、限流、分级 Body 解析、启动闸门、Session、CSRF 与管理审计收敛为固定顺序的 HTTP 安全管线，避免后续新增路由时静默改变鉴权或解析顺序。
- 默认管理员创建、配置 Token 同步、历史凭据加密、可选调度器和数据库/非数据库分级重试收敛为应用生命周期状态机；静态 Admin/榜单路由与最终错误边界同样脱离组合根。
- 新增定向回归覆盖等级/签到/红包规则、int4/boolean/NUL 清洗、Emoji 字符偏移、缓存/慢请求、进程错误分流、书评频道状态、启动重试和中间件顺序。

## 2026-07-15：旧代理登录来源兼容收口

- 旧代理同时丢失 `Origin`、`Referer` 与 `Sec-Fetch-Site`，且浏览器残留历史或活动 Session Cookie 时，仍可使用原有 Admin、本地 Reader、Reader 注册与 Telegram 登录入口。
- 身份入口兼容历史页面使用的 JSON、表单、无 `Content-Type`、浏览器自动生成的 `text/plain` JSON 和尾部斜杠，不再错误依赖 Session 必须完全未登录；解析仍受 32 KiB 登录预算约束。
- 增加历史/活动 Reader 与 Admin Session、注册入口、多种历史内容类型、解析隔离和普通受保护写入回归；退出、资料修改及其他无来源写操作继续拒绝，明确的 `cross-site` 请求始终优先拒绝。

## 2026-07-15：Telegram Bot 组合根职责收敛

- `bot/telegram-bot.js` 从 1156 行降至 760 行，只保留客户端/处理器注入、命令注册、update 分派、任务恢复、polling 与健康服务生命周期。
- 账户与签到、CDK/发币/排行/流水/红包、PikPak WebDAV，以及群聊转私聊续接/EPUB 样式/文件投递后幂等结算分别下沉为独立处理器；Bot 仍不直连数据库。
- 导出严格保持“文件发送成功后才扣额度或币”的顺序，继续传递任务 settlement key；私聊不可达时生成用户隔离且会过期的 `/start` 续接载荷。
- 新增定向回归覆盖续接隔离/过期、发送与扣费顺序、结算幂等参数、签到重复、管理员发币、红包载荷和 PikPak 配置/搜索。

## 2026-07-14：Admin 后台任务流与移动端交互优化

- 16 个后台入口按概览、内容质量、用户治理、自动化、系统审计分组；移动端改为抽屉导航并补跳转主内容、当前页语义和键盘焦点样式。
- 总览默认展示待审核纠错、无缓存书籍、缓存缺口和最近章节写入，全量指标改为按需展开；任务中心只在存在排队/运行任务且页面可见时自动刷新。
- 系统、TG Bot、反馈治理按工作区分栏；PO18 遍历常驻运行状态，把性能、筛选和 Cookie 低频配置折叠，并对覆盖缓存或高并发定时配置增加风险确认。
- 系统与 TG Bot 工作区改为真正按需请求：首次进入才加载对应数据，并发切换复用同一请求，成功结果缓存、失败后可重试，手动刷新只刷新当前工作区；系统备份索引、上传、远端归档、验证、恢复演练和数据库恢复状态机拆为独立组合层。
- 全局样式按视觉地基、通用工作流、内容管理、运维领域和响应式覆盖五层拆分，保持单一入口与固定级联顺序；书籍、任务表格固定关键首列/操作列，窄屏仍由表格容器独立横向滚动。
- 数据质量异常样本可直接深链到对应书籍，章节顺序修复预览显示预计影响章节数；缺书需求完成操作补齐忙碌锁定、内联错误和成功反馈，TG 标签加载失败统一进入消息队列。
- 表格排序改为键盘可用按钮并增加 `aria-sort`、加载骨架；表单/确认/输入弹窗统一焦点闭环、焦点恢复、忙碌锁定和内联错误，浏览器阻塞式输入全部移除。
- Admin API 遇到 Session 失效会统一退出并返回登录页；瞬时提示改为带语义颜色和辅助技术播报的消息队列，不再互相覆盖。
- 增加 Admin UI 静态契约测试，锁定导航、会话恢复、公共控件无障碍、非阻塞输入和高密度页面分区。

## 2026-07-14：双域名反向代理登录兼容

- 修复 3100 Admin/API 与 3200 Reader 分别代理到不同域名后，本地账号登录被 2.0 CSRF 防护误判为跨站写请求的问题。
- Reader 代理在连接 3100 时保留浏览器访问的公网 Host/协议；CSRF 对浏览器明确标记为 `same-origin` 的请求提供安全回退，即使旧代理没有继续传递 `Origin`/`Referer` 也能沿用原登录方式，不需要临时增加兼容环境变量。
- 明确的 `cross-site` 写入会优先拒绝，既无来源头、也无浏览器同源证据的 Session 写入仍拒绝；增加代理头缺失、Host 改写和矛盾来源场景回归，锁定会话 Cookie 与登录来源语义。

## 2026-07-14：全平台章节顺序独立更新

- `POST /api/parse/chapter-content` 的 order-only 路径从起点专用扩展为所有平台通用；请求可省略 `platform`，服务端沿用已缓存章节的平台。
- order-only 仍要求章节已缓存和正整数 `chapterOrder`，事务内只更新顺序与时间，不覆盖平台、标题、HTML 或正文。
- 成功响应新增稳定的 `success`、`orderUpdated`、`chapterId`、`chapterOrder` 字段，同时保留旧兼容字段，上传脚本可直接判断是否发生真实顺序变化。

## 2026-07-13：启动迁移流量闸门与元信息真实结果

- server 仍可先开放 3100 健康探测，但数据库迁移、Token、管理员和调度初始化完成前，所有业务请求统一返回 `503 SERVICE_STARTING` 与 `Retry-After`；`/health/ready` 同步保持未就绪。
- 修复 020 迁移事务提交前元信息请求可能撞到旧 Schema、报 `source_updated_at does not exist` 的竞态；搜索和下载使用旧字段不受影响，但失败的元信息必须在服务就绪后重新上传。
- `POST /api/metadata/batch` 不再固定返回假成功：全部成功为 `200`，部分成功为 `207`，全部失败为 `500`，顶层 `success` 严格反映逐项落库结果。
- 修复生产历史标签触发的 020 taxonomy 回填冲突：新增排序在 020 前的重复 token 清理迁移，并以 023 永久修复后续触发器写入；原 020 checksum 保持不变。
- 非连接类启动错误不再永久停在 `startup_failed`，服务会保留失败状态、记录原始日志并每 60 秒受控重试，以便镜像或外部状态修复后自动恢复。
- 修复元信息时间列沿用文本 `NULLIF(..., '')` 导致 PostgreSQL 尝试把空串强转为 `TIMESTAMP` 的兼容回归；既有起点上传结构无需修改，可选空时间统一落为 `NULL`。

## 2026-07-13：EPUB 独立文件模板与结构精确对齐

- 三个样式的完整 CSS 与制作说明、简介、分卷、正文 XHTML 骨架拆入独立模板文件；运行代码只按样式 ID 注入当前书籍数据，不记录样例书名或正文。
- 二次逐页核对三本参考 EPUB：江湖纸卷移除误加的暖纸底、紫色简介字和响应式覆盖，恢复原版四种字体与说明图标；老二次元恢复原始制作说明/简介容器数值；疏影横斜恢复原版三种字体、说明框、单行章题和三张分部底图。
- Admin 的说明、简介、分卷与正文预览改为直接填充实际导出 XHTML 骨架；字体 URL 和图片资源在预览中解析为同源构建资源，避免手写预览与 EPUB 输出继续漂移。
- 补齐样式三封面页和真实分卷页的 `duokan-page-fullscreen` spine 语义；分卷继续只来自源数据并在 NCX 中作为章节父节点。
- 原封面继续写入 EPUB cover 元数据，另用 Resvg 自动生成 `1080×2400` 的 `cover~slim.png`，以模糊延展背景和完整前景适配长屏，替代纯黑上下留空。
- “疏影横斜”分卷改为独立全屏 XHTML/SVG 留白画布，动态排版卷序和卷名；制作说明采用 20% 顶距、浅灰边框、60% 灰字说明框和拆出的原始提示图，Admin 同时展示完整 CSS 与实际 XHTML 骨架。
- “老二次元”取消固定标题页标志和太极注记，图片资源从 10 个精简为 5 个，所有分卷共用一张图、所有正文章头共用一张图。

## 2026-07-12：运行文档、部署契约与迁移手册校准

- 建立根级 `AGENTS.md`、L1 `CLAUDE.md`、完整核心模块 L2 地图和全部受控源码 L3 契约；新增 `docs/README.md` 作为当前文档入口，并让 CI 拒绝断链、缺地图或缺契约的变更。
- 重写 README、Docker、架构、配置和排障文档，明确单容器与 Compose 两种拓扑、`3100/3200/3300` 边界、GitHub Actions 发布链及 Docker Hub 移动/不可变标签区别。
- 生产非 localhost 监听时明确要求 `PO18_METRICS_TOKEN`；Compose 补齐 Upload/Metrics Token、凭据加密、迁移超时、跨域、深度健康检查和进程重启配置，Reader/Bot 的业务 API 统一指向 `server-pg:3100`。
- 数据库手册改用实际配置名 `PO18_PG_URL`；容器内维护命令显式加载 `/config/app.env`，回滚 CLI 自行加载项目配置，并说明 advisory lock、10 分钟迁移超时、`020` 正常日志及文本版本修复规则。
- 历史评估与优化报告统一增加快照状态和权威顺序，不再让旧评分、测试数、镜像 digest 或当时待办伪装成当前运行事实。
- Bot 书籍详情和书评列表增加“写书评”引导：Force Reply 草稿按聊天/用户隔离，群聊只消费指定回复，支持校验重试和取消，同时保留 `/review 书号 内容` 兼容入口。
- 频道系统推送增加跨进程不可见标记；关联讨论群只对带标记的自动转发副本按精确消息 ID 取消置顶，人工频道帖与人工群置顶不受影响。
- 后台用户页增加 owner 专属的 Reader/Bot 管理员设置与取消；专用接口要求布尔状态和审计原因，普通资料编辑不能夹带提权。
- 验证通过：46 份 Markdown 与 310 个源码契约、UTF-8、20 个迁移及 Schema 指纹、ESLint、Prettier、Compose 解析、Docker 上下文、Admin/Reader 构建；Node 测试共 336 项，335 通过、1 项因未配置独立 PostgreSQL 测试库而跳过、0 失败。

## 2026-07-12：EPUB 疏影横斜（style3）与启动迁移修复

- 新增文艺简约样式“疏影横斜”（内部 ID `style3`）：采用大片留白、黑白层级、居中章序和分部目录，并以可适配任意书名的暖白纸面、淡墨梅影与系统宋体回退动态生成。
- 样式三复用书籍封面，支持制作说明、内容简介、真实分卷、嵌套目录和正文章头；没有真实分卷数据时不生成分卷页，正文首行章节标题继续自动去重。
- 后台增加封面、说明、简介、分卷、正文五类实时预览和完整 CSS；Bot 样式选择增加“疏影横斜”。
- 启动迁移改用独立 10 分钟客户端与事务级 PostgreSQL 超时，普通接口查询仍保持 30 秒，解决大表迁移反复在 30 秒中断且无需临时增加环境变量的问题。
- Docker 独立 Bot 构建补齐 `services` 目录，后台构建统一复制 EPUB 样式资源目录。

## 2026-07-12：7 月 11 日综合报告剩余项收口

- Docker 发布改由 GitHub 执行：推送 `main` 自动验证并更新 Docker Hub `wenmoux/reader:v2.0` 与源码指纹标签；版本 tag 继续执行不可变发布、SBOM、签名和证明，本机无需 Docker。
- 发布链改为 clean、不可变 semver/source 标签，发布后按 registry digest 冒烟，并生成 SBOM、Cosign 签名和构建身份 attestation；开发构建不再冒充正式版本。
- 任务扣费、免费额度和共享奖励增加 operation ledger，租约过期重跑不会重复结算；查询池、任务、来源、Bot、质量和备份增加分位数/比率及 Prometheus 告警。
- PostgreSQL 备份支持后台和每周自动真实恢复演练：临时库执行 `pg_restore`、Schema/核心行数检查后自动清理。
- 搜索增加 fast/no-total、keyset cursor、规范化 taxonomy 和 5 万行 `EXPLAIN (ANALYZE, BUFFERS)` 回归；榜单公开刷新周期、样本数、数据时间和指标公式。
- Reader 新增安全 PWA：静态壳离线、正文/进度按 Reader 身份隔离、联网补传、退出清理，并补齐封面失败占位。
- 后台新增 Book Manifest 导出、校验和增量导入，逐章/整包 SHA-256；跨平台同 `book_id` 冲突会明确拒绝，不静默串书。
- 书评新增举报、阈值自动审核、moderator 处理、作者申诉、发评/投票频率限制和最多改票一次；Reader、Bot 和后台均有入口。
- 新增迁移 `019`–`022` 及 rollback、迁移链 Schema snapshot、分路由 Body/Ajv 契约和关键 OpenAPI 响应 Schema。
- Node 测试改为跨平台显式枚举文件，修复 GitHub Node 20 不展开引号 glob 导致的 0% 覆盖率；工作流官方 Actions 同步升级到 Node 24 运行时版本。
- 本轮 Node 20 全量及覆盖率门禁 309 通过、1 项真实 PG 环境缺省跳过、0 失败；覆盖率语句/行 71.38%、分支 53.29%、函数 70.19%；Admin/Reader 构建及 UTF-8、Schema、lint、format、Docker context 门禁通过。
- 按确认边界，仅保留 `book_key` 身份迁移和全端平台感知 API 切换未实施。

## 2026-07-12：EPUB 老二次元（style2）与导出交互

- 新增“老二次元”（内部 ID 保持 `style2`），按参考 EPUB 的标题页、制作说明、书籍信息、分卷图、正文章头和嵌套目录结构生成；只有章节数据包含非空真实分卷时才生成分卷页，不再自动补“正文”。
- EPUB 正文会移除与当前章节标题完全等价的首行，避免彩色章头下方再次出现相同标题；仅匹配完整首行，不删除普通正文。
- 后台 EPUB 编辑器支持样式一、老二次元的五类页面实时预览和完整样式 CSS 展示；老二次元背景资源以登录态加载后嵌入预览，简介页不再因图片鉴权失败显示白底，并增加文字对比度。
- 老二次元预置文本、字体族和追加 CSS 可直接配置；精简后的 5 个图片资源位可独立替换或恢复，并显示推荐尺寸与当前尺寸。
- 自定义样式图片写入 `/config/epub-style2/`，重建容器后仍保留；未上传的资源继续使用内置原图。
- Bot 的 EPUB 导出改为先选择“样式 1 / 老二次元”，选择后再进入冷却、任务队列和扣费流程；群聊转私聊会保留所选样式。

## 2026-07-11：v2.0 启动热修复

- Bot 大书导出改为分页拉取正文，避免单次返回数十 MB JSON 触发 30 秒超时并误报无正文缓存；原 Reader 章节接口保持兼容。
- EPUB 封面页改为独立全屏文档，清除主题边距并补充 EPUB 2 cover guide；封面保持等比例完整显示，不拉伸、不裁切。
- 修复 Telegram Bot 的 PO18 书架处理器初始化顺序，避免 `handleMyBookshelf` 暂时性死区导致 Bot 持续崩溃重启。
- PostgreSQL 磁盘已满等 `53xxx` 资源错误现在按数据库暂不可用处理：接口返回明确的 503，启动迁移会在空间恢复后继续重试。
- 旧库已有 `004-010` 迁移记录时会安全登记合并后的 `001_baseline`，不再对现有大表重跑完整基线；迁移锁改为非阻塞获取，避免多实例耗尽连接池。

## 2026-07-11：v2.0 第二批稳定性、性能与维护性收口

- EPUB 导出改为可注册样式包；新增“样式一 · 江湖纸卷”，覆盖封面、制作说明、作品简介、分卷、章头、标题和正文，原仙鹤样式继续保留。
- 后台导出配置可选择默认 EPUB 样式、制作说明、简介标题和头图；Reader 仅新增江湖纸卷主题与章头切换，不生成 EPUB 前置页面。
- 样式一样例通过 EPUBCheck 5.3.0：0 fatal、0 error、0 warning；原参考 EPUB 和修改前相关源码均已单独备份。
- v2.0 使用 `wenmoux/reader:v2.0` 发布；镜像内保留不可变内部版本、提交版本和源码哈希，后台可据此判断服务器是否已经拉取最新构建。
- Reader 新增真实用户性能采集和系统页 p95/Web Vitals 看板；目录继续使用虚拟列表，主入口 gzip 保持约 68.3 KiB。
- 数据库初始化统一到 `001_baseline.sql`；迁移 checksum 漂移默认拒绝启动，新增 `018_data_quality_guards` 保护新写入。
- Bot 搜索/词云/详情和书评/众筹继续拆分；Crawler HTTP 重试/限速/Cookie 层、Reader 导航与阅读进度也已独立。
- 新增运行时 `/openapi.json`、统一错误 `code/request_id`、ESLint/Prettier/c8/Dependabot；当前行/语句覆盖率 68.70%。
- 远端 WebDAV/S3 备份支持可选 AES-256-GCM 加密，密钥只从环境读取。
- Admin 接入真正的 Vue Router 和 `/admin/*` 深链接，支持刷新、浏览器前进后退和本地保存常用筛选视图；视图改为异步加载，主入口 gzip 降至约 45.6 KiB。
- 缺书需求形成处理闭环：后台可标记已接受、抓取中、已缓存或驳回；已缓存可填写书号并自动通知此前提交过需求的 Telegram 用户。
- Bot 新增 `/tasks`、`/task` 和 `/canceljob`，用户可查看任务进度、失败原因、重试时间并取消自己的排队/运行任务。
- 迁移链扩展到 `018_data_quality_guards`，空库 Docker 冒烟自动执行 baseline 与 004–018 共 16 个迁移。
- 后台增加 RBAC：`owner / operator / moderator / viewer`，并保护最后一个 owner；旧登录和 `/admin-api/auth/me` 响应字段保持不变，角色通过新接口单独读取。
- 后台增加管理员账号管理、API Token 脱敏管理、追加式审计查看页和统一高风险确认框；表单有未保存修改时会拦截关闭。
- Bot/Upload Token 改为数据库仅存 SHA-256，支持 Scope、来源 IP、最近使用和吊销；默认 Bot Token 不含 `bot:admin`。
- PO18 密码、用户 Cookie 和爬虫 Cookie profile 改为 AES-256-GCM 信封加密，支持新旧密钥并行轮换和旧明文启动迁移。
- Bot 导出、PO18 书架同步和共享任务在执行前写入 PostgreSQL，支持优先级、幂等键、租约、心跳、指数重试、取消和重启恢复。
- Reader Ant Design Vue 组件改为按需异步加载；主入口约 182 KiB、gzip 67 KiB。
- 详情目录和阅读页目录改为虚拟列表，数千章时只渲染视口附近约 20–30 行。
- Reader 主题、话本正文解析、Bot PO18 登录、爬虫 Cookie profile 拆成独立模块；继续保留原 UI 和命令行为。
- Reader 校对/TTS 编排继续拆为独立 mixin；Bot 单书/整书架共享拆为独立 handler 工厂；PO18 DOM、目录、正文和登录页识别拆为独立解析模块。
- 三个主文件进一步收缩：`Reader.vue` 2827 -> 2234 行，`telegram-bot.js` 1590 -> 1018 行，`po18-crawler.js` 1736 -> 1177 行；共享模块新增免费章节、付费新增和缓存跳过测试。
- PO18 来源增加连续失败熔断；`/metrics` 和后台指标页增加来源成功/失败、重试、熔断，以及持久任务租约/重试/取消指标。
- 单镜像 `run-all` 改为独立监管 `server-pg / reader / bot`，单个进程退出只重启自身，并带指数退避、重启上限和优雅关停。
- 本地备份增加 SHA-256 和 `pg_restore --list` 自动归档验证；上传 dump 先验收，恢复前再次验证，后台可手动“验证归档”。
- CI 真实 PostgreSQL 测试会把 dump 恢复到临时数据库并检查迁移表和章节表，再销毁临时库。
- 修复恢复演练发现的 PostgreSQL 客户端版本漂移：镜像固定 `postgresql16-client`，避免新版 dump 产生 PostgreSQL 16 不支持的设置。
- 镜像支持可选 `--user 1000:1000 --read-only --tmpfs /tmp` 加固运行，默认用户保持兼容。
- 新增迁移 `013_system_job_leases`、`014_api_tokens`、`015_admin_roles`，均有 rollback。
- 验证：覆盖率测试 242 通过、1 项缺省 PG 跳过、0 失败；真实 PG 11/11 通过；1,000 章写入 p95 111.6ms；三套生产依赖审计 0 漏洞；Admin/Reader 构建、本地 Docker 构建和 16 迁移容器冒烟通过。
- 已构建并推送 `wenmoux/reader:v2.0`，内部版本 `2.0.0+20260711T083719.766d1740cf18.dirty.4bb3f875`，远端 digest `sha256:8ccd4b44bd08f56bcbb345c3bd15b98a4f4e4c6cf5c0efefab391e7baca14c1d`。
- 按本轮边界，仍未迁移书籍唯一键，也未重命名、删除或改变现有 API 字段。
- VoceChat 已明确排除，Bot 保持 Telegram 单渠道实现。

## 2026-07-11：v2.0 第一批基础加固

- 修改前已将当前源码、未提交修改和 Git 历史归档到仓库外的本地备份目录，并生成 SHA-256 清单。
- Docker 默认标签、文档和后台版本回退显示切换为 `wenmoux/reader:v2.0`。
- 构建版本增加源码内容指纹，脏工作区 revision 会显示 `.dirty.<hash8>`。
- Reader 不再在 `localStorage` 保存密码，并会自动清理旧明文密码。
- 修复 Reader 的 DOMPurify/axios/form-data 依赖漏洞，三个项目生产依赖审计均为 0。
- TTS 通用代理增加私网/保留地址拦截、可选域名白名单、重定向禁止和响应大小限制。
- 登录、注册、check-cache、TTS 和上传接口增加分组限流。
- CORS 改为生产白名单；Session 改用 PostgreSQL Store；反代信任和安全 Cookie 可配置。
- Setup Token 验证后交换为 HttpOnly Cookie，并跳转到不含 Token 的 URL。
- 修复空库首次启动在 `book_stats` 建表前创建索引导致初始化失败的问题。
- 新增 `011_chapter_stats_incremental`，章节 INSERT/UPDATE/DELETE 改为语句级增量统计，避免每章写入都全书 COUNT；提供对应 rollback。
- Setup Token 失败尝试增加独立限流，超限返回 429 和 Retry-After，成功验证后清除计数。
- WebDAV、S3/R2 远端备份改为磁盘流式上传，并通过请求头记录 SHA-256；后台 API 返回字段保持不变。
- Reader 仅打包实际使用的 33 个 Remixicon：字体子集 2.6 KiB，公共 CSS 从 103.15 KiB 降到 16.33 KiB，移除约 2.3 MiB 多格式全量字体输出。
- Session 写请求增加同源校验，Reader 3200、后台同源和配置白名单保持兼容；不携带 Session 的 Token 客户端不受影响。
- 新增 `012_admin_audit_logs`，后台写操作在响应后异步写入脱敏审计记录；审计表禁止更新和删除。
- 按本轮要求，没有修改书籍唯一键，也没有重命名、删除或调整现有 API 字段。
- 详细进度与待办见 `V2_OPTIMIZATION_PROGRESS.md`。
- 验证：`npm test` 192 通过、1 个 PG 集成测试跳过；真实 PG 集成测试 7 项通过；Admin/Reader 构建通过；三套生产依赖审计 0 漏洞。

## 2026-06-30：章节标题清洗

- 章节标题清洗：
  - 新增确认规则版章节标题清洗器，仅删除标题中整体命中的括号/方括号尾注：`（...）`、`(...)`、`【...】`、`[...]`。
  - 支持末尾未闭合的感谢/盟主/加更说明清理。
  - 未确认内容保留，例如“（上）”“（本卷完）”“（大结局）”“【道生一】”“【绝对冰封】”“（蓝）”“【已修改】”“（修）”“（改）”。
  - `saveChapter` 写入新章节时自动清洗确认尾注。
  - 新增 `scripts/clean-chapter-titles.js` 批量清理历史库标题；默认 dry-run，传 `--apply` 才会写库，支持 `--quiet` 只输出汇总。
  - Docker 镜像内包含该脚本，可通过 `docker exec po18-app node scripts/clean-chapter-titles.js ...` 执行。
  - 已对当前库执行历史清理：扫描约 106.7 万条章节标题，更新 23117 条；复扫剩余待清理 0 条。

## 2026-06-27：Bot 下载额度与下载次数 CDK

- Qidian 目录顺序更新：
  - `/api/parse/chapter-content` 支持 qidian/qd 平台的 order-only 上传。
  - 脚本可发送 `orderOnly/updateOrderOnly/skipContentUpdate` 与 `chapterOrder`，后端只更新已缓存章节的 `chapter_order`，不覆盖标题、正文、卷标和上传正文缓存。
  - order-only 只对 qidian/qd 生效；PO18、番茄等平台继续走原保存逻辑。
  - 目录、阅读器和导出继续按 `chapter_order` 排序，配合脚本按真实目录顺序重算 order，可避免起点插章、番外和分卷占位导致的顺序错位。
- 版本显示修复：
  - 镜像构建时写入 `/app/.po18-build.json`，`/health/version` 和后台顶栏优先显示镜像真实构建版本。
  - 如果部署平台残留旧 `PO18_APP_VERSION`，不再导致后台误显示旧版本；旧运行时值保留在 `runtime_version` 字段用于诊断。
- Docker 发布补充：
  - `npm run docker:build` 会注入本次构建专属 `PO18_APP_VERSION`，用于后台顶部、系统页和 `/health/version` 显示。
  - Docker Hub 只发布一个镜像 tag：`wenmoux/reader:v1.0`，避免部署侧需要判断多个 tag。
  - `npm run docker:push` 会读取 `.docker-build.json` 中的单一发布 tag。
  - 本次已推送：`wenmoux/reader:v1.0`，内部版本 `1.0.0+20260628T162855.f29dce64cea5`。
  - digest：`sha256:9d2fcc6bfddff10ec7059ec1cadd21b9eeb7a54109745cb271dfdc66065b2d00`。
- Bot 付费章节导出额度调整：
  - 默认 Lv1/Lv2 每日 1 本。
  - 默认 Lv3 及以上每日 2 本。
  - 后台 TG Bot 配置页新增“每日付费书免费导出额度 JSON”，支持按等级配置并向上继承。
- 新增下载次数 CDK：
  - 后台 CDK 页可选择“会员注册码”或“下载次数”。
  - 下载次数 CDK 兑换后增加用户 `export_extra_quota`，次数永久有效。
  - Bot 新增 `/redeem CDK码`，别名 `/cdk`，用于兑换下载次数 CDK。
- 导出扣费/扣次数规则调整：
  - 只有包含付费章节的书会消耗每日免费额度或额外下载次数。
  - 免费书不消耗下载次数，仍按后台“免费书导出铜币/次”配置扣铜币。
  - 扣每日额度、扣额外次数、扣银币/铜币都移动到文件发送成功之后；发送失败不扣。
  - 同一本书同一天重复使用同一种额度记录不重复扣次数。
- 数据库兼容：
  - `reader_users` 新增 `export_extra_quota`。
  - `reader_cdks` 新增 `cdk_type`、`export_quota`。
- 验证：
  - `npm run admin:build`：通过。
  - `node --test tests/health-routes.test.js tests/reader-api-routes.test.js tests/upload-api-routes.test.js tests/auth-service.test.js tests/admin-content-routes.test.js tests/config-service.test.js tests/user-currency.test.js tests/bot-api-routes.test.js tests/bot-runtime-modules.test.js tests/bot-export-errors.test.js tests/bot-job-queue.test.js tests/bot-ui-formatters.test.js`：51 项通过。

## 2026-06-23：Legado 书源分类入口补充

- Legado 本地书源发现页新增分类入口：修仙、玄幻、都市、武侠、游戏体育、轻小说、H、骨科、同人、纯爱、美食、言情、无CP、NPH。
- 分类入口使用 `/reader-api/search?tag=...&sort=cache_desc`，优先展示已有正文缓存的书籍。
- `/reader-api/search` 的 `tag` 参数现在同时匹配 `book_metadata.tags` 和 `book_metadata.category`，避免分类字段有值但标签为空时搜不到。
- 后台总览“站别数量”卡片改为显示全部站点明细，不再折叠为“其余站别”，并在卡片内自适应排布。
- 后台书籍页快捷筛选从热搜标签改为 `book_metadata.category` 分类聚合；搜索框支持按标签/分类搜索，CSV 导出同步支持分类筛选。
- Legado 发现页继续扩充：
  - 保留原入口。
  - 新增 22 个固定 `category=` 分类入口。
  - 新增 15 个热门 `tag=` 标签入口。
  - 新增默认平台映射里的 17 个站点入口。
- 书源详情、目录、章节 URL 改为 `/reader-api/...` 相对路径，除 `bookSourceUrl` 主域名外不再硬编码本地 reader 地址。
- 后端元信息上传兼容 `category` 字符串，以及 `categories` / `categoryList` 数组，自动拆分、去重并统一保存为中文逗号分隔。
- `/reader-api/search` 新增 `category=` 精确分类筛选，按 `,，、/|·` 拆分 `book_metadata.category` 后匹配。
- Docker 构建新增自动版本参数：
  - `npm run docker:build` 会注入 `PO18_APP_VERSION`、`PO18_BUILD_DATE`、`PO18_BUILD_REVISION`。
  - 后台顶部和系统页显示镜像、版本、短提交和构建时间，避免同为 `v1.0` 时无法判断是否更新。
  - 仍可通过构建环境变量手动覆盖 `PO18_IMAGE_TAG` / `PO18_APP_VERSION`。
- 验证：
  - `node --test tests\control-panel.test.js tests\health-routes.test.js tests\reader-api-routes.test.js tests\book-chapters.test.js tests\upload-api-routes.test.js tests\admin-content-routes.test.js`：32 项通过。

## 2026-06-21：后台站别数量卡片优化

- 后台总览“站别数量”不再用斜杠长文本平铺所有站点。
- 改为展示缓存数量最高的前 6 个站点标签，并把剩余站点合并为“其余 N 个站别 · X 本”。
- 空数据时显示“暂无站别数据”，避免卡片留白或撑高。
- 统计接口和原始数据口径不变，仅调整后台展示层。

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
