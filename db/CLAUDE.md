# db/
> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

数据库模块是 PostgreSQL Schema 的唯一演进边界。应用启动只消费有序 migration；rollback 仅供显式人工处置，不能代替新的补偿 migration。

## 成员清单

- `MIGRATIONS.md`：迁移、备份、回滚与故障修复手册；命令统一使用 `PO18_PG_URL`，并说明容器配置加载边界。
- `schema-snapshot.json`：正向 migration 链的文件名、SHA-256 与整体 fingerprint 快照，由 Schema 漂移门禁核对。
- `migrations/`：从空库基线到当前 Schema 的唯一正向 SQL 来源；已发布文件不可原地修改。
- `rollbacks/`：与可逆正向 migration 一一对应的人工 down SQL；`001_baseline` 因破坏性过高而没有自动 rollback。

## 数据流与约束

```text
db/migrations/*.sql -> pg-store.runMigrations -> schema_migrations -> PostgreSQL
db/rollbacks/*.down.sql -> scripts/migrate-rollback.js -> 人工确认后的逆向操作
db/migrations/*.sql -> scripts/check-schema-drift.js -> schema-snapshot.json
```

- `schema_migrations.version` 是完整的文本版本，例如 `020_taxonomy_and_quality_semantics`，不是整数。
- `chapter_cache(book_id, chapter_order)` 对正数顺序实行全平台唯一；024 在建索引前只重排存在重复的书，`chapter_order = 0` 继续表达未排序占位。
- 新 migration 必须保持词法递增、补充安全 rollback（可逆时）、更新 Schema snapshot，并通过真实 PostgreSQL 集成测试；已发布迁移的前置数据兼容修复可使用尚未占用且排序在目标之前的同号版本，但必须由测试锁定顺序。
- 已应用 migration 的 checksum 与镜像内文件不一致时默认拒绝启动；漂移开关只用于应急诊断。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
