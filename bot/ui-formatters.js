function createBotUi(deps = {}) {
    const escapeHtml = deps.escapeHtml || ((value = "") => String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])));
    const cleanText = deps.cleanText || ((value = "") => String(value || "").replace(/<[^>]+>/g, "").trim());
    const truncate = deps.truncate || ((value = "", max = 300) => String(value || "").slice(0, max));
    const isVolumeChapter = deps.isVolumeChapter || ((chapter = {}) => Boolean(chapter.is_volume || chapter.isVolume || chapter.type === "volume"));
    const CROWD_VOTE_COST = deps.crowdVoteCost ?? 100;

function callback(parts) {
    return parts.join("|").slice(0, 64);
}

function bookActions(bookId, detailUrl = "") {
    const id = String(bookId);
    const rows = [
        [
            { text: "详情", callback_data: callback(["info", id]) },
            { text: "收藏", callback_data: callback(["fav", id]) },
            { text: "共享", callback_data: callback(["share", id]) },
            { text: "众筹", callback_data: callback(["crowd", id]) }
        ],
        [
            { text: "喜欢", callback_data: callback(["like", id]) },
            { text: "不喜欢", callback_data: callback(["dislike", id]) },
            { text: "书评", callback_data: callback(["reviews", id]) }
        ],
        [
            { text: "TXT", callback_data: callback(["txt", id]) },
            { text: "EPUB", callback_data: callback(["epub", id]) },
            { text: "导出授权", callback_data: callback(["unlock", id]) }
        ]
    ];
    if (detailUrl) rows.push([{ text: "查看原文", url: detailUrl }]);
    return { inline_keyboard: rows };
}

function crowdActions(bookId, detailUrl = "") {
    const id = String(bookId);
    const rows = [
        [{ text: `支持 +1（${CROWD_VOTE_COST} 银币）`, callback_data: callback(["cvote", id]) }],
        [
            { text: "刷新排名", callback_data: callback(["crowd", id]) },
            { text: "书籍详情", callback_data: callback(["info", id]) }
        ]
    ];
    if (detailUrl) rows.push([{ text: "查看原文", url: detailUrl }]);
    return { inline_keyboard: rows };
}

function reviewVoteActions(review = {}) {
    const reviewId = String(review.id || "");
    const bookId = String(review.book_id || "");
    const rows = [
        [
            { text: `赞 ${review.like_count || 0}`, callback_data: callback(["rvup", reviewId]) },
            { text: `踩 ${review.dislike_count || 0}`, callback_data: callback(["rvdn", reviewId]) }
        ]
    ];
    if (bookId) rows.push([{ text: "书籍详情", callback_data: callback(["info", bookId]) }]);
    return { inline_keyboard: rows };
}

function bookReviewsActions(bookId = "") {
    const id = String(bookId || "");
    return id ? { inline_keyboard: [[{ text: "书籍详情", callback_data: callback(["info", id]) }]] } : undefined;
}

function listActions(books = []) {
    const rows = [];
    for (let i = 0; i < books.length; i += 5) {
        rows.push(
            books.slice(i, i + 5).map((book, offset) => ({
                text: String(i + offset + 1),
                callback_data: callback(["info", book.book_id])
            }))
        );
    }
    return rows.length ? { inline_keyboard: rows } : undefined;
}

function searchPager(query, page, total, limit) {
    const pages = Math.max(1, Math.ceil(total / limit));
    const buttons = [];
    if (page > 1) buttons.push({ text: "上一页", callback_data: callback(["search", page - 1, query]) });
    buttons.push({ text: `${page}/${pages}`, callback_data: "noop" });
    if (page < pages) buttons.push({ text: "下一页", callback_data: callback(["search", page + 1, query]) });
    return buttons.length ? { inline_keyboard: [buttons] } : undefined;
}

function searchRequestActions(queryKey) {
    const key = String(queryKey || "");
    if (!key) return undefined;
    return { inline_keyboard: [[{ text: "提交缺书需求", callback_data: callback(["sreq", key]) }]] };
}

function mergeKeyboards(...markups) {
    const rows = [];
    for (const markup of markups) {
        if (Array.isArray(markup?.inline_keyboard)) rows.push(...markup.inline_keyboard);
    }
    return rows.length ? { inline_keyboard: rows } : undefined;
}

