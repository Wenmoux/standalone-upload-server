# services/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

`services/` 承载与 HTTP 框架解耦的领域能力。组合根向工厂注入查询、配置和外部适配器，`routes/` 只负责协议转换与权限落点，从而保持依赖方向为 `routes → services → pg-store/PostgreSQL`。

## 成员清单

CLAUDE.md: 本模块的语义地图，约束领域服务边界、直接成员与依赖方向。
admin-audit.js: 管理操作审计中间件，脱敏请求上下文并以追加记录方式提供后台审计查询。
admin-exports.js: CSV 输出安全适配器，统一公式注入防护、单元格转义、BOM/CRLF、文件名清洗和 Express 下载响应。
admin-overview.js: 后台运行概览聚合器，汇总 schema、任务、慢请求、错误与安全状态而不把聚合逻辑泄漏到路由。
application-runtime.js: 应用生命周期边界，安装静态/错误路由并编排默认管理员、迁移初始化、凭据加密、可选调度器与分级重试。
api-tokens.js: 内部 API Token 领域服务，以哈希存储、Scope 和来源 IP 约束保护 Bot/Upload 调用。
auth.js: 认证授权核心，统一 Reader/Admin session、角色能力、书库权限、上传/Bot Token 和 Telegram 登录校验。
backup-crypto.js: 备份文件加密边界，使用 AES-256-GCM 流式封装远端备份并从环境解析密钥。
backup-restore-drill.js: 恢复演练调度器，从本地备份清单选择归档并周期性创建可观测演练任务。
backups.js: 备份用例编排层，连接 docker 备份原语与 system_jobs，负责创建、上传、校验、恢复和演练载荷。
body-limits.js: 请求体预算策略，为不同路由安装分级 JSON/raw 解析器，并仅在身份入口解析旧客户端缺失类型或 `text/plain` 的 JSON。
book-chapters.js: 书籍与章节持久化核心，统一字段清洗、可选时间类型、幂等写入、全平台 order-only 隔离更新、章节正文派生及目录排序语义。
book-crowd.js: 书籍轻互动与众筹聚合根，统一反馈规范化、众筹公开视图及银币扣款/支持记录/流水原子结算。
book-maintenance.js: 陈旧书籍维护用例，提供 PO18 清理预览、事务行锁定、平台隔离删除与事件审计。
book-manifest.js: 可移植书籍清单协议，实现规范化、SHA-256 校验、导出、验证和幂等导入。
book-review-channel.js: 书评频道外发适配器，读取最新书籍元信息，以数据库认领防止重试重复发送，再构造带系统标记的 Telegram 文案/按钮并回写状态。
book-social.js: 书评聚合根，以操作账本幂等结算发布扣费，以原子频道认领隔离外部副作用，并通过书评行和有序用户锁避免作者互投死锁。
bot-audit.js: Telegram Bot 审计服务，规范化命令执行结果并提供聚合与筛选查询。
bot-library.js: Bot 书库持久化用例，集中 PO18 加密账号、书架、缺书请求与分享事实的数据清洗和 SQL，使 Bot 路由保持协议边界。
bot-settings.js: Bot 命令开关服务，以命令目录为白名单清洗、去重、稳定排序、持久化和读取后台配置。
chapter-maintenance.js: 章节顺序修复服务，对重复顺序生成预览并在确认后通过事务重排。
chapter-title-cleaner.js: 章节标题规范化纯函数，按可审计规则清理空白、已确认括号/未闭合尾注、用户正则与首尾连接符，并保留未确认正文语义。
config.js: `admin_config` 访问与配置语义层，统一平台标签、导出计价、EPUB 配置及数值归一化。
correction-text.js: 纠错文本规则层，统一 Unicode 字符偏移、换行规范化与精确/首处替换语义。
credential-crypto.js: 外部站点凭证加密层，以版本化密文和轮换密钥保护数据库中的 PO18 Cookie/账号字段。
csrf.js: 基于可信 Origin、浏览器 same-origin Fetch Metadata 与 session cookie 的 CSRF 防护，仅对旧版登录/注册身份入口兼容代理完全丢失来源头，并优先拒绝明确的 cross-site 与其他无来源写入。
data-quality.js: 数据质量诊断服务，以只读查询发现重复书籍、缺章、异常元数据和大体积正文。
db-errors.js: PostgreSQL 可用性错误分类器，把驱动/网络错误转换为稳定的启动与 API 提示。
epub-style2-assets.js: 老二次元 EPUB 资源服务，校验图片类型、尺寸和大小并管理 `/config` 自定义覆盖。
epub-style2-template.js: 老二次元 EPUB 模板内核，定义资源槽、基础 CSS 与标题页/简介/分卷/正文渲染器。
epub-template-files.js: 三样式独立 CSS/XHTML 文件加载器，缓存模板并执行受控动态占位符替换。
epub-style-config.js: EPUB 样式配置契约，登记样式选项并规范化通用、Style2 和追加 CSS 配置。
error-response.js: HTTP 错误规范化中间件，为既有 `error` 响应补充稳定 code 与 request_id。
events.js: 上传事件写入服务，统一 PostgreSQL 值清洗并为更新记录和 Telegram 推送提供事实源。
health.js: 深度健康检查服务，检查数据库、schema、磁盘、Reader、Bot、Telegram 与安全配置并区分必需/可选项。
hot-keywords.js: 热搜配置服务，规范化关键词并通过 `admin_config` 提供读取、串行累积与一次读改写的批量合并能力。
http-security.js: HTTP 生产安全策略，统一 CORS、代理信任、回环判断及启动前不安全配置拒绝。
http-pipeline.js: 服务端安全管线，按固定顺序安装请求日志、CORS、限流、Body 解析、启动闸门、Session、CSRF 与管理审计。
job-retry.js: system_jobs 重试策略，把可重试任务类型映射回领域执行器并保护破坏性确认语义。
network-security.js: 出站网络 SSRF 防线，解析 DNS、阻断内网/保留地址并支持显式主机白名单。
openapi.js: 运行时 OpenAPI 索引生成器，从 Express 栈收集端点并绑定已登记请求/响应 Schema。
po18-crawler.js: PO18 爬取编排器，驱动来源访问、书章处理、缓存写入与 system_jobs 结算，并兼容转发历史公共接口。
po18-crawler-cache-source.js: PO18 数据库来源适配器，以单次元信息去重/完整性查询返回仍需抓取的书籍和全缓存跳过计数。
po18-crawler-config.js: PO18 爬虫配置边界，集中字段默认值、不可信输入收敛、Cookie 档案投影与持久化脱敏语义。
po18-crawler-cookies.js: 爬虫 Cookie 纯函数层，负责多配置归一化、合并、响应更新、Header 生成与脱敏展示。
po18-crawler-http.js: 爬虫 HTTP 适配器，在安全 fetch 之上实现 Cookie 演进、限流识别、退避重试与来源熔断反馈。
po18-crawler-parsers.js: PO18 HTML 解析边界，把发现页、书架、详情、目录与正文转换为稳定领域数据并识别登录失效。
po18-crawler-policy.js: PO18 选书策略纯函数层，统一分类、关键词、章节区间、完结缓存判定和运行日志摘要口径。
po18-crawler-runtime.js: PO18 单进程运行状态机，集中统计初值、日志窗口、任务生命周期、进度、暂停恢复、停止和管理快照。
postgres-values.js: PostgreSQL 值边界，统一 int4/boolean 转换、空字节与嵌套 JSON 清洗以及 SQL 时间文本。
rank.js: 动态榜单服务，定义榜单口径、热度计算、缓存刷新和分页输出元数据。
rate-limit.js: 进程内限流原语，按请求身份维护时间窗并生成标准 429 与 Retry-After。
reader-rum.js: Reader RUM 服务，清洗前端性能事件、批量落库并输出路由与指标聚合。
reader-account.js: Reader 账户生命周期服务，以事务锁定 CDK、处理密码/Telegram 身份唯一键竞争，并原子结算 Bot 注册赠送、邀请计数与强类型批量导入。
reader-check-in.js: Reader 签到用例服务，在用户行锁事务内统一结算签到周期、余额、学者经验和全部奖励流水。
remote-backups.js: WebDAV/S3/R2 远端备份适配器，负责签名上传、加密文件选择、状态和保留策略。
red-packets.js: 红包聚合根，以稳定操作键、红包/用户有序行锁和单事务维护创建、定向结算、重复领取恢复及过期退款。
review-governance.js: 书评治理领域服务，处理举报阈值、隐藏状态、申诉和审核决议事务。
runtime-observability.js: 运行观测适配层，统一短期状态缓存、慢搜索事件和进程级数据库/致命错误分流。
schema-validation.js: Ajv 请求契约注册表与中间件，在路由前执行 body Schema 校验并输出紧凑错误。
scholar-progression.js: 阅读成长规则层，集中学者等级、签到经验、红包拆分和币种展示纯规则。
source-health.js: 外部来源健康熔断器，跟踪连续失败、重试、打开窗口和 Prometheus 状态。
startup-gate.js: 应用启动流量闸门，以显式生命周期状态阻止迁移提交前的业务请求，并为健康检查保留可观测通道。
system-jobs.js: PostgreSQL 持久任务原语，通过可注入服务工厂提供创建、认领、心跳、租约、原子取消及 worker/attempt fencing token 状态回写。
telegram-push.js: Telegram 通知服务，统一多 Chat 推送、注册用户收件人分页/计数、消息转义、来源链接、书评等类型过滤与日报时间窗。
tts.js: TTS 提供商适配层，封装 Edge、火山、阿里云、Azure、ElevenLabs 与 Cartesia 的请求和重试语义。
user-currency.js: 用户经济领域服务，以事务处理签到、任务、转账、兑换、导出配额和流水一致性。
validation.js: 路由输入校验原语，统一字符串/数值/枚举/确认短语与紧凑 JSON 限制。
word-cloud.js: 词云领域服务，融合标签、热搜与榜单权重并输出稳定的归一化词频。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
