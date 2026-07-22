# admin-ui/src/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Admin 单页应用的可执行语义层。`main.js` 装配 Vue，`App.vue` 维持认证、权限和全局交互上下文，`router.js` 延迟加载领域视图；视图统一经 `services/api.js` 访问服务端，并复用组件与工具保持交互一致。

## 成员清单

`App.vue`: 应用组合根，解析当前管理员、版本和访问能力，向下提供消息队列、确认/输入服务并承载分组导航与备份快捷操作。
`main.js`: 浏览器启动入口，安装路由、全局样式并把 `App` 挂载到 `#app`。
`router.js`: Admin 导航与路由事实源，集中定义页面键、权限元数据和懒加载视图。
`styles.css`: 后台全局样式聚合入口，按固定级联顺序引入设计令牌与 `styles/` 模块，由 `main.js` 唯一消费。
`styles/`: 全局视觉分层模块，按 foundation、workflow、content、operations、responsive 顺序组织；详见 `styles/CLAUDE.md`。
`components/ConfirmDialog.vue`: 全局高风险操作确认器，收集可选原因并把确认结果交回调用视图。
`components/DataTable.vue`: 声明式表格外壳，通过列定义和插槽统一键盘排序、加载/空状态、单元格与行操作渲染。
`components/EpubStyleEditor.vue`: EPUB 导出样式配置与资产预览工作台，按最终 XHTML 同构预览内置 CSS/图片并经 Admin API 管理自定义模板资产。
`components/epub-style-editor.css`: EPUB 样式工作台局部样式，隔离预览设备、配置栏和图片资源列表的响应式布局。
`components/FormModal.vue`: 通用表单弹窗容器，统一关闭门禁、提交状态和错误提示槽位。
`components/InputDialog.vue`: 应用级单值输入器，以非阻塞弹窗统一文本、长文本与枚举选择任务。
`components/StatCard.vue`: 仪表盘数值卡片，以标签、数值、提示或插槽呈现单一指标。
`components/StatusBadge.vue`: 状态语义标签，以 tone 类名承接父视图的状态映射。
`components/ToastHost.vue`: 应用级消息队列出口，由 `App.vue` 提供的语义提示队列驱动并向辅助技术播报。
`services/api.js`: Admin 同源 HTTP 边界，统一携带 Cookie、序列化响应、转换 `ApiError` 并广播 Session 失效。
`utils/clipboard.js`: 剪贴板能力适配层，在标准 API 受限时使用无阻塞选区复制兜底。
`utils/dialogFocus.js`: 弹窗焦点协议工具，统一首焦点、Tab 闭环和关闭后焦点恢复。
`utils/format.js`: 后台展示格式化与 Reader 地址推导工具，避免领域视图重复实现数值、时间和平台标签规则。
`utils/lazyWorkspace.js`: 页内工作区按需加载调度器，统一首次加载缓存与当前分区强制刷新。
`views/AuditView.vue`: 管理审计查询页，按操作、主体和时间筛选服务端审计记录。
`views/BooklistView.vue`: 动态榜单缓存运维页，展示来源状态并触发显式刷新任务。
`views/BooksView.vue`: 书籍/章节主维护页，涵盖筛选、清单导入、增删改和章节批量操作；不再暴露旧 PO18 批量清理入口。
`views/books-config.js`: 书库视图的稳定声明配置，集中提供平台、表格列、表单字段与数值转换清单。
`views/CdksView.vue`: Reader 注册码生命周期页，负责生成、筛选和带原因撤销 CDK。
`views/CorrectionsView.vue`: 正文纠错审核页，查询待办并执行通过、驳回与审核备注写入。
`views/DashboardView.vue`: 任务优先运营总览，将积压入口置顶并把书库、用户、反馈与 Bot 全量指标折叠展示。
`views/EventsView.vue`: 内容更新事件页，展示最近上传、修改和删除记录。
`views/FeedbackView.vue`: 分区反馈治理页，按待办徽标组织热词、书籍反馈、求书、众筹及书评举报/申诉处置。
`views/JobsView.vue`: 持久任务中心，运行期自动刷新，查询详情并按服务端状态机执行重试或取消。
`views/LoginView.vue`: Admin 登录门面，提交凭据并把认证结果交给 `App.vue` 切换会话态。
`views/PlatformsView.vue`: 平台标识映射页，维护服务端自动发现平台的人工展示名称。
`views/Po18CrawlerView.vue`: PO18 遍历任务控制台，常驻呈现运行状态并分层维护 Cookie/计划/风险参数及任务控制。
`views/QualityView.vue`: 数据质量诊断页，展示异常聚合，以完整总数和逐书明细确认全量同名分卷去重与重复顺序修复；合法顺序缺口保持不变，完成后自动定位全部实际改动书籍表。
`views/SystemView.vue`: 按需加载的分区系统运维中心，按运行、权限、备份、日志组织指标、管理员、Token、诊断与重启。
`views/system-backups.js`: 系统备份工作区组合层，封装索引、上传、远端归档、验证、恢复演练与数据库恢复状态机。
`views/system-config.js`: 系统页稳定声明与纯展示规则，集中工作区、日志筛选、状态、性能、备份、版本和 RUM 映射。
`views/TelegramView.vue`: 按需加载的分区 Telegram 运营中心，按运行、消息、导出、命令组织全员通知、频道日报、EPUB 样式和连接测试。
`views/TransactionsView.vue`: 货币流水查询页，按用户、币种和类型分页检索交易记录。
`views/UsersView.vue`: Reader 用户管理页，维护账号、会员与余额，并让 owner 通过专用审计动作设置或取消 Reader/Bot 管理员。

## 边界约束

- 认证态与全局交互能力由 `App.vue` provide，视图通过 inject 消费，不自行维护第二套会话状态。
- 服务端是权限与状态机的最终裁决者；前端可隐藏不可用动作，但不能把 UI 门禁当作授权。
- 新页面必须先进入 `router.js` 导航事实源，再在本清单登记；共享交互优先扩展现有组件。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
