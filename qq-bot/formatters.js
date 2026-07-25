/**
 * [INPUT]: 依赖书籍、搜索分页与 EPUB 样式领域对象
 * [OUTPUT]: 对外提供 QQ Markdown 菜单、搜索列表、书籍详情和样式选择文本
 * [POS]: qq-bot 的纯展示层，使 QQ 内容层级与 Telegram 书卡一致且不泄漏其 HTML/callback 协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function clean(value = "") {
    return String(value ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .trim();
}

function tags(value = "", limit = 4) {
    return clean(value)
        .split(new RegExp("[,，\\\\s、|/·•・]+"))
        .filter(Boolean)
        .slice(0, limit)
        .join(" / ");
}

function menuText() {
    return [
        "# PO18 书库",
        "",
        "直接发送书名、作者或 `#标签` 搜索。",
        "",
        "- `下一页` / `上一页`：翻页",
        "- `1` 或 `选择 1`：查看本页书籍",
        "- `TXT 1`：导出本页第 1 本",
        "- `EPUB 1`：打开样式选择",
        "- `EPUB 1 样式1`：按指定样式导出",
        "- `详情 书号`：直接查看书籍",
        "",
        "群聊中请先 @机器人。"
    ].join("\n");
}

function bookLine(book = {}, index = 1) {
    const tagText = tags(book.tags, 3);
    return [
        `## ${index}. ${clean(book.title || book.book_id)}`,
        `作者：${clean(book.author || "佚名")} · 平台：${clean(book.platform || "-")}`,
        `书号：${clean(book.book_id)} · 缓存 ${Number(book.cache_count || 0)} / 总章 ${book.total_chapters || book.subscribed_chapters || "-"}`,
        tagText ? `标签：${tagText}` : ""
    ]
        .filter(Boolean)
        .join("\n");
}

function searchText(query, rows = [], page = 1, hasMore = false) {
    const footer = ["", `第 ${page} 页${hasMore ? " · 发送 下一页 继续" : ""}`, "发送序号查看详情，或发送 `TXT 序号` / `EPUB 序号` 下载。"];
    return [`# 搜索：${clean(query)}`, "", ...rows.map((book, index) => bookLine(book, index + 1)), ...footer].join("\n\n");
}

function detailText(book = {}) {
    const intro = clean(book.description || "").slice(0, 700);
    return [
        `# ${clean(book.title || book.book_id)}`,
        `作者：${clean(book.author || "佚名")}`,
        `书号：${clean(book.book_id)}`,
        `平台：${clean(book.platform || "-")} · 状态：${clean(book.status || "-")}`,
        `标签：${tags(book.tags, 8) || "-"}`,
        `章节：缓存 ${book.cache_count || 0} / 总章 ${book.total_chapters || book.subscribed_chapters || "-"}`,
        `免费/付费：${book.free_chapters || 0}/${book.paid_chapters || 0}`,
        `热度：${book.total_popularity || 0} · 收藏：${book.favorites_count || 0} · 评论：${book.comments_count || 0}`,
        intro ? `\n${intro}` : "",
        "",
        "发送 `TXT` 下载 TXT，或发送 `EPUB` 选择样式。"
    ]
        .filter(Boolean)
        .join("\n");
}

function styleText(styles = [], defaultStyle = "style1") {
    return [
        "# 选择 EPUB 样式",
        "",
        ...(styles || []).map((style, index) => `${index + 1}. ${clean(style.label || style.id)}${style.id === defaultStyle ? "（默认）" : ""}`),
        "",
        "发送 `样式 序号` 开始导出，发送 `取消` 关闭。"
    ].join("\n");
}

module.exports = { bookLine, clean, detailText, menuText, searchText, styleText, tags };
