# cirno-src/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Vue 3 Reader 前端与独立静态服务器。浏览器只访问同源 `/reader-auth`、`/reader-api`；`reader-server.js` 将这两个前缀代理到 server-pg，并把其余路径收敛到构建后的单页应用。

## 成员清单

`dist-reader/`: `build:standalone` 生成的独立部署产物，本地/镜像构建输入，不允许手工编辑。
`docs/`: 繁简转换规则与验证报告，记录字符转换边界而非运行配置。
`imgs/`: 原上游保留的项目图片资产；新增 Reader UI 优先使用 `src/assets` 或 `public` 的明确发布边界。
`node_modules/`: 本地依赖安装目录，未纳入版本控制和文档事实源。
`public/`: 原样复制到构建产物的 favicon、PWA manifest、图标与 robots 文件。
`scf/`: 历史 Serverless/SCF 适配材料，不属于当前 Docker 生产链路。
`scripts/`: PWA 壳生成、繁简转换扫描与报告工具；构建插件对 API 请求明确采用网络路径。
`src/`: Vue 应用源码，按 views、components、mixins、store、router、utils 和 styles 分离页面、交互与基础能力。
`test/`: 繁简转换扫描产物和人工可视报告，不替代根目录 Node 契约测试。
`.browserslistrc`: Reader 构建的浏览器兼容目标。
`.gitignore`: 排除 Reader 依赖、构建产物与本地工具文件。
`index.html`: Vite HTML 入口与 PWA manifest/icon 声明。
`LICENSE`: Cirno 上游代码保留的 GPLv3 许可证文本。
`package-lock.json`: Reader 子项目依赖锁，必须与 `package.json` 同步提交。
`package.json`: Vue/Vite 依赖和 dev/build/build:standalone/reader/转换报告命令。
`prettier.config.js`: Reader 子项目格式化规则。
`reader-server.js`: 生产静态服务与 Reader 专用反向代理，向 server-pg 保留公网 Host/协议以维持会话与 CSRF 同源语义，并提供 live/ready/status 健康端点。
`README.md`: 当前 Reader 能力、构建、代理、PWA 缓存和维护边界说明。
`vite.config.mjs`: Vue 构建、路径别名、PWA 插件、生产输出与本地 3100 代理配置。

## 依赖与边界

```text
Browser → Vue Router / Store / Views
        → /reader-auth + /reader-api
        → reader-server:3200 → server-pg:3100 → PostgreSQL
```

- PWA Service Worker 只缓存应用壳并绕过 Reader Auth/API；章节离线数据由账号隔离的 Reader 存储显式管理。
- `dist-reader` 是源码构建结果，代码变化后必须执行 `npm --prefix cirno-src run build:standalone`。
- Upload/Bot/Admin API 直接访问 `3100`，不得为了“方便”扩展 Reader 代理面。
- Reader 代理改写上游 `Host` 时必须把浏览器访问的公网 Host/协议传入 `X-Forwarded-Host`、`X-Forwarded-Proto`，否则双域名部署会被后端误判为跨站写请求。
- `scf/` 是历史兼容边界；当前部署事实以根 Dockerfile、Compose 和 `reader-server.js` 为准。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
