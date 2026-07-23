# 文档索引

本目录区分“当前操作手册”和“历史评估快照”。部署或排障时，应优先使用当前操作手册和运行时 `/openapi.json`，不要把历史报告中的旧版本、旧测试数字或待办直接当作当前事实。

## 当前操作手册

| 文档 | 职责 |
| --- | --- |
| [项目 README](../README.md) | 产品概览、最短部署路径和统一导航 |
| [Docker 部署与运维](../DOCKER.md) | Docker、Compose、升级、备份、健康检查和发布 |
| [架构说明](ARCHITECTURE.md) | 服务边界、数据流、任务、迁移、安全和发布架构 |
| [配置参考](CONFIGURATION.md) | 必填配置、端口、超时、Bot、备份和高级变量 |
| [排障手册](TROUBLESHOOTING.md) | 启动、迁移、Metrics、Bot、数据库和 Reader 常见问题 |
| [API 文档](../API.md) | 人工维护的示例、鉴权说明和兼容记录 |
| `/openapi.json` | 运行实例生成的机器可读端点与 Schema 索引 |
| [数据库迁移](../db/MIGRATIONS.md) | 迁移锁、超时、备份、rollback 和手动修复 |
| [Telegram Bot](../bot/README.md) | 当前命令、权限、导出和任务流程 |
| [EPUB 样式](../bot/epub-styles/README.md) | 样式注册、预览、资源和兼容边界 |
| [Reader](../cirno-src/README.md) | Reader 功能、独立开发和构建 |
| [2026-07-23 综合审计报告](../PROJECT_COMPREHENSIVE_ANALYSIS_2026-07-23.md) | 当前代码、逻辑、UI、安全、测试和文档完整度评估 |
| [可优化完善与功能路线图](../PROJECT_OPTIMIZATION_FEATURE_ROADMAP_2026-07-23.md) | 后续优化、可增加功能、用户价值和实施顺序 |

## Agent 与代码地图

| 文档 | 职责 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 进入仓库、回环顺序、项目边界与必跑检查 |
| [L1 项目地图](../CLAUDE.md) | 技术栈、顶级目录、依赖方向与全局法则 |
| 各模块 `CLAUDE.md` | L2 成员清单、职责边界和父级链接 |
| 源码文件首部 L3 | `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 可执行语义契约 |

`npm run check:docs` 会验证当前 Markdown 断链、必需模块地图和受控源码 L3。已发布 migration 不能为了增加注释改变 checksum，生成产物也不能手改；这两类契约分别由数据库 L2 地图和源码/生成器承担。

## 维护与历史

| 文档 | 状态 |
| --- | --- |
| [阶段更新记录](../PROJECT_UPDATE_LOG.md) | 按阶段记录用户可感知变化和重要修复 |
| [v2.0 优化进度](../V2_OPTIMIZATION_PROGRESS.md) | v2.0 实施清单与当时的验证快照；不作为当前验证结果 |
| [2026-07-23 综合审计报告](../PROJECT_COMPREHENSIVE_ANALYSIS_2026-07-23.md) | 当前评估，取代旧报告中的测试数字和开放风险排序 |
| [可优化完善与功能路线图](../PROJECT_OPTIMIZATION_FEATURE_ROADMAP_2026-07-23.md) | 当前建议路线，取代口头零散待办 |
| [2026-07-11 综合改善报告](../PROJECT_COMPREHENSIVE_IMPROVEMENT_REPORT_2026-07-11.md) | 原始评估与 7 月 12 日复核快照，不是运行手册 |
| [2026-06-06 综合评估](../PROJECT_COMPREHENSIVE_ASSESSMENT.md) | 已归档的早期评估 |
| [繁简转换维护](../cirno-src/docs/chinese-conversion.md) | Reader 转换规则维护 |
| [繁简转换测试报告](../cirno-src/docs/chinese-conversion-test-report-2026-05-07.md) | 带日期的测试快照 |

## 文档维护规则

1. README 只保留概览、最短上手和导航，不复制完整环境变量清单。
2. Docker 运行事实只写入 `DOCKER.md`，配置默认值写入 `docs/CONFIGURATION.md`。
3. API 端点新增时同时更新 OpenAPI 定义、路由测试和必要的人工示例。
4. 数据库变更必须同步 migration、rollback、schema snapshot 和 `db/MIGRATIONS.md`。
5. 历史报告只追加状态说明，不回写成当前操作手册。
6. 提交前运行 `npm run check:docs`，保证相对链接仍可解析。
