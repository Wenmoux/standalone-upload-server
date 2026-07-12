# admin-ui/src/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Admin 单页应用的可执行语义层。`main.js` 装配 Vue，`App.vue` 维持认证与权限上下文，`router.js` 延迟加载领域视图；视图统一经 `services/api.js` 访问服务端，并复用组件与格式化工具保持交互一致。

## 成员清单

`App.vue`: 应用组合根，解析当前管理员、版本和访问能力，向下提供提示/确认服务并承载导航与备份快捷操作。
`main.js`: 浏览器启动入口，安装路由、全局样式并把 `App` 挂载到 `#app`。
`router.js`: Admin 导航与路由事实源，集中定义页面键、权限元数据和懒加载视图。
`styles.css`: 后台全局设计令牌、布局与组件基础样式，由 `main.js` 唯一引入。
`components/ConfirmDialog.vue`: 全局高风险操作确认器，收集可选原因并把确认结果交回调用视图。
`components/DataTable.vue`: 声明式表格外壳，通过列定义和插槽统一空状态、单元格与行操作渲染。
`components/EpubStyleEditor.vue`: EPUB 导出样式配置与资产预览工作台，读取内置 CSS/图片并经 Admin API 管理自定义模板资产。
`components/FormModal.vue`: 通用表单弹窗容器，统一关闭门禁、提交状态和错误提示槽位。
`components/StatCard.vue`: 仪表盘数值卡片，以标签、数值、提示或插槽呈现单一指标。
`components/StatusBadge.vue`: 状态语义标签，以 tone 类名承接父视图的状态映射。
`components/ToastHost.vue`: 应用级瞬时消息出口，由 `App.vue` 提供的提示状态驱动。
`services/api.js`: Admin 同源 HTTP 边界，统一携带 Cookie、序列化响应并将失败转换为 `ApiError`。
`utils/format.js`: 后台展示格式化与 Reader 地址推导工具，避免领域视图重复实现数值、时间和平台标签规则。
`views/AuditView.vue`: 管理审计查询页，按操作、主体和时间筛选服务端审计记录。
`views/BooklistView.vue`: 动态榜单缓存运维页，展示来源状态并触发显式刷新任务。
`views/BooksView.vue`: 书籍/章节主维护页，涵盖筛选、清单导入、增删改、陈旧清理和章节批量操作。
`views/CdksView.vue`: Reader 注册码生命周期页，负责生成、筛选和带原因撤销 CDK。
`views/CorrectionsView.vue`: 正文纠错审核页，查询待办并执行通过、驳回与审核备注写入。
`views/DashboardView.vue`: 运营总览页，将书库、缓存、用户、反馈与 Bot 指标聚合为只读仪表盘。
`views/EventsView.vue`: 内容更新事件页，展示最近上传、修改和删除记录。
`views/FeedbackView.vue`: 反馈治理页，聚合热词、书籍反馈、求书、众筹及书评举报/申诉处置。
`views/JobsView.vue`: 持久任务中心，查询任务详情并按服务端状态机执行重试或取消。
`views/LoginView.vue`: Admin 登录门面，提交凭据并把认证结果交给 `App.vue` 切换会话态。
`views/PlatformsView.vue`: 平台标识映射页，维护服务端自动发现平台的人工展示名称。
`views/Po18CrawlerView.vue`: PO18 遍历任务控制台，维护 Cookie/计划参数并控制运行、暂停、恢复和停止。
`views/QualityView.vue`: 数据质量诊断页，展示异常聚合并预览、执行章节顺序修复。
`views/SystemView.vue`: 系统运维中心，覆盖状态、日志、备份/恢复、远端备份、指标、管理员、API Token、诊断与重启。
`views/TelegramView.vue`: Telegram 运营与导出配置中心，维护 Bot 命令、注册用户全员通知、频道类型/日报、EPUB 样式和连接测试。
`views/TransactionsView.vue`: 货币流水查询页，按用户、币种和类型分页检索交易记录。
`views/UsersView.vue`: Reader 用户管理页，维护账号、会员与余额，并让 owner 通过专用审计动作设置或取消 Reader/Bot 管理员。

## 边界约束

- 认证态与全局交互能力由 `App.vue` provide，视图通过 inject 消费，不自行维护第二套会话状态。
- 服务端是权限与状态机的最终裁决者；前端可隐藏不可用动作，但不能把 UI 门禁当作授权。
- 新页面必须先进入 `router.js` 导航事实源，再在本清单登记；共享交互优先扩展现有组件。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
