# docker/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

容器运行边界负责把不可变镜像连接到 `/config` 持久配置、进程监督、健康探针和备份运维；业务读写仍由 `server-pg` 与 `services/` 承担。

## 成员清单

- `backup-pg.js`: PostgreSQL 备份、保留、远端上传和恢复演练调度器；只管理备份生命周期，不替代数据库迁移。
- `control-panel.js`: Setup/Admin 控制面组合入口；负责配置编解码、鉴权与 HTTP 路由，把运行事实和 HTML 分别委托给独立边界。
- `control-panel-pages.js`: Setup/Admin 控制面纯页面渲染层；消费受信配置和诊断结果，生成表单、状态、日志、成功页与 Admin 壳。
- `control-panel-runtime.js`: Setup/Admin 控制面只读运行事实层；探测 PostgreSQL/服务端点、筛选日志并生成脱敏诊断，不处理路由或 HTML。
- `entrypoint.js`: 单镜像容器入口；按配置状态选择 Setup 或完整服务栈，并维持退出语义。
- `healthcheck.js`: 容器健康探针客户端；聚合本地服务端点并为 Docker HEALTHCHECK 返回稳定退出码。
- `process-supervisor.js`: 子进程监督原语；处理重启退避、信号转发和不可恢复退出。
- `run-all.js`: 单容器服务编排器与受信 env 文件加载器；启动 server、Reader、Telegram Bot、QQ Bot 并连接统一监督策略，QQ Bot 是否连接由后台配置决定。
- `setup-wizard.js`: 未初始化实例的最小启动器；把首次配置请求交给控制面板。
- `status-check.js`: 本地或容器状态检查 CLI；输出面向运维人员的端点诊断结果。
- `structured-log.js`: 容器运行日志结构化与脱敏层；统一子进程前缀、字段和敏感值过滤。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
