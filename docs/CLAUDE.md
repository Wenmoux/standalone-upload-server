# docs/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

当前运行文档的权威入口；把架构、配置和排障事实从历史快照中分离，内容必须能被代码、测试或部署配置直接验证。

## 成员清单

- `README.md`: 文档导航与权威顺序，区分当前手册、接口参考和历史报告。
- `ARCHITECTURE.md`: 进程、端口、数据流、部署模式、持久化边界与发布链路地图。
- `CONFIGURATION.md`: 环境变量的职责、默认值、安全等级和单容器/Compose 注入位置。
- `TROUBLESHOOTING.md`: 依据日志症状定位迁移锁、Metrics、Bot 网络、健康检查和导出问题的操作手册。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