function bookCardText(book, index = 1) {
    const tags = String(book.tags || "").split(/[,，\s、|/]+/).filter(Boolean).slice(0, 4).join(" / ");
    const lines = [
        `<b>${index}. ${escapeHtml(book.title || book.book_id)}</b>`,
        `作者：${escapeHtml(book.author || "佚名")}`,
        `书号：<code>${escapeHtml(book.book_id)}</code>`,
        `站别：${escapeHtml(book.platform || "-")} · 缓存 ${book.cache_count || 0} 章 · 总章 ${book.total_chapters || book.subscribed_chapters || "-"}`,
        `人气：${book.total_popularity || 0} · 收藏：${book.favorites_count || 0}`,
        tags ? `标签：${escapeHtml(tags)}` : ""
    ];
    return lines.filter(Boolean).join("\n");
}

function bookListItem(book, index = 1) {
    const tags = String(book.tags || "").split(/[,，\s、|/]+/).filter(Boolean).slice(0, 3).join(" / ");
    return [
        `<b>${index}. ${escapeHtml(book.title || book.book_id)}</b>`,
        `作者：${escapeHtml(book.author || "佚名")} · 书号：<code>${escapeHtml(book.book_id)}</code>`,
        `缓存 ${book.cache_count || 0} 章 / 总章 ${book.total_chapters || book.subscribed_chapters || "-"} · 人气 ${book.total_popularity || 0}`,
        tags ? `标签：${escapeHtml(tags)}` : ""
    ].filter(Boolean).join("\n");
}

function detailCardText(book, chapters = [], reviewsPayload = null) {
    const intro = truncate(cleanText(book.description || ""), 700);
    const reviewTotal = reviewsPayload ? Number(reviewsPayload.total || 0) : null;
    return [
        `<b>${escapeHtml(book.title || book.book_id)}</b>`,
        `作者：${escapeHtml(book.author || "佚名")}`,
        `书号：<code>${escapeHtml(book.book_id)}</code>`,
        `站别：${escapeHtml(book.platform || "-")}`,
        `状态：${escapeHtml(book.status || "-")}`,
        `标签：${escapeHtml(book.tags || "-")}`,
        `章节：缓存 ${book.cache_count || chapters.length} / 总章 ${book.total_chapters || book.subscribed_chapters || "-"}`,
        `免费/付费：${book.free_chapters || 0}/${book.paid_chapters || 0}`,
        `热度：${book.total_popularity || 0} · 收藏：${book.favorites_count || 0} · 评论：${book.comments_count || 0}`,
        `反馈：喜欢 ${book.like_count || 0} · 不喜欢 ${book.dislike_count || 0}`,
        reviewTotal !== null ? `书评：${reviewTotal} 条` : "",
        intro ? `\n${escapeHtml(intro)}` : ""
    ].filter(Boolean).join("\n");
}

function reviewAuthorName(review = {}) {
    if (review.author_telegram_username) return `@${review.author_telegram_username}`;
    return review.author_nickname || review.nickname || review.author_username || "reader";
}

function reviewLine(review = {}, index = 1, max = 220) {
    const content = truncate(cleanText(review.content || ""), max);
    const order = String(index).padStart(2, "0");
    return [
        `<b>${order}｜${escapeHtml(reviewAuthorName(review))}</b>`,
        `赞 ${Number(review.like_count || 0)} · 踩 ${Number(review.dislike_count || 0)}`,
        `“${escapeHtml(content)}”`
    ].join("\n");
}

function bookReviewsText(bookId, payload = {}) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const total = Number(payload.total || 0);
    const rules = payload.rules || {};
    const book = payload.book || rows[0] || {};
    const title = book.title || book.book_title || bookId || "书籍";
    const author = book.author || book.book_author || "";
    const platform = book.platform || book.book_platform || "";
    const header = [
        `<b>书评 · ${escapeHtml(title)}</b>`,
        author ? `作者：${escapeHtml(author)}` : "",
        `书号：<code>${escapeHtml(bookId || "")}</code>${platform ? ` · ${escapeHtml(platform)}` : ""}`,
        `共 ${total} 条`,
    ].filter(Boolean).join("\n");
    const body = rows.length
        ? rows.slice(0, 5).map((row, index) => reviewLine(row, index + 1)).join("\n\n")
        : "暂无书评。";
    const footer = [
        `<b>发布</b>：<code>/review ${escapeHtml(bookId || "书号")} 内容</code>`,
        `<b>规则</b>：Lv.${rules.min_level || 2}+ · ${rules.cost_copper ?? 100} 铜 · ${rules.min_length || 6}-${rules.max_length || 1200} 字`
    ].join("\n");
    return [header, body, footer].filter(Boolean).join("\n\n");
}

