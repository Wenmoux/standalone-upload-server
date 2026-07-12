# public/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

发布产物边界：Admin 构建输出由 `npm run admin:build` 原子同步，Reader 旧兼容产物和少量手工公共文件随镜像复制；生成文件禁止手改。

## 成员清单

- `index.html`: Admin 生产入口，由 Vite 构建生成。
- `assets/`: Admin 带内容哈希的 JS/CSS/图片产物，由 `admin-ui/dist` 发布。
- `cirno-app/`: 已归档的旧 Reader 静态产物；server 明确封禁 `/cirno-app*`，当前 Reader 只使用 `cirno-src/dist-reader`。
- `legado-po18-reader-source.json`: Legado 书源公共下载文件，作为 Docker server 阶段的明确构建输入。
- `rank.html`: 轻量排行榜兼容页面，直接随 server 镜像发布。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
