# routes/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

`routes/` 是 Express 协议边界：它把 HTTP 参数、session/Token 权限与状态码转换为领域调用，不持有独立数据库模型。路由由 `server-pg.js` 组合，复杂规则下沉到 `services/`，从而避免 HTTP 层成为第二套业务实现。

## 成员清单

CLAUDE.md: 本模块的语义地图，约束路由边界、鉴权落点和服务依赖。
admin-auth.js: Admin 认证与管理员账号路由，承接登录/session、访问角色及 owner 约束。
admin-backups.js: Admin 备份路由，把创建、校验、上传、恢复、演练和远端操作映射到备份服务与任务中心。
admin-config.js: Admin 配置路由，暴露 Telegram 类型开关、owner 全员通知、平台、导出和 EPUB Style2 模板/资源配置。
admin-content.js: Admin 内容域组合路由，挂载维护、用户和书库子路由并处理其余后台内容/配置接口。
admin-crawler.js: PO18 爬虫管理路由，提供配置、运行、暂停、恢复、停止和 Cookie 测试入口。
admin-library.js: Admin 书库路由，负责书籍/章节 CRUD、筛选导出、书评及目录查询的 HTTP 适配。
admin-maintenance.js: Admin 数据维护路由，暴露陈旧书籍清理与章节顺序修复的预览/确认执行。
admin-manifests.js: Admin Book Manifest 路由，提供单书导出、包验证和确认导入。
admin-system.js: Admin 系统路由，聚合状态、诊断、日志、概览、任务与安全审计入口。
admin-users.js: Admin 用户与经济管理路由，覆盖 owner 专属 Reader/Bot 管理员切换、用户、CDK、流水、搜索需求及 CSV 导出。
bot-api.js: Bot API 组合与书籍域路由，在统一 Bot Token 边界下挂载系统、用户、搜索、导出配置和书评能力。
bot-api-system.js: Bot 内部系统路由，处理持久任务登记、worker/attempt fencing token 状态回写、管理员广播入队、收件人分页、审计与命令配置读取。
bot-api-users.js: Bot 内部用户路由，把 Telegram 身份、签到、任务、转账、兑换与流水请求映射到用户经济服务。
health.js: 运维路由，提供 liveness/readiness/deep health、版本、Prometheus 文本和 Admin 指标摘要。
openapi.js: OpenAPI 入口路由，按请求实时生成 Express 端点索引并提供轻量文档页。
rank.js: 公共与 Admin 榜单路由，提供榜单读取、状态和显式刷新。
reader-api.js: Reader 主 API 路由，组合账号/TTS并承接发现、书架、历史、正文、书评、纠错和性能上报。
reader-auth.js: Reader 账号路由，处理 CDK 注册、密码/Telegram 登录、签到、资料与 session 生命周期。
reader-tts.js: Reader TTS 路由，在会话鉴权与 SSRF 校验后代理或调用受支持语音提供商。
review-governance.js: 书评治理路由，分别暴露 Reader/Bot 举报申诉与 Admin 审核处理边界。
upload-api.js: 油猴上传兼容路由，以 Upload Token 保护元信息/正文写入，为所有平台提供不触碰正文的 order-only 更新，并让响应严格反映真实落库结果。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
