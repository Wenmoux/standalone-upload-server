# scripts/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

可重复执行的工程与运维 CLI 集合；脚本复用生产模块的校验和数据边界，避免形成第二套业务实现。

## 成员清单

- `audit-chapter-order-against-site.js`: 以来源站目录审计章节顺序，只生成差异证据。
- `check-build-context.js`: 校验 Docker 构建上下文与必要发布产物，阻止不完整镜像进入流水线。
- `check-docs.js`: 校验 Markdown 相对链接、必需 L1/L2 地图和多语言源码 L3 契约，作为 GEB 回环 CI 门禁。
- `check-schema-drift.js`: 对比迁移演进与 schema snapshot，阻止数据库语义漂移。
- `check-utf8.js`: 扫描受控文本文件的 UTF-8 与异常乱码模式。
- `clean-chapter-titles.js`: 调用统一标题清洗能力批量修正章节标题。
- `docker-build.js`: 构建含源码身份的不可变镜像标签并向工作流输出结果。
- `docker-push.js`: 将已验证镜像标签发布到 registry，不保存本地凭证。
- `docker-release-manifest.js`: 生成发布标签、来源与摘要元数据，约束可变和不可变标签语义。
- `docker-smoke.js`: 启动候选镜像与临时 PostgreSQL，验证 Setup、服务和深健康路径。
- `generate-reader-pwa-icons.js`: 从项目图标源生成 Reader PWA 尺寸集合。
- `local-library-upload-ui.js`: 本地书库上传工具的独立 UI 资源与交互实现。
- `migrate-rollback.js`: 加载 `/config` 配置后调用 pg-store 执行显式迁移回滚。
- `publish-admin-ui.mjs`: 清理旧 Admin assets 并复制当前 dist 到根 `public/`，保留 Reader/书源等非 Admin 兼容文件。
- `release-docker.ps1`: Windows 本地发布辅助入口；实际默认发布由 GitHub Actions 承担。
- `release-docker.sh`: POSIX 本地发布辅助入口；复用相同镜像标签和校验语义。
- `repair-chapter-order-by-source-catalog.js`: 按已抓取来源目录生成并应用章节排序修复。
- `repair-chapter-order-by-title.js`: 依据标题序列推导章节排序修复，包含冲突保护。
- `repair-chapter-order.js`: 通用章节顺序诊断与修复编排入口。
- `repair-qidian-chapter-order-by-title.js`: 起点来源专用标题顺序修复适配器。
- `run-node-tests.js`: 固定测试文件发现、覆盖率门槛与退出码的根测试运行器。
- `run-pg-integration.js`: 在真实 PostgreSQL 上执行迁移、路由和查询计划集成验证。
- `search-benchmark.js`: 对搜索 SQL 计划与延迟预算执行可重复基准。
- `start-site-order-audit.ps1`: Windows 章节站点审计启动辅助脚本。
- `upload-local-library.js`: 本地书库解析、校验、分批上传与断点状态 CLI。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
