/**
 * [INPUT]: 依赖 bot/account-view/book-card-view 的跨平台展示模型、共享平台/EPUB 组件名称及搜索/签到/导出状态领域对象
 * [OUTPUT]: 对外提供 QQ 安全 Markdown 主面板、帮助、签到、紧凑搜索书卡、可折叠简介、模板库/工坊 EPUB 和导出状态文本
 * [POS]: qq-bot 的纯展示层，以稳定块级标题/分隔线/代码块构建信息层级，业务字段不依赖易裸露的行内 Markdown 标记
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { scholarText } = require("../bot/account-view");
const { createBookCardView } = require("../bot/book-card-view");
const { defaultPlatformLabel } = require("../services/platforms");
const { component } = require("../services/epub-component-library");

const NUMBER_FORMAT = new Intl.NumberFormat("zh-CN");

function clean(value = "") {
    return String(value ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .trim();
}

function truncate(value = "", limit = 80) {
    const chars = Array.from(clean(value));
    return chars.length > limit ? `${chars.slice(0, Math.max(1, limit - 1)).join("")}…` : chars.join("");
}

function compactNumber(value = 0) {
    const number = Number(value || 0);
    return NUMBER_FORMAT.format(Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0);
}

function cardView(book = {}, options = {}) {
    return createBookCardView(book, { ...options, platformLabel: defaultPlatformLabel });
}

function joinLines(lines = []) {
    return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function codePanel(value = "", language = "text") {
    const body = clean(value).replace(/```+/g, "'''");
    return body ? `\`\`\`${language}\n${body}\n\`\`\`` : "";
}

function menuText(user = null) {
    const name = clean(user?.nickname || user?.telegram_username || user?.username || "书友");
    return [
        "# 📚 PO18 书库",
        "",
        `👤 ${name}　·　${clean(scholarText(user || {}))}`,
        `🪙 铜币 ${compactNumber(user?.copper_coins)}　💠 银币 ${compactNumber(user?.silver_coins)}`,
        "",
        "---",
        "🔎 发送书名、作者、书号或 #标签，即可查找可下载书籍。"
    ].join("\n");
}

function helpText() {
    return [
        "# ❔ 使用帮助",
        "",
        "## 搜索",
        "直接发送书名、作者、书号或 #标签；群聊中先 @机器人。",
        "",
        "## 选择与翻页",
        "点击结果书名查看详情，使用「上一页」「下一页」浏览。",
        "",
        "## 下载",
        "在详情卡片中选择 TXT 或 EPUB；EPUB 可直接使用成品模板，也可自定义制作说明和章头装饰。",
        "",
        "## 快捷文字",
        "签到　详情 书号　TXT 书号　EPUB 书号"
    ].join("\n");
}

function signText(result = {}) {
    const reward = result.reward || {};
    const user = result.user || {};
    return [
        "# ✅ 签到成功",
        "",
        `🎁 奖励　+${compactNumber(reward.copper)} 铜币${reward.silver ? `　+${compactNumber(reward.silver)} 银币` : ""}　+${compactNumber(reward.exp)} 经验`,
        "",
        `📅 连续签到　${compactNumber(reward.day || user.sign_cycle_day)} 天`,
        `📖 书卷等级　${clean(scholarText(user))}${reward.level_up ? "　等级提升" : ""}`,
        `🪙 当前铜币　${compactNumber(user.copper_coins)}`
    ].join("\n");
}

function bookLine(book = {}, index = 1) {
    const card = cardView(book, { tagLimit: 3 });
    const total = card.totalChapters === "-" ? "?" : compactNumber(card.totalChapters);
    const identity = [card.author, card.platform, card.status === "-" ? "" : card.status].filter(Boolean).map(clean).join("　·　");
    return [
        `## ${String(index).padStart(2, "0")}｜${clean(card.title)}`,
        identity,
        `📚 缓存 ${compactNumber(card.cacheCount)}/${total}　🔥 热度 ${compactNumber(card.popularity)}`,
        card.tags.length ? `🏷 ${card.tags.map(clean).join(" / ")}` : "",
        `书号 ${clean(card.bookId)}`
    ]
        .filter(Boolean)
        .join("\n");
}

function searchText(query, rows = [], page = 1, hasMore = false) {
    const cards = rows.map((book, index) => bookLine(book, index + 1)).join("\n\n---\n\n");
    return joinLines([
        "# 🔎 搜索结果",
        "",
        `「${truncate(query, 36)}」　·　第 ${compactNumber(page)} 页`,
        "",
        cards,
        "",
        "---",
        `共 ${compactNumber(rows.length)} 本${hasMore ? "，还可继续翻页" : "，已到最后一页"}　·　点击书名查看详情`
    ]);
}

function emptySearchText(query = "") {
    return ["# 🔍 暂无结果", "", `没有找到可下载的「${truncate(query, 36)}」。`, "", "可以换用作者、书号或更短的关键词。"].join("\n");
}

function detailText(book = {}) {
    const intro = truncate(
        clean(book.description || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\n"),
        1000
    );
    const card = cardView(book, { intro, tagLimit: 5 });
    const total = card.totalChapters === "-" ? "?" : compactNumber(card.totalChapters);
    const introText = card.intro ? card.intro.split(/\r?\n/).map(clean).filter(Boolean).join("\n") : "";
    const chapterStats = [`缓存 ${compactNumber(card.cacheCount)}/${total}`];
    if (card.freeChapters || card.paidChapters)
        chapterStats.push(`免费 ${compactNumber(card.freeChapters)}`, `付费 ${compactNumber(card.paidChapters)}`);
    return joinLines([
        `# 📖 ${clean(card.title)}`,
        "",
        `${clean(card.author)}　·　${clean(card.platform)}　·　${clean(card.status)}`,
        `书号　${clean(card.bookId)}`,
        "",
        "---",
        `📚 章节　${chapterStats.join("　")}`,
        `🔥 热度 ${compactNumber(card.popularity)}　⭐ 收藏 ${compactNumber(card.favorites)}　💬 评论 ${compactNumber(card.comments)}`,
        `👍 喜欢 ${compactNumber(card.likes)}　·　👎 不喜欢 ${compactNumber(card.dislikes)}`,
        card.tags.length ? `🏷 ${card.tags.map(clean).join(" / ")}` : null,
        introText ? `\n---\n\n## 简介\n${codePanel(introText)}` : null,
        "",
        card.cacheCount > 0 ? "✅ 正文已就绪，可直接下载" : "⏳ 当前只有元信息，尚无正文缓存"
    ]);
}

function cacheUnavailableText(book = {}) {
    const card = cardView(book);
    return [
        "# ⏳ 暂不可下载",
        "",
        `《${clean(card.title)}》当前只有元信息，尚无正文缓存。`,
        "",
        "QQ Bot 只会为已有正文缓存的书籍生成 TXT/EPUB，请重新搜索其他结果。"
    ].join("\n");
}

function styleText(styles = [], defaultStyle = "style1", book = {}) {
    const title = truncate(book.title || book.book_id || "", 28);
    const defaultLabel = styles.find((style) => style.id === defaultStyle)?.label || defaultStyle;
    const directStyles = styles.filter((style) => style.direct !== false);
    return joinLines([
        "# 🎨 EPUB 样式",
        "",
        title ? `书籍：《${clean(title)}》` : null,
        `默认样式：${clean(defaultLabel)}`,
        "",
        "---",
        ...directStyles.map(
            (style, index) =>
                `${style.id === defaultStyle ? "●" : "○"} ${index + 1}｜${clean(style.label || style.id)}${style.id === defaultStyle ? "（默认）" : ""}`
        ),
        "",
        "选择模板后先查看实时预览，确认后再生成。"
    ]);
}

function customStyleText(styles = [], config = {}, book = {}) {
    const title = truncate(book.title || book.book_id || "", 28);
    const style = styles.find((item) => item.id === config.styleId) || styles[0] || {};
    const art = style.capabilities?.chapterArt;
    const studio = config.styleId === "studio" ? config.studio || {} : null;
    return joinLines([
        "# 🧩 自定义 EPUB",
        "",
        title ? `书籍：《${clean(title)}》` : null,
        `底板：${clean(style.label || style.id || config.styleId)}`,
        `制作说明：${config.includeColophon ? "保留" : "移除"}`,
        `章头装饰：${art === "optional" ? (config.showTopImage ? "显示" : "隐藏") : art === "fixed" ? "模板固定" : "无"}`,
        studio
            ? `组件：${clean(component("chapter", studio.chapter).name)} / ${clean(component("volume", studio.volume).name)} / ${clean(component("intro", studio.intro).name)} / ${clean(component("ornament", studio.ornament).name)}`
            : null,
        "",
        "---",
        "调整完成后再确认生成。"
    ]);
}

function bookButtonLabel(book = {}, index = 1) {
    return `${index}｜${truncate(book.title || book.book_id || "未命名", 8)}`;
}

function exportStatusText(value = "") {
    const text = clean(String(value || "").replace(/<br\s*\/?>/gi, "\n"));
    const progress = text.match(/^正在生成\s+(TXT|EPUB)(?:（([^）]+)）)?[：:]\s*(.+)$/i);
    if (progress) {
        return joinLines([
            `# ⏳ 正在生成 ${progress[1].toUpperCase()}`,
            "",
            progress[2] ? `样式：${clean(progress[2])}` : null,
            `书号：${clean(progress[3])}`,
            "",
            "文件生成和上传需要一点时间。"
        ]);
    }
    const failed = /失败|不足|已用完|无法|错误码/.test(text);
    const completed = /导出完成|已私聊发送/.test(text);
    const title = failed ? "# ⚠️ 导出未完成" : completed ? "# ✅ 导出完成" : "# 📦 导出状态";
    return [title, "", ...text.split(/\r?\n/).map(clean).filter(Boolean)].join("\n");
}

function errorText(message = "") {
    return ["# ⚠️ 操作未完成", "", clean(message || "请稍后重试。"), "", "可以稍后重试；若持续失败，请保留错误码。"].join("\n");
}

module.exports = {
    bookButtonLabel,
    bookLine,
    cacheUnavailableText,
    clean,
    compactNumber,
    customStyleText,
    detailText,
    emptySearchText,
    errorText,
    exportStatusText,
    helpText,
    menuText,
    searchText,
    signText,
    styleText
};
