# admin-ui/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Vue 3 管理后台的源码与独立构建边界。浏览器通过同源 `/admin-api`、`/reader-api` 和健康端点消费 `server-pg`，构建结果写入根目录 `public/` 并由服务端发布；该子项目不持有数据库连接和服务端密钥。

## 成员清单

`dist/`: Vite 的本地默认构建输出；正式发布使用根目录 `public/`，生成物不得替代 `src/` 事实源。
`node_modules/`: 本地依赖安装目录，不纳入版本控制与模块契约。
`src/`: 后台单页应用源码，集中处理路由、会话门禁、业务视图与共享组件；详见 `src/CLAUDE.md`。
`index.html`: Vite HTML 入口，只承载 Admin 应用挂载节点与页面元信息。
`package-lock.json`: Admin 子项目依赖锁，必须与 `package.json` 同步提交。
`package.json`: Vue/Vite 依赖以及开发、生产构建命令；根命令 `npm run admin:build` 通过它生成发布产物。
`vite.config.js`: Admin 构建边界，把生产输出定向到根目录 `public/`，并在开发期代理后端 API。

## 依赖与数据流

```text
Browser -> router/App -> views/components -> services/api -> server-pg:3100
                                      -> utils/format
Vite -> src + index.html -> ../public
```

- 所有管理写操作复用 `src/services/api.js` 的凭证、错误和 CSRF 约定，视图不得平行创建 HTTP 客户端。
- `App.vue` 是认证、权限、确认框与全局提示的组合根；领域视图只负责各自页面状态和 API 编排。
- 修改 `src/` 或构建配置后必须执行根命令 `npm run admin:build` 并检查 `public/` 产物。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
