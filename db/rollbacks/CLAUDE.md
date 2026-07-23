# db/rollbacks/
> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

本目录保存人工确认后才能执行的逆向 SQL。它是事故处置工具，不是正常发布路径；任何可能丢失数据的回退都优先恢复预迁移备份。

## 成员清单

- `004_trgm_indexes.down.sql`：移除书库模糊检索索引。
- `005_system_jobs.down.sql`：移除持久系统任务表及索引。
- `006_book_stats.down.sql`：移除书籍统计同步触发器、函数和聚合表。
- `007_bot_audit_logs.down.sql`：移除 Bot 审计表。
- `008_reader_search_requests.down.sql`：移除 Reader 缺书请求表。
- `009_book_reviews.down.sql`：移除书评投票、书评及其索引。
- `010_word_cloud_indexes.down.sql`：移除词云专用索引。
- `011_chapter_stats_incremental.down.sql`：移除 statement-level 统计逻辑并恢复旧逐行维护行为。
- `012_admin_audit_logs.down.sql`：移除管理员审计保护函数、触发器和表。
- `013_system_job_leases.down.sql`：移除任务租约、重试、取消和幂等调度扩展。
- `014_api_tokens.down.sql`：移除 Scope API Token 表。
- `015_admin_roles.down.sql`：移除管理员角色约束和字段。
- `016_search_request_workflow.down.sql`：移除缺书处理闭环字段与索引。
- `017_reader_rum.down.sql`：移除 Reader 性能事件表。
- `018_data_quality_guards.down.sql`：移除新增数据质量约束与异常检索索引。
- `019_job_effect_idempotency.down.sql`：移除任务副作用 operation key 与幂等账本。
- `020_taxonomy_and_quality_semantics.down.sql`：移除分类规范化、时间语义与延迟序号检查扩展。
- `021_book_manifest_checksums.down.sql`：移除 Manifest checksum 字段、约束和索引。
- `022_review_governance.down.sql`：移除书评举报、申诉和改票治理扩展。
- `023_taxonomy_conflict_deduplication.down.sql`：恢复 020 的原始 taxonomy 同步函数；仅用于立即回滚，重复 token 会重新成为写入风险。
- `024_chapter_order_uniqueness.down.sql`：恢复旧平台例外索引；已完成的历史顺序重排不会逆转。
- `025_reader_daily_chapter_quota.down.sql`：移除每日章节用量账本及 Reader 用户上限字段；已记录的阅读事实会丢失。

## 回退规则

- `001_baseline` 没有 down SQL；需要撤销完整基线时只能恢复备份或销毁明确确认无用的数据库。
- `019_taxonomy_input_deduplication` 是不可逆的等价历史数据清理，故意没有 down SQL；需要跨越它回退时恢复预迁移备份。023 可显式回滚但会恢复旧函数风险；024 只回退约束范围，数据顺序需依靠预迁移备份恢复；025 回退会删除阅读用量事实，执行前必须确认不再需要当日计数。
- 回滚器按已应用版本倒序执行，并持有与启动迁移相同的 PostgreSQL advisory lock。
- 缺少对应 down 文件时回滚立即终止，不允许跳过版本继续回退。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
