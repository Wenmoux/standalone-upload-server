# bot/commands/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Telegram 命令装配边界。本目录只把命令声明映射到上层注入的领域处理器；命令名称、帮助文案和别名的单一来源仍是 `../command-catalog.js`，网络访问、持久化和用户提示分别留在客户端、任务运行时与领域 handler 中。

## 成员清单

`account.js`: 注册账户、签到、流水、兑换、排行及后台任务查询命令，把身份与资产操作委托给账户和任务处理器。
`export.js`: 注册 TXT/EPUB 导出入口，将 EPUB 请求先导向样式选择，并把实际生成交给持久任务调度器。
`integrations.js`: 注册 PikPak 与 PO18 凭据、验证码、状态和书架同步入口，隔离第三方集成命令面与网络实现。
`search.js`: 注册搜索、热门、词云、随机推荐和详情命令，统一套用动作级冷却边界。
`social.js`: 注册收藏、红包、众筹、兼容书评、举报与申诉命令，把按钮之外的群交互入口路由到社交治理处理器。

## 依赖方向

```text
command-catalog -> command-registry -> commands/* -> domain handlers -> PgBotClient
```

- 新命令必须先进入 `../command-catalog.js`，再在对应领域文件注册；不得在组合根散落第二套命令分支。
- 本目录不读取环境变量、不访问数据库或远端 API，也不拼接复杂业务响应。
- 处理器缺失应由组合根和测试暴露，注册器不静默实现回退业务。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
