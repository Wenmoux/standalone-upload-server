# PostgreSQL 迁移与回滚手册

> 当前运行事实：正向 Schema 只来自 `db/migrations/*.sql`，人工回滚只来自 `db/rollbacks/*.down.sql`，应用状态记录在 `schema_migrations`。本手册以 PostgreSQL 16 和当前代码为准。

## 1. 不变量

- `001_baseline.sql` 是空库唯一基线；空库和升级库执行同一条有序 migration 链。
- 已发布 migration 不得原地修改。已应用文件的 SHA-256 与镜像内容不一致时，启动默认失败。
- `PO18_ALLOW_MIGRATION_CHECKSUM_DRIFT=1` 只允许应急诊断，不会修复 Schema，也不能作为常驻配置。
- 修复已发布 migration 必须新增更高版本；可安全逆转时同步新增同名 `.down.sql`。
- 每次改变 migration 链都要更新 `db/schema-snapshot.json`，并通过 `npm run check:schema` 与真实 PostgreSQL 测试。
- 生产 Schema 变更和人工回滚前必须先创建、校验并离线保留备份。

`schema_migrations.version` 是完整文本，例如 `020_taxonomy_and_quality_semantics`；不要把它当成整数 `20` 或 `0`。

## 2. 启动迁移如何运行

`server-pg` 启动时由 `pg-store.runMigrations()` 执行以下流程：

1. 尝试获取 PostgreSQL advisory lock `182018`。
2. 未拿到锁的实例返回 `55P03`，启动层记录 `database migrations are running in another instance` 并稍后重试；它不会与另一个实例并发改 Schema。
3. 按文件名排序读取 migration，核对已应用 checksum。
4. 每个未应用 migration 在独立事务内执行；成功后才写入 `schema_migrations` 并提交，失败会回滚该事务。
5. 释放 advisory lock，继续启动 HTTP 服务。

普通业务查询默认超时 30000ms；migration 使用独立的 `PO18_PG_MIGRATION_TIMEOUT_MS`，默认 `600000`ms（10 分钟），并同时设置客户端 query timeout 和事务内 PostgreSQL `statement_timeout`。可配置范围不低于普通查询超时、最高 1 小时。

看到以下日志表示 `020` 正在由唯一持锁实例执行，不代表死循环：

```text
[pg-migrate] applying 020_taxonomy_and_quality_semantics (timeout 600000ms)
[pg-migrate] applied 020_taxonomy_and_quality_semantics
```

其它实例在此期间重复输出“migrations are running in another instance”属于预期重试。只有持锁实例超过 10 分钟报错、反复从同一 `applying` 重新开始，才需要检查 PostgreSQL 锁、磁盘空间、慢 SQL 和服务器负载。

## 3. 容器内加载数据库配置

应用使用 `PO18_PG_URL`，不是 `DATABASE_URL`。Setup 生成的配置保存在 `/config/app.env`；`docker exec` 启动的新 shell 不会自动读取这个文件。

本文以单容器名 `po18-app` 为例。若使用 `docker-compose.hub.yml`，可把 `docker exec po18-app` 替换为：

```bash
docker compose -f docker-compose.hub.yml exec server-pg
```

执行 `psql`、`pg_dump` 或 `pg_restore` 前显式加载配置：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "SELECT current_database(), version();"'
```

回滚 CLI 已通过项目配置加载器读取 `PO18_CONFIG_FILE`（默认 `/config/app.env`），不需要再手工 source；自定义配置路径时显式传入 `PO18_CONFIG_FILE`。

## 4. 发布前检查与备份

先确认磁盘空间、数据库连通性和当前 migration 状态：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "SELECT version, name, checksum, duration_ms, app_version, applied_at FROM schema_migrations ORDER BY version;"'
```

