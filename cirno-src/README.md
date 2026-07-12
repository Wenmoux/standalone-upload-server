# PO18 Reader（Cirno）

<img src="./src/assets/cirno.png" width="96" alt="Cirno logo" />

Reader 是 PO18 Reader Stack 的浏览器阅读前端。Vue 应用负责登录、书架、检索、详情与正文交互；`reader-server.js` 只提供生产静态文件、健康检查，并把 `/reader-auth` 与 `/reader-api` 原样代理到 `server-pg:3100`。

它不提供 Upload、Bot 或 Admin API，也不直接连接 PostgreSQL。

## 当前能力

- 本地账号登录/注册（注册需要 CDK）与可选 Telegram 登录。
- 个人书架、全库搜索、标签/平台筛选、书籍详情、目录与公开书评。
- 正文阅读、上一章/下一章、阅读进度、目录定位与章节错误状态。
- 字体、字号、行距、页宽、主题、章头图片和繁简转换等本地阅读设置。
- 浏览器语音、Edge TTS、受控云 TTS 与自定义 TTS；服务端合成和代理仍受 Reader 会话与服务端配置保护。
- 选中文本提交等长纠错，进入服务端审核流程。
- 可安装 PWA：构建时缓存应用壳；登录用户可主动保存章节到账号隔离的本地离线缓存。

旧上游 README 曾列出的间贴发布/赞踩、推荐票和站点付费购买不是当前 PO18 Reader 的承诺能力；当前事实以本仓库 Reader 路由、`/reader-api` 和测试为准。

## 本地开发

先启动根服务端 `3100`，再运行：

```powershell
npm --prefix cirno-src ci
npm --prefix cirno-src run dev
```

Vite 开发服务器默认监听 `0.0.0.0:9012`，并把 `/reader-auth`、`/reader-api` 代理到 `http://localhost:3100`。开发构建默认基路径是 `/cirno-app/`，可用 `CIRNO_PUBLIC_PATH` 调整。

## 独立生产构建与运行

在仓库根目录执行：

```powershell
npm ci
npm --prefix cirno-src ci
npm --prefix cirno-src run build:standalone
$env:PO18_API_BASE="http://127.0.0.1:3100"
$env:PO18_READER_HOST="127.0.0.1"
$env:PO18_READER_PORT="3200"
node cirno-src/reader-server.js
```

默认生产产物为 `cirno-src/dist-reader`，访问地址为 `http://127.0.0.1:3200`。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PO18_API_BASE` | `http://127.0.0.1:3100` | Reader Auth/API 上游；末尾斜杠会被移除 |
| `PO18_READER_HOST` | `127.0.0.1` | Reader 静态服务监听地址 |
| `PO18_READER_PORT` | `3200` | Reader 静态服务端口 |
| `PO18_READER_DIST` | `dist-reader` | 相对 `cirno-src` 的生产构建目录，也可使用绝对路径 |
| `PO18_READER_SLOW_REQUEST_MS` | `800` | Reader 慢请求日志阈值 |

健康端点：

- `/health/live`：进程存活。
- `/health/ready`：`dist-reader/index.html` 已存在，可以提供页面。
- `/health/status`：与 ready 相同的兼容状态入口。

Reader ready 只证明静态产物存在；部署级健康还应同时检查 `server-pg:3100/health/ready`。Docker 拓扑、反向代理和升级方式见[部署手册](../DOCKER.md)。

## PWA 与缓存边界

构建插件会按产物内容生成版本化 `sw.js`，只缓存 HTML、脚本、样式、字体和图标等应用壳。Service Worker 明确绕过 `/reader-auth` 与 `/reader-api`，因此不会把私有 API 响应混入公共 Cache Storage。

章节离线缓存由 Reader 在用户主动保存时写入浏览器本地存储，并按 Reader 账号隔离。退出登录会清理当前账号的离线章节；共享设备仍应使用独立浏览器配置文件并及时退出。

## 维护规则

- Reader API 只能通过 `/reader-auth`、`/reader-api`；新增代理前缀必须同步 `reader-server.js`、Vite、部署文档和测试。
- 修改 Reader 源码后运行 `npm --prefix cirno-src run build:standalone`，不要手改 `dist-reader`。
- 修改 PWA 壳文件或图标后必须重新构建，确认旧缓存版本在 activate 阶段被清理。
- 不在浏览器日志、离线缓存键名、示例或测试报告中写入 Token、Cookie、账号密码或私人正文。

## 名称来源

“Cirno”沿用该前端最初的项目名；当前产品名称与运行边界以 PO18 Reader 为准。名称历史不再用来暗示对原第三方站点功能的完整兼容。
