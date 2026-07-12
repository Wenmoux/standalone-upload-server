# .github/workflows/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

GitHub 托管执行面；CI 验证每次变更，release 在相同静态门禁基础上增加真实 PostgreSQL、镜像冒烟、registry 发布和正式标签供应链证明。

## 成员清单

- `ci.yml`: push/PR 的文档、编码、Schema、Lint、格式、测试、审计、前端构建和 Docker 上下文验证。
- `release.yml`: `main` 与 `v*` 的镜像构建发布；更新移动标签，正式版本额外生成 SBOM、签名和 attestations。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