再创建 PostgreSQL custom-format 备份；文件保存在持久化 `/config/backups`：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; mkdir -p /config/backups; pg_dump "$PO18_PG_URL" --format=custom --file="/config/backups/pre-migration-$(date +%Y%m%d-%H%M%S).dump"'
```

对刚创建的归档做结构校验：

```bash
docker exec po18-app sh -lc 'latest=$(ls -1t /config/backups/pre-migration-*.dump | head -n 1); pg_restore --list "$latest" >/dev/null && sha256sum "$latest"'
```

确认备份能被读取且 SHA-256 已另行保存后，再发布新镜像。正常情况下无需手工执行 SQL；启动迁移器会完成升级。

## 5. 当前迁移链

当前链为 `001_baseline`，随后是 `004_trgm_indexes` 至 `023_taxonomy_conflict_deduplication`，共 22 个正向 migration。`002`–`003` 的空档属于历史版本边界；`019_taxonomy_input_deduplication` 是专门排在 020 前的历史数据兼容修复，不能重命名既有文件改变顺序。

后段迁移的关键语义：

- `018_data_quality_guards`：用 `NOT VALID` 约束保护新写入，不强制全表扫描旧异常；历史数据清理后再逐条 `VALIDATE CONSTRAINT`。
- `019_job_effect_idempotency`：任务扣费、额度和奖励的 exactly-once 操作账本。
- `019_taxonomy_input_deduplication`：只归并历史数据中规范值重复的分类/标签，避免 020 回填在同一条语句内重复命中主键。
- `020_taxonomy_and_quality_semantics`：规范 taxonomy 与时间语义，并将章节序号检查推迟到事务提交。
- `021_book_manifest_checksums`：为 Manifest 元信息和章节增加校验和。
- `022_review_governance`：增加书评举报、审核、申诉与有限改票。
- `023_taxonomy_conflict_deduplication`：让后续元信息写入先去重 taxonomy token，再写入规范化主键。

这些迁移均没有引入 `book_key`，也没有改变现有平台无感知 API 字段。

## 6. 人工回滚

回滚永远不会在正常启动时自动发生。CLI 同时要求环境开关和精确确认词，并获取同一个 advisory lock；如果有启动迁移正在执行，它会等待锁释放。

回滚最新一个 migration：

```bash
docker exec po18-app sh -lc 'cd /app && PO18_ALLOW_SCHEMA_ROLLBACK=1 npm run db:rollback -- --steps 1 --confirm ROLLBACK'
```

回滚所有高于目标版本的 migration（目标本身保留）：

```bash
docker exec po18-app sh -lc 'cd /app && PO18_ALLOW_SCHEMA_ROLLBACK=1 npm run db:rollback -- --to 005_system_jobs --confirm ROLLBACK'
```

规则：

1. 回滚前再次确认预迁移备份存在且可读。
2. migration 删除或转换过数据时优先恢复备份，不依赖 down SQL 猜测恢复数据。
3. 加法式 Schema 错误优先新增补偿 migration，保持所有实例的演进历史一致。
4. 只有确认目标 down SQL 对当前数据安全时才使用 `db:rollback`。
5. `001_baseline` 故意没有 down SQL；完整撤销只能恢复备份，或销毁明确确认不再需要的数据库。

## 7. 失败诊断与人工修复

先查看最近记录：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "SELECT version, name, duration_ms, app_version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 8;"'
```

- 未写入 `schema_migrations`：该 migration 的事务已经回滚。修复磁盘、连接或 SQL 问题后重启，让迁移器重试。
- 020 报 `ON CONFLICT DO UPDATE command cannot affect row a second time`：历史分类/标签存在大小写或分隔符归一后重复项；部署包含 `019_taxonomy_input_deduplication` 与 `023_taxonomy_conflict_deduplication` 的镜像，不能修改 020 或手工伪造迁移记录。
- 已记录但 Schema 被之后的人工操作破坏：优先恢复备份或新增补偿 migration，不要直接篡改迁移历史。
- checksum 不一致：恢复镜像内已发布文件，或发布更高版本 migration；不要把 drift 开关当修复。

只有在已经逐对象核对、确认 migration 没有留下任何 Schema 或数据变化时，才允许删除错误记录。版本必须按文本精确匹配：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "DELETE FROM schema_migrations WHERE version = '\''020_taxonomy_and_quality_semantics'\'';"'
```

这一步会让下次启动重新执行该文件，风险高于补偿 migration 或恢复备份。

## 8. 受控数据修复

`book_stats` 与来源表漂移时，可在备份后重算，不需要删除数据：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "SELECT refresh_book_stats(book_id) FROM (SELECT book_id FROM book_metadata UNION SELECT book_id FROM chapter_cache UNION SELECT book_id FROM reader_book_feedback UNION SELECT book_id FROM reader_book_crowd_votes) s WHERE book_id IS NOT NULL;"'
```

进程退出遗留过久的 `running` 任务应优先交给租约恢复机制；只有确认 Worker 不再持有任务时才人工标记失败：

```bash
docker exec po18-app sh -lc 'set -a; . /config/app.env; set +a; psql "$PO18_PG_URL" -c "UPDATE system_jobs SET status = '\''failed'\'', error = '\''process exited before completion'\'', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE status = '\''running'\'' AND updated_at < now() - interval '\''30 minutes'\'';"'
```

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