function reviewChannelText(review = {}) {
    const title = review.book_title || review.book_id || "";
    const author = review.book_author || "";
    return [
        "<b>新书评</b>",
        "",
        `<b>${escapeHtml(title)}</b>`,
        author ? `作者：${escapeHtml(author)}` : "",
        `书号：<code>${escapeHtml(review.book_id || "")}</code>`,
        `发布者：${escapeHtml(reviewAuthorName(review))}`,
        "",
        escapeHtml(truncate(cleanText(review.content || ""), 900)),
        "",
        `赞 ${Number(review.like_count || 0)} · 踩 ${Number(review.dislike_count || 0)}`
    ].filter(Boolean).join("\n");
}

function crowdCardText(result = {}, voted = false) {
    const book = result.book || {};
    const leaderboard = Array.isArray(result.leaderboard) ? result.leaderboard.slice(0, 8) : [];
    const rank = book.rank ? `#${book.rank}` : "暂无排名";
    const support = Number(book.supporter_count || 0);
    const totalSilver = Number(book.total_silver || 0);
    const stats = result.stats || {};
    const lines = [
        `<b>众筹榜投票</b>`,
        "",
        `<b>${escapeHtml(book.title || book.book_id || "-")}</b>`,
        `作者：${escapeHtml(book.author || "佚名")}`,
        `书号：<code>${escapeHtml(book.book_id || "")}</code>`,
        "",
        `当前排名：${escapeHtml(rank)}`,
        `支持人数：${support}`,
        `已投入：${totalSilver} 银币`,
        `单次支持：${CROWD_VOTE_COST} 银币`,
        voted ? "状态：你已支持过这本书" : "状态：点击下方按钮支持",
        "",
        `<b>众筹排行榜</b>`
    ];
    if (!leaderboard.length) {
        lines.push("暂无投票记录");
    } else {
        for (const row of leaderboard) {
            lines.push(`${row.rank || "-"} · ${escapeHtml(row.title || row.book_id)} · ${Number(row.supporter_count || 0)} 人`);
        }
    }
    lines.push("");
    lines.push(`总计：${Number(stats.total_books || 0)} 本书 · ${Number(stats.total_votes || 0)} 次支持 · ${Number(stats.total_silver || 0)} 银币`);
    return lines.filter(Boolean).join("\n");
}

function currencyLabel(currency) {
    if (currency === "exp") return "经验";
    return currency === "silver" ? "银币" : "铜币";
}

function transactionLine(row) {
    const sign = Number(row.amount || 0) > 0 ? "+" : "";
    const time = String(row.created_at || "").slice(0, 19).replace("T", " ");
    return `${time} · ${escapeHtml(row.type || "-")} · ${currencyLabel(row.currency)} ${sign}${row.amount} · 余额 ${row.balance}${row.detail ? ` · ${escapeHtml(row.detail)}` : ""}`;
}

function nonNegativeInt(value, fallback = 0) {
    const parsedFallback = Number(fallback);
    const safeFallback = Number.isFinite(parsedFallback) ? Math.max(0, Math.trunc(parsedFallback)) : 0;
    if (value === "" || value === null || value === undefined) return safeFallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return safeFallback;
    return Math.max(0, Math.trunc(parsed));
}

function normalizeExportPricing(data = {}) {
    const pricing = data.pricing || data;
    return {
        unlockCost: nonNegativeInt(pricing.unlockCost ?? pricing.unlock_cost, 100),
        freeCopperCost: nonNegativeInt(pricing.freeCopperCost ?? pricing.free_copper_cost, 100),
        paidChapterSilverCost: nonNegativeInt(pricing.paidChapterSilverCost ?? pricing.paid_chapter_silver_cost, 10)
    };
}

function inferredFreeChapterCount(book = {}) {
    const explicitFree = nonNegativeInt(book.free_chapters ?? book.freeChapters, 0);
    if (explicitFree > 0) return explicitFree;
    const explicitPaid = nonNegativeInt(book.paid_chapters ?? book.paidChapters, 0);
    const total = nonNegativeInt(book.total_chapters ?? book.totalChapters, 0);
    if (total > 0 && explicitPaid > 0 && total > explicitPaid) return total - explicitPaid;
    return 0;
}

