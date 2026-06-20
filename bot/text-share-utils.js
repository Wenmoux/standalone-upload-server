function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function textToParagraphs(value = "") {
    const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") : "<p></p>";
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

function waitForStream(stream, event) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            stream.off(event, onEvent);
            stream.off("error", onError);
        };
        const onEvent = (...args) => {
            cleanup();
            resolve(args);
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        stream.once(event, onEvent);
        stream.once("error", onError);
    });
}

async function writeStreamChunk(stream, chunk) {
    if (stream.write(chunk, "utf8")) return;
    await waitForStream(stream, "drain");
}

async function finishWriteStream(stream) {
    stream.end();
    await waitForStream(stream, "finish");
}

function cleanText(value = "") {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/gi, "\n")
        .replace(/<(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/[ \t\f\v]+\n/g, "\n")
        .replace(/\n[ \t\f\v]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function hasHtmlBreaks(value = "") {
    return /<br\s*\/?>|<\/?(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/i.test(String(value || ""));
}

function chapterPlainText(chapter = {}) {
    const htmlText = cleanText(chapter.html || "");
    const rawText = String(chapter.text || "").replace(/\r\n?/g, "\n");
    const storedText = (hasHtmlBreaks(rawText) ? cleanText(rawText) : rawText).trim();
    if (!htmlText) return storedText;
    if (!storedText) return htmlText;
    const htmlParagraphs = (String(chapter.html || "").match(/<p\b/gi) || []).length;
    const storedLines = storedText.split(/\n/).filter((line) => line.trim()).length;
    const htmlLines = htmlText.split(/\n/).filter((line) => line.trim()).length;
    if (htmlParagraphs > 1 && storedLines <= 1 && htmlLines > 1) return htmlText;
    return storedText;
}

function isVolumeChapter(chapter = {}) {
    if (!chapter) return false;
    const value = chapter.is_volume ?? chapter.isVolume;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["1", "true", "yes", "y", "on", "volume"].includes(String(value || "").trim().toLowerCase());
}

function safeFileName(value, fallback = "book") {
    const name = String(value || fallback).replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
    return (name || fallback).slice(0, 80);
}

function bytes(value) {
    const size = Number(value || 0);
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
}

function userDisplayName(user = {}) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `tg_${user.id || "unknown"}`;
}

function mentionUser(user = {}, fallback = {}) {
    const username = String(user.telegram_username || user.username || fallback.username || "").trim().replace(/^@+/, "");
    if (username) return `@${escapeHtml(username)}`;

    const id = String(user.telegram_id || fallback.id || "").trim();
    const label = escapeHtml(user.nickname || userDisplayName(fallback) || userDisplayName(user) || "这位用户");
    if (id) return `<a href="tg://user?id=${encodeURIComponent(id)}">${label}</a>`;
    return label;
}

function splitTags(value = "") {
    if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
    return String(value || "").split(/[,，\s、|/]+/).map((tag) => tag.trim()).filter(Boolean);
}

function numberField(value) {
    return Number(value || 0) || 0;
}

function bookToSharePayload(book, uploader, uploaderId) {
    const bookId = String(book.book_id || book.bookId || "").trim();
    return {
        bookId,
        bid: bookId,
        title: book.title || "",
        author: book.author || "",
        cover: book.cover || "",
        description: cleanText(book.description_html || book.description || ""),
        descriptionHTML: book.description_html || book.description || "",
        tags: splitTags(book.tags).join(","),
        wordCount: numberField(book.word_count),
        freeChapters: numberField(book.free_chapters),
        paidChapters: numberField(book.paid_chapters),
        totalChapters: numberField(book.total_chapters),
        subscribedChapters: numberField(book.subscribed_chapters || book.total_chapters),
        status: book.status || "",
        latestChapterName: book.latest_chapter_name || "",
        latestChapterDate: book.latest_chapter_date || "",
        totalPopularity: numberField(book.total_popularity),
        monthlyPopularity: numberField(book.monthly_popularity),
        weeklyPopularity: numberField(book.weekly_popularity),
        dailyPopularity: numberField(book.daily_popularity),
        favoritesCount: numberField(book.favorites_count),
        commentsCount: numberField(book.comments_count),
        purchaseCount: numberField(book.purchase_count),
        readersCount: numberField(book.readers_count),
        platform: book.platform || "po18",
        detailUrl: book.detail_url || "",
        uploader,
        uploaderId
    };
}

function extractCacheIds(cacheResponse) {
    const ids = new Set();
    const walk = (value) => {
        if (value === null || value === undefined || value === "") return;
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (typeof value === "object") {
            for (const key of ["chapterId", "chapter_id", "id"]) {
                if (value[key] !== undefined && value[key] !== null && value[key] !== "") ids.add(String(value[key]));
            }
            for (const key of ["chapters", "cachedChapters", "cachedChapterIds", "chapterIds", "data", "items", "list"]) {
                if (key in value) walk(value[key]);
            }
            return;
        }
        ids.add(String(value));
    };
    walk(cacheResponse);
    return ids;
}

function chapterToSharePayload(book, chapter, index, uploader, uploaderId) {
    const chapterId = String(chapter.chapter_id || chapter.chapterId || chapter.id || index).trim();
    const title = chapter.title || `第${index}章`;
    const text = cleanText(chapter.text || chapter.html || "");
    const html = String(chapter.html || "").trim() || textToParagraphs(text);
    const chapterOrder = Number(chapter.chapter_order ?? chapter.chapterOrder ?? index) || index;
    return {
        bookId: String(book.book_id || book.bookId || ""),
        chapterId,
        title,
        html,
        text,
        chapterOrder,
        fromUserScript: true,
        platform: chapter.platform || book.platform || "po18",
        uploader,
        uploaderId
    };
}

module.exports = {
    escapeHtml,
    textToParagraphs,
    delay,
    yieldToEventLoop,
    waitForStream,
    writeStreamChunk,
    finishWriteStream,
    cleanText,
    hasHtmlBreaks,
    chapterPlainText,
    isVolumeChapter,
    safeFileName,
    bytes,
    userDisplayName,
    mentionUser,
    splitTags,
    numberField,
    bookToSharePayload,
    extractCacheIds,
    chapterToSharePayload
};
