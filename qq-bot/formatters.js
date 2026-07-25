/**
 * [INPUT]: 依赖 bot/account-view/book-card-view 的跨平台展示模型及搜索分页、签到、EPUB 样式领域对象
 * [OUTPUT]: 对外提供 QQ Markdown 菜单、签到结果、搜索列表、书籍详情和样式选择文本
 * [POS]: qq-bot 的纯展示层，使 QQ 内容层级与 Telegram 书卡一致且不泄漏其 HTML/callback 协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { scholarText } = require("../bot/account-view");
const { createBookCardView } = require("../bot/book-card-view");

function clean(value = "") {
    return String(value ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .trim();
}

function menuText(user = null) {
    const account = user
        ? `你好，**${clean(user.nickname || user.telegram_username || user.username || "书友")}**　${clean(scholarText(user))}\n\n铜币 ${Number(user.copper_coins || 0)}　银币 ${Number(user.silver_coins || 0)}`
        : "";
    return [
        "# 📚 PO18 书库功能面板",
        "",
        account,
        "> 直接发送书名、作者、书号或 `#标签` 搜索。",
        "",
        "## 🔎 搜索与下载",
        "- `下一页` / `上一页`　翻页",
        "- `1` 或 `选择 1`　查看本页书籍",
        "- `TXT 1`　导出本页第 1 本",
        "- `EPUB 1`　选择与 Telegram 相同的 EPUB 样式",
        "- `详情 书号`　直接查看书籍",
        "- `签到`　领取每日奖励",
        "",
        "群聊中请先 **@机器人**。"
    ].join("\n");
}

function signText(result = {}) {
    const reward = result.reward || {};
    const user = result.user || {};
    return [
        "# ✅ 签到成功",
        "",
        `**本次获得：**铜币 ${Number(reward.copper || 0)}${reward.silver ? `　银币 ${Number(reward.silver)}` : ""}　经验 ${Number(reward.exp || 0)}`,
        `**连续签到：**${Number(reward.day || user.sign_cycle_day || 0)} 天`,
        `**书卷等级：**${clean(scholarText(user))}${reward.level_up ? "　`已升级`" : ""}`,
        `**当前铜币：**${Number(user.copper_coins || 0)}`,
        "",
        "> 明天再来，连续签到奖励会更高。"
    ].join("\n");
}

function bookLine(book = {}, index = 1) {
    const card = createBookCardView(book, { tagLimit: 3 });
    return [
        `## ${index}. ${clean(card.title)}`,
        `**作者：**${clean(card.author)}　**站别：**${clean(card.platform)}`,
        `**书号：**\`${clean(card.bookId)}\``,
        `**章节：**缓存 ${card.cacheCount} 章 / 总章 ${card.totalChapters}　**人气：**${card.popularity}`,
        card.tags.length ? `**标签：**${card.tags.map(clean).join(" / ")}` : ""
    ]
        .filter(Boolean)
        .join("\n");
}

function searchText(query, rows = [], page = 1, hasMore = false) {
    const footer = [
        "---",
        `**第 ${page} 页**${hasMore ? "　点击「下一页」继续" : "　已到最后一页"}`,
        "> 点击序号查看详情，TXT / EPUB 请在详情卡片中选择。"
    ];
    return [`# 🔎 搜索：${clean(query)}`, "", ...rows.map((book, index) => bookLine(book, index + 1)), ...footer].join("\n\n");
}

function detailText(book = {}) {
    const intro = clean(book.description || "").slice(0, 700);
    const card = createBookCardView(book, { intro, tagLimit: 8 });
    const introQuote = card.intro
        ? card.intro
              .split(/\r?\n/)
              .map((line) => `> ${line}`)
              .join("\n")
        : "";
    return [
        `# 📖 ${clean(card.title)}`,
        `**作者：**${clean(card.author)}`,
        `**书号：**\`${clean(card.bookId)}\``,
        `**站别：**${clean(card.platform)}　**状态：**${clean(card.status)}`,
        `**标签：**${card.tags.map(clean).join(" / ") || "-"}`,
        `**章节：**缓存 ${card.cacheCount} / 总章 ${card.totalChapters}`,
        `**免费/付费：**${card.freeChapters}/${card.paidChapters}`,
        `**热度：**${card.popularity}　**收藏：**${card.favorites}　**评论：**${card.comments}`,
        `**反馈：**喜欢 ${card.likes}　不喜欢 ${card.dislikes}`,
        introQuote ? `\n## 简介\n${introQuote}` : "",
        "",
        "> 点击下方按钮下载 TXT，或选择 EPUB 样式。"
    ]
        .filter(Boolean)
        .join("\n");
}

function styleText(styles = [], defaultStyle = "style1") {
    return [
        "# 🎨 选择 EPUB 样式",
        "",
        "> 与 Telegram Bot 使用同一套生成器和四种样式。",
        "",
        ...(styles || []).map((style, index) => `${index + 1}. **${clean(style.label || style.id)}**${style.id === defaultStyle ? "　`默认`" : ""}`),
        "",
        "点击样式开始导出，点击「取消」关闭。"
    ].join("\n");
}

module.exports = { bookLine, clean, detailText, menuText, searchText, signText, styleText };