function paidExportChapterCount(book = {}, rows = []) {
    const freeChapters = inferredFreeChapterCount(book);
    const explicitPaid = nonNegativeInt(book.paid_chapters ?? book.paidChapters, 0);
    const total = nonNegativeInt(book.total_chapters ?? book.totalChapters, 0);
    const inferredPaid = freeChapters > 0 ? total - freeChapters : 0;
    const paidMeta = Math.max(explicitPaid, inferredPaid);
    if (paidMeta <= 0 || !rows.length) return 0;
    const readableRows = rows.filter((row) => !isVolumeChapter(row));
    if (freeChapters <= 0) return Math.min(readableRows.length, paidMeta);
    let paid = 0;
    for (let i = 0; i < readableRows.length; i += 1) {
        const order = nonNegativeInt(readableRows[i].chapter_order ?? readableRows[i].chapterOrder, i + 1);
        if ((order || i + 1) > freeChapters) paid += 1;
    }
    return Math.min(paid, paidMeta);
}

function exportQuote(result = {}, pricing = {}) {
    const paidChapters = nonNegativeInt(result.paidChapters, 0);
    if (paidChapters > 0) {
        return {
            currency: "silver",
            amount: paidChapters * nonNegativeInt(pricing.paidChapterSilverCost, 10),
            paidChapters,
            unitCost: nonNegativeInt(pricing.paidChapterSilverCost, 10),
            label: "收费章节导出"
        };
    }
    return {
        currency: "copper",
        amount: nonNegativeInt(pricing.freeCopperCost, 100),
        paidChapters: 0,
        unitCost: nonNegativeInt(pricing.freeCopperCost, 100),
        label: "纯免费书导出"
    };
}

function exportQuoteText(quote = {}) {
    if (!Number(quote.amount || 0)) return "后台设置为 0，本次免费";
    if (quote.currency === "silver") return `${quote.amount} 银币（收费章节 ${quote.paidChapters} 章 × ${quote.unitCost}）`;
    return `${quote.amount} 铜币（纯免费书导出）`;
}

function scholarText(user = {}) {
    const scholar = user.scholar || {};
    const level = scholar.level || user.scholar_level || 1;
    const name = scholar.name || user.scholar_level_name || "卷首书童";
    const exp = scholar.exp ?? user.scholar_exp ?? 0;
    const toNext = scholar.exp_to_next ?? 0;
    return `${name} Lv.${level} · 经验 ${exp}${toNext ? ` · 距下一级 ${toNext}` : ""}`;
}

function freeExportText(freeExport = {}) {
    const limit = Number(freeExport.limit ?? freeExport.scholar?.daily_free_exports ?? 1);
    const used = Number(freeExport.used || 0);
    const remaining = Number(freeExport.remaining ?? Math.max(0, limit - used));
    return `今日免费导出：${used}/${limit} 本，剩余 ${remaining} 本`;
}

function freeExportCostLine(usage = {}) {
    const action = usage.repeated ? "复用今日免费额度" : "使用每日免费额度";
    const level = usage.level || usage.scholar?.level || 1;
    const name = usage.level_name || usage.scholar?.name || "卷首书童";
    return `本次扣费：0（${action}）；${name} Lv.${level} 今日剩余 ${usage.remaining ?? 0}/${usage.limit ?? level} 本`;
}

function parseRedPacketArgs(args = "") {
    const parts = String(args || "").split(/\s+/).filter(Boolean);
    let currency = "copper";
    if (/^(silver|银币|银元)$/i.test(parts[0] || "")) {
        currency = "silver";
        parts.shift();
    }
    let target = "";
    if ((parts[0] || "").startsWith("@")) target = parts.shift();
    const totalAmount = Math.trunc(Number(parts.shift() || 0));
    const totalCount = target ? 1 : Math.trunc(Number(parts.shift() || 1));
    const note = parts.join(" ").trim();
    return { currency, target, totalAmount, totalCount, note };
}

function redPacketMarkup(packetId) {
    return { inline_keyboard: [[{ text: "抢红包", callback_data: callback(["qhb", packetId]) }]] };
}

    return {
        callback,
        bookActions,
        bookReviewsActions,
        crowdActions,
        listActions,
        searchPager,
        searchRequestActions,
        mergeKeyboards,
        bookCardText,
        bookListItem,
        bookReviewsText,
        detailCardText,
        crowdCardText,
        reviewChannelText,
        reviewVoteActions,
        currencyLabel,
        transactionLine,
        nonNegativeInt,
        normalizeExportPricing,
        inferredFreeChapterCount,
        paidExportChapterCount,
        exportQuote,
        exportQuoteText,
        scholarText,
        freeExportText,
        freeExportCostLine,
        parseRedPacketArgs,
        redPacketMarkup
    };
}

module.exports = { createBotUi };
