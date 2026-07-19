# PO18 Telegram Bot

Bot 是 Telegram 交互层：接收命令与按钮回调，通过 `PgBotClient` 调用 `server-pg` 的 HTTP API，并把耗时操作交给可恢复的后台任务。它不直接连接 PostgreSQL，也不承载 Reader 页面。

## 启动与连通性

在仓库根目录运行：

```powershell
$env:PO18_SERVER_URL="http://127.0.0.1:3100"
$env:PO18_SHARE_API_URL="http://127.0.0.1:3100"
$env:PO18_BOT_API_TOKEN="与 server-pg 一致的内部令牌"
$env:TELEGRAM_BOT_TOKEN="Telegram BotFather 令牌"
npm run bot
```

- `PO18_SERVER_URL`：账户、搜索、导出定价、任务等 Bot API 的根地址。
- `PO18_SHARE_API_URL`：共享上传 API 的根地址；当前同样应指向 `server-pg:3100`，不是 Reader 的 `3200`。
- `PO18_BOT_API_TOKEN`：Bot 调用服务端时使用的 `X-Bot-Token`，必须与服务端配置一致。
- `TELEGRAM_BOT_TOKEN`：Telegram Bot 令牌，不得提交到仓库。
- `BOT_HEALTH_HOST` / `BOT_HEALTH_PORT`：健康服务监听地址，默认 `127.0.0.1:3300`。

健康端点为 `/health/live`、`/health/ready` 和 `/health/status`。Bot 启动成功前会先检查 `server-pg`，`ready` 随后以 Telegram 身份和 polling 新鲜度为准；响应还会暴露 server URL 与 HTTP 客户端统计供排障。完整变量以[配置参考](../docs/CONFIGURATION.md)为准。

## 命令

运行时命令的单一事实源是 [`command-catalog.js`](./command-catalog.js) 和 `commands/` 注册器。`/start` 与 `/menu` 打开两列宫格功能面板，`/help` 才显示完整命令说明。

Telegram 输入 `/` 时显示的系统命令表只保留 `/menu`、`/search`、`/hot`、`/random`、`/me`、`/sign`、`/tasks` 和 `/po18status` 八个高频入口。Telegram 的系统命令表只能单列显示，不能改成宫格；宫格由 Bot 消息下方的 inline keyboard 实现。收藏、TXT/EPUB 导出、书评和众筹继续保留旧命令兼容，但不再重复占用系统命令表，也不放进主面板，应从对应书籍卡片操作。

### 账户与任务

| 命令 | 作用 |
| --- | --- |
| `/start` | 注册并打开功能面板；仍承载群聊转私聊导出续接 |
| `/menu` | 打开两列按钮功能面板 |
| `/help` | 显示当前启用命令的完整说明 |
| `/reg` | 注册当前 Telegram 账号 |
| `/me` | 查看账户、余额、等级和导出额度 |
| `/sign` | 每日签到 |
| `/tx`、`/transactions` | 查看最近币流水 |
| `/redeem CDK-XXXX-XXXX`、`/cdk ...` | 兑换下载次数 CDK |
| `/top [copper\|silver\|exp]` | 查看货币或经验排行 |
| `/tasks` | 查看自己的后台任务 |
| `/task 任务号` | 查看任务进度和结果 |
| `/canceljob 任务号` | 取消排队中或运行中的任务 |
| `/give TelegramID 铜币 100` | 管理员发币；也支持“银币” |
| `/broadcast [通知内容]` | 管理员发布全员通知；预览确认后进入后台任务 |

余额入口是 `/me`，流水入口是 `/tx`；不存在 `/wallet` 命令。

`/broadcast` 只允许 `reader_users.is_admin=true` 的 Bot 管理员使用。可以直接附带内容，也可以按 ForceReply 提示输入；两种方式都会先显示预览并要求按钮确认。服务端再次校验管理员身份后才创建 `bot_registered_user_broadcast`，Worker 每 5 秒领取任务，分页、限速私聊已注册且绑定 Telegram 的未封禁用户。部分用户屏蔽 Bot 只计入失败统计，不中断其余发送。

### 搜书与导出

| 命令 | 作用 |
| --- | --- |
| `/search 关键词 [-qd\|-fq]` | 按关键词或 `#标签` 搜索，可指定起点/番茄平台 |
| `/hot [-qd\|-fq]` | 查看热门书籍 |
| `/wordcloud [-qd\|-fq]`、`/cloud ...` | 生成热搜词云 |
| `/random [-qd\|-fq]` | 随机推荐 |
| `/info 书号` | 查看书籍详情与操作按钮 |
| `/exporttxt 书号` | 创建 TXT 导出任务 |
| `/exportepub 书号` | 选择内置样式后创建 EPUB 导出任务 |

书籍收藏通过搜索结果或详情卡片中的“收藏”按钮完成，`/myfav` 用于查看收藏列表；不存在 `/fav 书号` 命令。

### 群互动与书评

