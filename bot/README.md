# PostgreSQL Telegram Bot

Bot 只通过 `server-pg` HTTP API 读写数据，不直接连接数据库。

## 启动

```powershell
$env:PO18_SERVER_URL="http://127.0.0.1:3100"
$env:PO18_BOT_API_TOKEN="和服务端一致的 token"
$env:TELEGRAM_BOT_TOKEN="123456:ABC..."
npm run bot
```

`PO18_BOT_API_TOKEN` 用于 Bot 与服务端之间的 `X-Bot-Token` 校验。

## 命令

- `/start`
- `/reg`
- `/search 关键词`
- `/search #标签`
- `/hot`
- `/random`
- `/info 书号`
- `/fav 书号`
- `/myfav`
- `/exporttxt 书号`
- `/exportepub 书号`
- `/wallet`
- `/sign`
- `/give 用户TelegramID 铜币 100`

导出使用 `server-pg` 的 `/reader-api/books/:bookId/chapters?includeContent=1` 读取当前缓存章节生成文件。
