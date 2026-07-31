# qq-bot/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

QQ 官方机器人适配器。它通过受 Bot Token 保护的 server API 获取凭据、搜索范围和书库数据，经 Gateway 接收单聊/群聊事件，并复用 `bot/` 的 TXT/EPUB 生成与用户经济规则；本模块禁止直连 PostgreSQL。

## 成员清单

`export-runtime.js`: QQ 导出组合边界，将共享生成器、EPUB 样式和结算状态机接到 QQ 富媒体文件投递。
`formatters.js`: QQ 安全 Markdown/纯文本展示层，提供轻量主面板、独立帮助、紧凑书卡、详情信息条、可折叠简介和导出状态卡；只使用客户端稳定渲染的块级标题/分隔线/代码块，业务字段不依赖行内标记。
`gateway.js`: QQ WebSocket Gateway 协议入口，负责 Intents、Identify/Resume、心跳和 C2C/群聊事件归一化。
`message-runtime.js`: QQ 主面板/帮助/签到/仅缓存搜索/分页/选书/样式/下载交互编排，以单行主动作、两列书名和分层键盘适配移动端，并在下载前执行范围及实时缓存双重校验。
`qq-api.js`: QQ OpenAPI 唯一网络客户端，封装 App Access Token、Markdown 长格式内嵌键盘、正确剥离代码围栏并保留普通 `#标签`/连字符的纯文本降级及 200 MB 内富媒体分片上传，对官方可重试错误按阶段退避且保持消息序号幂等。
`qq-bot.js`: 进程组合根，轮询后台配置并在启停或凭据变化时安全重连 Gateway，同时把共享导出状态接入 QQ Markdown 状态卡。
`README.md`: QQ 开放平台权限、后台配置和用户命令说明。

## 数据流

```text
QQ Gateway -> message-runtime -> PgBotClient -> server-pg:3100 -> PostgreSQL
                              -> export-runtime -> QQ rich-media upload
```

- 群聊只消费 `GROUP_AT_MESSAGE_CREATE`，单聊消费 `C2C_MESSAGE_CREATE`。
- OpenID 在现有用户边界内使用 `qq:` 命名空间，避免与 Telegram 数字 ID 冲突。
- `allowedPlatforms`、`blockedPlatforms`、`blockedTags` 同时约束搜索结果、详情和最终下载授权。
- AppSecret 只由内部 Bot API 下发给运行进程；Admin GET、日志、文档和测试不得回显。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
