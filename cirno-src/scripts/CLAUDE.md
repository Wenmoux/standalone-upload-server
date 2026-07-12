# cirno-src/scripts/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Reader 构建与繁简转换验证工具。构建插件只生成可公开缓存的应用壳；扫描脚本面向显式运行的测试/诊断环境读取文本或 Reader API，并把结果写入 `test/` 或 `docs/conversion-scans/`，不参与生产请求链路。

## 成员清单

`build-icon-subset.py`: 从 Reader 实际使用的图标码点生成最小 WOFF2 字体，输出回到 `src/assets/icons`。
`conversion-report.js`: 扫描本地文本样本的繁简转换覆盖率并生成 JSON/HTML 汇总报告，失败时以 CLI 退出码阻断验证。
`reader-api-conversion-scan.js`: 分页读取 Reader API 书籍与章节正文，执行繁转简残留字扫描并持久化可续跑状态。
`reader-pwa-plugin.mjs`: Vite 构建插件，指纹化公开壳文件并生成绕过 Reader Auth/API 的 Service Worker。
`render-reader-api-conversion-html.js`: 把指定扫描 JSON 渲染为独立 HTML 报告，供人工检查残留样例和统计。

## 边界约束

- 扫描输出是诊断产物，不是运行时事实源，也不得包含 Token、Cookie 或未经脱敏的私人正文。
- PWA 插件不得缓存 `/reader-auth`、`/reader-api` 响应；任何缓存边界变化必须同步 Reader 文档与构建验证。
- 转换脚本必须复用 `src/utils/chinese-convert.js` 的实际规则或对其生成结果进行验证，禁止维护平行映射真相。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
