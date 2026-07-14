/**
 * [INPUT]: 依赖 po18-crawler Parser 的文本/列表规范化能力以及已清洗的书籍元信息和爬虫配置
 * [OUTPUT]: 对外提供书籍分类/关键词/章节数筛选、完结缓存判定与稳定运行日志摘要纯函数
 * [POS]: services 的 PO18 选书策略边界，让发现来源与编排器共享同一业务口径且不依赖运行状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { normalizeList, normalizeText } = require("./po18-crawler-parsers");

function normalizedHaystack(...parts) {
    return normalizeText(parts.filter(Boolean).join(" ")).toLowerCase();
}

function bookTagList(book = {}) {
    return normalizeList([book.category, String(book.tags || "").replace(/[·]/g, "\n")].filter(Boolean).join("\n")).map((item) =>
        item.toLowerCase()
    );
}

function includesAnyToken(haystack = "", tokens = []) {
    const value = String(haystack || "").toLowerCase();
    return tokens.some((token) => token && value.includes(String(token).toLowerCase()));
}

function hasTagMatch(tags = [], tokens = []) {
    const needles = tokens.map((item) => String(item || "").toLowerCase()).filter(Boolean);
    if (!needles.length) return false;
    return tags.some((tag) => needles.some((needle) => tag === needle || tag.includes(needle) || needle.includes(tag)));
}

function bookChapterCount(book = {}) {
    return (
        Math.max(
            Number(book.totalChapters || book.total_chapters || 0),
            Number(book.subscribedChapters || book.subscribed_chapters || 0),
            Number(book.chapterCount || book.chapter_count || 0),
            Number(book.freeChapters || book.free_chapters || 0) + Number(book.paidChapters || book.paid_chapters || 0)
        ) || 0
    );
}

function formatBookDetailLog(detail = {}) {
    const total = bookChapterCount(detail) || 0;
    const free = Number(detail.freeChapters || detail.free_chapters || 0) || 0;
    const paid = Number(detail.paidChapters || detail.paid_chapters || 0) || 0;
    const split = free || paid ? `, free ${free}, paid ${paid}` : "";
    return `book ${detail.bookId || detail.book_id || ""} detail loaded: chapters ${total}${split}, status ${detail.status || "-"}, pages ${detail.pageNum || detail.page_num || 1}`.trim();
}

function formatChapterListLog(detail = {}, chapters = [], candidates = [], skippedCached = 0, skippedLocked = 0, concurrency = 1) {
    return `book ${detail.bookId || detail.book_id || ""} chapter list: accessible ${chapters.length}, candidates ${candidates.length}, cached ${skippedCached}, locked ${skippedLocked}, concurrency ${concurrency}`.trim();
}

function isFinishedStatus(value = "") {
    return /完结|完結|完本|已完成/.test(normalizeText(value));
}

function isCompleteCachedBook(book = {}) {
    const expected = bookChapterCount(book);
    const cached = Number(book.cacheCount || book.cache_count || 0) || 0;
    return expected > 0 && cached >= expected && isFinishedStatus(book.status || "");
}

function bookFilterDecision(book = {}, config = {}) {
    const includeCategories = normalizeList(config.includeCategories);
    const blockedTags = normalizeList(config.blockedTags);
    const blockedKeywords = normalizeList(config.blockedKeywords, { maxItems: 120, maxLength: 60 });
    const sourceMode = String(config.sourceMode || "discover").trim();
    const tags = bookTagList(book);
    if (includeCategories.length && !hasTagMatch(tags, includeCategories)) {
        return { skip: true, reason: `category not selected: ${includeCategories.join("/")}` };
    }
    if (blockedTags.length && hasTagMatch(tags, blockedTags)) {
        return { skip: true, reason: `blocked tag: ${blockedTags.join("/")}` };
    }
    const chapters = bookChapterCount(book);
    const minChapters = Number(config.minChapters || 0);
    const maxChapters = Number(config.maxChapters || 0);
    if (sourceMode === "discover") {
        if (minChapters > 0 && chapters > 0 && chapters < minChapters) {
            return { skip: true, reason: `chapters ${chapters} < ${minChapters}` };
        }
        if (maxChapters > 0 && chapters > maxChapters) {
            return { skip: true, reason: `chapters ${chapters} > ${maxChapters}` };
        }
    }
    const haystack = normalizedHaystack(book.bookId, book.title, book.author, book.tags, book.category, book.status, book.description);
    if (blockedKeywords.length && includesAnyToken(haystack, blockedKeywords)) {
        const keyword = blockedKeywords.find((item) => haystack.includes(String(item).toLowerCase())) || blockedKeywords[0];
        return { skip: true, reason: `blocked keyword: ${keyword}` };
    }
    return { skip: false, reason: "" };
}

module.exports = {
    bookChapterCount,
    bookFilterDecision,
    bookTagList,
    formatBookDetailLog,
    formatChapterListLog,
    hasTagMatch,
    includesAnyToken,
    isCompleteCachedBook,
    isFinishedStatus
};