| 命令 | 作用 |
| --- | --- |
| `/myfav` | 查看自己的收藏 |
| `/hb 100 5`、`/hongbao ...` | 发红包；支持铜币、银币和定向红包 |
| `/qhb`、`/qiang`、`/qianghongbao` | 抢当前群红包 |
| `/crowd 书号`、`/cf`、`/zhongchou`、`/众筹` | 查看众筹投票榜 |
| `/review 书号 [内容]` | 引导发布书评；仍兼容直接附带完整内容 |
| `/reviews 书号` | 查看书评 |
| `/reportreview 书评号 原因 说明` | 举报书评 |
| `/appealreview 书评号 申诉说明` | 申诉书评审核 |

书籍详情卡和书评列表都提供“写书评”按钮。私聊点击后直接发送下一条内容即可；群聊需手动回复当前提示，避免把普通聊天当作书评。整个流程不使用 Telegram ForceReply，因此不会自动占用或锁定输入框。输入不符合长度规则时可原地重试，发送“取消”、`/cancel` 或点击“取消发布”都会清理草稿和原提示；旧的 `/review 书号 内容` 仍保持兼容。

### 频道同步与自动取消置顶

系统按后台 `pushTypes` 发往频道的元信息、章节、日报、新书评和后台测试消息都会携带不可见的内部标记；新书评由独立的“书评”选项控制。频道关联讨论群自动置顶这些转发副本后，Bot 只在同时满足“Telegram 自动转发 + 内部标记”时，按该副本的精确 `message_id` 调用取消置顶；人工群消息、人工频道帖和未标记消息不会被处理。

Bot 必须加入关联讨论群，并具有 `can_pin_messages` 管理权限。权限不足只会记录 `automatic push unpin failed` 警告，不影响原推送发送，也不会退化为取消最近一条置顶。

### PO18 与 PikPak

| 命令 | 作用 |
| --- | --- |
| `/pikpak ...`、`/pp ...` | 搜索或操作 PikPak 文件 |
| `/po18set 账号 密码` | 绑定 PO18 账号；凭据由服务端加密保存 |
| `/loginpo18` | 发起 PO18 登录 |
| `/po18code 验证码` | 提交登录验证码 |
| `/po18status` | 查看绑定与登录状态 |
| `/po18logout` | 清除 PO18 登录状态 |
| `/mybookshelf` | 拉取已购书架并进入后台同步任务 |

PO18 账号、验证码、已购书架同步和整架共享只能在 Bot 私聊中执行，避免凭据或个人书架暴露到群聊。`/po18status` 会实际访问 PO18 受保护页面，不再仅凭 Cookie 名称判断；失效会话会被清除，但 `/po18logout` 会保留绑定的账号密码，下次可直接重新登录。

`/mybookshelf` 从当年扫描到 2008 年，中间即使连续多年没有购买记录也不会提前停止；登录过期、PO18 上游故障和真空书架有独立提示。修改绑定账号或密码时，服务端会主动失效旧 Cookie，防止新账号误用旧账号书架。

整架共享先读目标缓存和本地正文：已存在的章节不再请求 PO18，本地已有的免费章直接复用，只有本地与目标都缺失的免费章才补抓；付费章仅拉取当前账号实际可读的已购内容，页面标记为“订购/购买”的未购章不会请求正文或上传。

## 导出与持久任务

TXT/EPUB 导出先从 `/reader-api/books/:bookId/chapters?includeContent=1` 分页读取本地缓存正文；没有缓存且用户已绑定有效 PO18 会话时，才尝试拉取已购章节。生成文件只存在于任务临时目录，发送完成后由运行时清理。

`bot_export_txt`、`bot_export_epub`、书架同步、共享上传和 `bot_registered_user_broadcast` 都会写入服务端 `system_jobs`：

- 相同用户和书籍的重复任务由幂等键与本地锁抑制。
- 可重试网络错误按退避策略重试，消息会明确说明是网络/后端异常，并持续续租任务 lease。
- Bot 重启后会认领未完成任务并恢复执行。
- `/tasks`、`/task` 和 `/canceljob` 提供查询与取消入口。

群聊导出会先探测 Bot 是否能够私聊发文件。Telegram 返回 `Forbidden`、`chat not found`、`blocked` 或 `PEER_ID_INVALID` 都表示用户尚未建立可用私聊，不是 EPUB 构建失败；Bot 会在群里提供“打开私聊继续导出”按钮，用户发送 `/start` 后恢复所选书籍和 EPUB 样式。

EPUB 导出按钮只提供“江湖纸卷”“老二次元”“疏影横斜”三种选择；`crane` 仍在生成器中注册，用于旧配置兼容，但不作为 Bot 直选按钮。样式结构与扩展契约见 [EPUB 内置样式](./epub-styles/README.md)。

## 维护边界

- 新命令必须同时进入 `command-catalog.js` 与 `commands/` 注册器，并补充注册、鉴权和行为测试。
- Bot 只依赖 HTTP 契约；业务数据写入应扩展 `server-pg` 的 routes/services，不得在 Bot 内新增数据库连接。
- Token、Cookie、账号密码和用户正文不得进入日志、示例或测试夹具。
- Telegram 出站网络异常会使启动或 polling 报 `fetch failed`；先检查 `/health/ready`、代理配置和容器到 `api.telegram.org` 的连通性。
