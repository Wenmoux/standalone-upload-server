/**
 * [INPUT]: 依赖书籍元信息、可选章节/书评统计与平台名称投影
 * [OUTPUT]: 对外提供 Telegram/QQ 共用的书籍列表与详情展示模型
 * [POS]: bot 跨平台展示内核，统一字段取值、标签截断和统计回退，协议标记由各平台适配器负责
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function splitBookTags(value = "", limit = 4) {
    return String(value || "")
        .split(/[,，\s、|/·•・]+/)
        .filter(Boolean)
        .slice(0, Math.max(0, Number(limit) || 0));
}

function createBookCardView(book = {}, options = {}) {
    const chapters = Array.isArray(options.chapters) ? options.chapters : [];
    const platformLabel = typeof options.platformLabel === "function" ? options.platformLabel : (value) => value;
    const reviewTotal = options.reviewTotal === null || options.reviewTotal === undefined ? null : Number(options.reviewTotal || 0);
    return {
        title: book.title || book.book_id,
        author: book.author || "佚名",
        bookId: book.book_id,
        platform: platformLabel(book.platform || "-") || "-",
        status: book.status || "-",
        tags: splitBookTags(book.tags, options.tagLimit ?? 4),
        allTags: String(book.tags || "-") || "-",
        cacheCount: Number(book.cache_count || chapters.length || 0),
        totalChapters: book.total_chapters || book.subscribed_chapters || "-",
        freeChapters: Number(book.free_chapters || 0),
        paidChapters: Number(book.paid_chapters || 0),
        popularity: Number(book.total_popularity || 0),
        favorites: Number(book.favorites_count || 0),
        comments: Number(book.comments_count || 0),
        likes: Number(book.like_count || 0),
        dislikes: Number(book.dislike_count || 0),
        reviewTotal,
        intro: String(options.intro || "")
    };
}

module.exports = { createBookCardView, splitBookTags };
