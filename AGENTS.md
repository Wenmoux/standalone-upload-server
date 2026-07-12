# PO18 Reader Stack Agent Guide

进入本仓库后，先读根目录 `CLAUDE.md`，再读目标模块的 `CLAUDE.md`，最后检查目标代码文件的 L3 头部契约。

## 强制回环

```text
代码修改 → L3 文件契约 → L2 模块地图 → L1 项目地图 → 验证
文档修改 → 对照代码事实 → 更新对应测试/配置 → 验证
```

- 新增、删除、重命名文件时必须更新所属模块的 `CLAUDE.md`。
- 依赖、导出或职责变化时必须更新代码文件的 `[INPUT]/[OUTPUT]/[POS]`。
- L2/L3 必须包含：`[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md`。
- 不允许用历史评估报告替代当前运行文档；当前事实以代码、运行时 OpenAPI、README、DOCKER 和 `docs/` 为准。
- 已发布 `db/migrations/*.sql` 与对应 rollback 受 checksum/不可变历史约束，不得为了补头注释原地修改；其架构契约由 `db/*/CLAUDE.md` 承担，新语义通过更高版本 migration 演进。
- `public/`、`dist/`、`dist-reader/` 等生成产物不得手工补 L3；契约写在源码或生成器，产物通过构建重新生成。
- `npm run check:docs` 同时验证 Markdown 链接、必需 L1/L2 地图以及 JS/Vue/CSS/Python/Shell/PowerShell 源码的完整 L3 标记。

## 项目边界

- PostgreSQL 16 是默认和持续验证的数据库。
- Bot 不直连数据库；业务写入通过 server API。
- Reader `3200` 只代理 Reader Auth/API；Upload/Bot/Admin API 访问 `3100`。
- 生产绑定非 localhost 时 `PO18_METRICS_TOKEN` 必填。
- migration 只通过 `db/migrations` 演进，已发布 SQL 不原地修改。
- Admin 源码变化后执行 `npm run admin:build` 并提交 `public/` 发布产物。
- Docker 发布默认由 `main` 推送触发 GitHub Actions；本地 Token 不进入仓库。

## 必跑检查

```bash
npm run check:docs
npm run check:utf8
npm run check:schema
npm run lint
npm test
npm run admin:build        # Admin 变化时
npm --prefix cirno-src run build:standalone  # Reader 变化时
npm run check:context      # Docker 输入变化时
```

## 质量约束

- 优先沿用现有 routes/services/utils/logger/request 封装，避免另起并行范式。
- 单文件超过 800 行视为重构信号；新增功能优先拆到现有领域模块。
- 保护用户已有工作区修改，不使用破坏性 Git 命令。
- 配置、日志、示例和测试不得包含可用 Token、Cookie、密码、数据库 URL 或私人正文。
- DRY、KISS、YAGNI 优先；文档必须说明真实职责、依赖方向和数据流，不罗列无意义细节。
