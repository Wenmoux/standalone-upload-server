# .github/workflows/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

GitHub 托管执行面；CI 验证每次变更，release 在相同静态门禁基础上增加真实 PostgreSQL、镜像冒烟、单一 v2.0 registry 发布和 digest 复验。

## 成员清单

- `ci.yml`: push/PR 的文档、编码、Schema、Lint、格式、测试、审计、前端构建和 Docker 上下文验证。
- `release.yml`: `main` 与 `v*` 的镜像构建发布；Docker Hub 始终只更新 `wenmoux/reader:v2.0`，源码身份保留在镜像元数据和 digest 证据中。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
