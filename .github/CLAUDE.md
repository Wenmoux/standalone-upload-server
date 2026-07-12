# .github/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

托管平台自动化边界；CI 先验证代码与文档，发布工作流只在全部门禁通过后持有向 Docker Hub 写入的短生命周期权限。

## 成员清单

- `dependabot.yml`: 根、Admin 与 Reader 的 npm 依赖更新分组和频率。
- `workflows/`: CI 与 Docker 发布工作流；其成员见 [workflows/CLAUDE.md](workflows/CLAUDE.md)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
