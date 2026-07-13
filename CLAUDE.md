# PO18 Reader Stack - 自托管小说书库、Reader、Admin 与 Telegram Bot 一体化平台

Node.js 20 + Express 4 + PostgreSQL 16 + Vue 3 + Vite 8 + Docker + GitHub Actions

<directory>
.github/ - CI、依赖更新与 Docker 发布 (2 子目录/文件: workflows、dependabot)
admin-ui/ - Vue 3 管理后台 (2 核心目录: src、dist)
assets/ - README、EPUB 独立 CSS/XHTML 模板与发布静态资源
benchmarks/ - 搜索计划性能预算
bot/ - Telegram polling、命令、持久任务与 TXT/EPUB 导出 (2 子目录: commands、epub-styles)
cirno-src/ - Vue 3 Reader、Reader server 与离线/PWA 能力 (4 子目录: src、docs、scripts、public)
db/ - PostgreSQL schema 演进 (3 核心项: migrations、rollbacks、schema-snapshot)
docker/ - 镜像入口、Setup、进程监管、健康与备份
docs/ - 当前架构、配置、排障与文档导航
monitoring/ - Prometheus 告警规则
public/ - Admin 生产构建产物，由 admin:build 生成
routes/ - Express HTTP 边界与鉴权落点
services/ - 业务领域、配置、安全、任务、备份和可观测能力
scripts/ - 构建、验证、迁移、维护与发布 CLI
tests/ - Node 单元/路由/契约测试与烟雾测试
types/ - 跨模块类型约定
ui/ - Admin/Setup 共享设计令牌与 EPUB 预览 CSS
</directory>

<config>
package.json - 根运行、测试、构建、检查和发布命令
.env.example - 完整环境变量示例
.env.docker.example - Docker Compose 配置模板
Dockerfile - server/reader/bot/app 多阶段构建
docker-compose.yml - 仅本地源码构建与调试
docker-compose.hub.yml - Docker Hub 生产部署拓扑
server-pg.js - 后端组合根，装配 routes/services 与启动迁移
pg-store.js - PostgreSQL Pool、迁移执行和数据访问兼容层
README.md - 项目入口与最短上手
DOCKER.md - Docker 部署、升级、备份和发布手册
API.md - 人工维护的 API 语义与兼容示例；运行时索引为 /openapi.json
AGENTS.md - GEB 回环、项目边界与必跑验证规则
telegram-push-contract.js - server/Bot 跨进程共享的不可见系统推送标记协议，限定自动取消置顶的消息边界
</config>

## 依赖方向

```text
Admin / Reader / Bot / Userscript
             ↓ HTTP
routes → services → pg-store → PostgreSQL
             ↓
       system_jobs / audit / metrics
```

- `server-pg` 是唯一数据库业务入口；Bot 不直接连接 PostgreSQL。端口可先承载健康探测，但迁移和启动初始化完成前，启动闸门会以 503 拒绝全部业务流量。
- Reader server 只提供静态文件并代理 `/reader-auth`、`/reader-api`。
- `db/migrations` 是 schema 唯一正向来源，`db/rollbacks` 只用于显式人工回滚。
- `/config` 是运行配置、日志与备份的持久边界；源代码不得依赖其中的私人数据。

## 全局法则

- 当前运行事实优先级：代码/测试 → 运行时 OpenAPI → 当前操作文档 → 历史报告。
- 新路由同步 OpenAPI、鉴权说明、测试与 API 文档；新配置同步两个 env 模板和配置参考。
- 新 migration 同步 rollback、schema snapshot、迁移手册与 PG 集成测试。
- Admin/Reader 修改分别执行生产构建；Docker 输入变化执行 context 检查。
- 生产绑定非 localhost 时 Metrics Token 必填；任何示例不得弱化生产安全校验。
- `main` 推送会发布可变 `v2.0` 标签，必须保护分支和工作流修改权限。
- Telegram 频道推送通过根级不可见标记跨进程识别；Bot 只精确取消关联群中带标记的自动转发置顶，人工消息不进入该策略。注册用户全员通知独立写入 `system_jobs`，由 Bot 管理员/后台 owner 发起并由 Bot Worker 限速私聊。
- `npm run check:docs` 是地图同构门禁：验证必需 L2、相对链接与受控源码 L3；已发布 migration 和生成产物遵守上层契约，不为注释破坏不可变性。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
