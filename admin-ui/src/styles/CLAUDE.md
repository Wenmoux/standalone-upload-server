# styles/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Admin 全局视觉模块按 CSS 级联顺序拆分。`styles.css` 是唯一入口；这里的文件只定义共享语义和既有领域布局，不引入第二套设计令牌。

## 成员清单

`foundation.css`: 视觉地基，定义排版、按钮、表单、应用外壳和导航等共享原语。
`workflow.css`: 通用工作流层，定义保存视图、筛选、通知、弹窗、任务优先总览和配置折叠。
`content.css`: 内容管理层，定义数据表、书籍、任务、质量差异等高密度内容结构。
`operations.css`: 运维领域层，定义系统状态、备份、可观测性、EPUB 和爬虫控制台布局。
`responsive.css`: 最终覆盖层，集中维护移动端抽屉、窄屏重排、确认弹窗和审计响应式规则。

## 级联约束

- 文件加载顺序即依赖方向：foundation → workflow → content → operations → responsive。
- 共享令牌只来自 `ui/design-tokens.css`；新规则优先放入职责对应模块，窄屏覆盖统一进入 `responsive.css`。
- 修改选择器归属或加载顺序后必须重新执行 Admin 构建并进行桌面/移动端视觉验收。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
