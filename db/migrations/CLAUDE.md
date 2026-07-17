# db/migrations/
> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

本目录保存完整、排序稳定的正向 Schema 演进链。`001` 是空库基线，`002`–`003` 的版本空档为历史兼容边界，不得重编号现有文件填补。

## 成员清单

- `001_baseline.sql`：空库唯一基线，建立书库、章节、Reader/Admin、交易、备份、任务与基础索引。
- `004_trgm_indexes.sql`：启用 `pg_trgm` 并为书号、书名、作者和标签建立模糊检索索引。
- `005_system_jobs.sql`：建立持久系统任务及其状态、类型和创建时间索引。
- `006_book_stats.sql`：建立书籍聚合统计表和来源表触发同步逻辑。
- `007_bot_audit_logs.sql`：建立 Telegram Bot 命令与动作审计记录。
- `008_reader_search_requests.sql`：建立 Reader 缺书请求及其用户、查询和处理状态数据。
- `009_book_reviews.sql`：建立书评、投票和相关检索索引。
- `010_word_cloud_indexes.sql`：为词云和缓存热度查询补充表达式索引。
- `011_chapter_stats_incremental.sql`：将章节统计改为 statement-level 增量维护，消除批量写入逐行重算。
- `012_admin_audit_logs.sql`：建立追加式管理员审计表，并用触发器禁止篡改历史记录。
- `013_system_job_leases.sql`：为任务补充优先级、租约、心跳、重试、取消和幂等调度字段。
- `014_api_tokens.sql`：建立只保存摘要的 Scope API Token、来源 IP、吊销和使用审计模型。
- `015_admin_roles.sql`：为管理员增加受约束的 `owner/operator/moderator/viewer` 角色。
- `016_search_request_workflow.sql`：扩展缺书请求为可处理、可通知的闭环工作流。
- `017_reader_rum.sql`：建立不含正文和凭据的 Reader 性能事件存储。
- `018_data_quality_guards.sql`：以 `NOT VALID` 等约束保护新写入，同时允许历史异常数据继续升级。
- `019_job_effect_idempotency.sql`：建立任务副作用账本和 operation key，防止租约重跑重复扣费或发奖。
- `019_taxonomy_input_deduplication.sql`：在 taxonomy 建表前仅归并同一书籍、同一类型内规范值重复的历史分类/标签，保证后续回填可确定执行。
- `020_taxonomy_and_quality_semantics.sql`：规范分类/标签与时间语义，并将章节序号检查推迟到事务提交。
- `021_book_manifest_checksums.sql`：为书籍 Manifest 的元信息和章节补充可验证 SHA-256 摘要。
- `022_review_governance.sql`：建立书评举报、审核、申诉和有限改票治理模型。
- `023_taxonomy_conflict_deduplication.sql`：将 taxonomy 同步函数改为先按规范值去重再写入，阻止重复标签触发单语句冲突。
- `024_chapter_order_uniqueness.sql`：按 `chapter_order → chapter_id → id` 修复历史重复顺序，并将同书正数顺序唯一约束扩展到全部平台。

## 演进规则

- 每个文件由启动迁移器在独立事务内执行，并以文件内容 SHA-256 记录在 `schema_migrations`。
- 已发布文件只读；修复必须新增更高版本，不能改写历史 checksum。
- 业务运行时代码不得绕过本目录执行 Schema DDL。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
