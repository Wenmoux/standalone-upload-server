const RANK_MAX_SOURCE_LIMIT = 20000;
const RANK_DEFAULT_SOURCE_LIMIT = 5000;
const RANK_MAX_PAGE_LIMIT = 300;
const RANK_DEFAULT_PAGE_LIMIT = 80;

const RANK_SORTS = {
    overall: { label: "综合热度", metric: "heat" },
    updated: { label: "最近更新", metric: "updated_at" },
    cache: { label: "缓存最多", metric: "cache_count" },
    words: { label: "字数最多", metric: "word_count" },
    chapters: { label: "章节最多", metric: "chapter_count" }
};

function positiveMs(value, fallback, min = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
}

function normalizePlatformKey(value = "") {
    return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function textFromHtml(html = "") {
    return String(html || "")
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
        .replace(/\n{2,}/g, "\n")
        .trim();
}

function hasHtmlBreaks(value = "") {
    return /<br\s*\/?>|<\/?(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/i.test(String(value || ""));
}

function rankSnippet(value = "", maxLength = 120) {
    const raw = String(value || "");
    const text = (hasHtmlBreaks(raw) || /<[^>]+>/.test(raw) ? textFromHtml(raw) : raw)
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/\n+/g, " ")
        .trim();
    if (!text) return "";
    const chars = Array.from(text);
    return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}...` : text;
}

function rankTags(value = "") {
    return String(value || "")
        .split(/[,\s，、|/]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6);
}

function rankCategory(book = {}) {
    const category = String(book.category || "").trim();
    if (category) return category;
    return rankTags(book.tags)[0] || "未分类";
}

function rankPlatformLabel(labels = {}, platform = "") {
    const raw = String(platform || "").trim();
    if (!raw) return "未知站点";
    const exact = labels[raw];
    if (exact) return exact;
    const normalized = normalizePlatformKey(raw);
    const matched = Object.entries(labels).find(([key]) => normalizePlatformKey(key) === normalized);
    return matched?.[1] || raw;
}

function originalBookUrl(book = {}) {
    const raw = String(book.detail_url || book.detailUrl || "").trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    const platform = normalizePlatformKey(book.platform || "");
    const bookId = encodeURIComponent(String(book.book_id || "").trim());
    if (!bookId) return "";
    if (platform === "po18") return `https://www.po18.tw/books/${bookId}/articles`;
    if (platform === "popo") return `https://www.popo.tw/books/${bookId}`;
    if (platform === "qidian" || platform === "qd") return `https://book.qidian.com/info/${bookId}/`;
    return "";
}

function rankHeat(book = {}) {
    const n = (key) => Number(book[key] || 0);
    return Math.max(0,
        n("total_popularity") +
        n("monthly_popularity") * 2 +
        n("weekly_popularity") * 3 +
        n("daily_popularity") * 4 +
        n("favorites_count") * 5 +
        n("comments_count") * 8 +
        n("readers_count") +
        n("purchase_count") * 10 +
        n("like_count") * 20 +
        n("supporter_count") * 30 +
        Math.floor(n("crowd_silver") / 10)
    );
}

function rankDisplayHeat(book = {}) {
    for (const key of ["total_popularity", "monthly_popularity", "weekly_popularity", "daily_popularity", "readers_count", "favorites_count", "comments_count", "purchase_count"]) {
        const value = Number(book[key] || 0);
        if (value > 0) return value;
    }
    return rankHeat(book);
}

function createRankService(options = {}) {
    const query = options.query;
    const labelsProvider = typeof options.labelsProvider === "function" ? options.labelsProvider : async () => ({});
    const cacheTtlMs = positiveMs(options.cacheTtlMs ?? process.env.PO18_RANK_CACHE_MS, 10 * 60 * 1000, 60 * 1000);
    const refreshIntervalMs = positiveMs(options.refreshIntervalMs ?? process.env.PO18_RANK_REFRESH_INTERVAL_MS, 30 * 60 * 1000, 0);
    const cache = { at: 0, payload: null, loading: null, error: null };
    let refreshTimer = null;

    function sourceLimit(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return RANK_DEFAULT_SOURCE_LIMIT;
        return Math.min(RANK_MAX_SOURCE_LIMIT, Math.max(1, Math.trunc(parsed)));
    }

    function pageLimit(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return RANK_DEFAULT_PAGE_LIMIT;
        return Math.min(RANK_MAX_PAGE_LIMIT, Math.max(1, Math.trunc(parsed)));
    }

    function sortKey(value) {
        const key = String(value || "overall").trim().toLowerCase();
        return RANK_SORTS[key] ? key : "overall";
    }

    function timestamp(value) {
        if (!value) return 0;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    function chapterCount(book = {}) {
        return Math.max(Number(book.total_chapters || 0), Number(book.subscribed_chapters || 0), Number(book.chapter_count || 0));
    }

    function compare(sort = "overall") {
        const key = sortKey(sort);
        return (a, b) => {
            if (key === "updated") {
                return timestamp(b.updated_at || b.latest_chapter_date || b.created_at) - timestamp(a.updated_at || a.latest_chapter_date || a.created_at)
                    || rankHeat(b) - rankHeat(a)
                    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
            }
            if (key === "cache") {
                return Number(b.cache_count || 0) - Number(a.cache_count || 0)
                    || rankHeat(b) - rankHeat(a)
                    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
            }
            if (key === "words") {
                return Number(b.word_count || 0) - Number(a.word_count || 0)
                    || chapterCount(b) - chapterCount(a)
                    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
            }
            if (key === "chapters") {
                return chapterCount(b) - chapterCount(a)
                    || Number(b.cache_count || 0) - Number(a.cache_count || 0)
                    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
            }
            return rankHeat(b) - rankHeat(a)
                || Number(b.total_popularity || 0) - Number(a.total_popularity || 0)
                || timestamp(b.updated_at || b.created_at) - timestamp(a.updated_at || a.created_at)
                || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
        };
    }

    function publicBook(book = {}) {
        return {
            book_id: String(book.book_id || ""),
            title: String(book.title || book.book_id || "未命名书籍").trim(),
            author: String(book.author || "").trim(),
            platform: String(book.platform || "").trim() || "unknown",
            platform_label: book.platform_label || String(book.platform || "未知站点").trim() || "未知站点",
            category: book.category_label || book.category || "未分类",
            tags: Array.isArray(book.tag_list) ? book.tag_list : rankTags(book.tags),
            cover: String(book.cover || "").trim(),
            description: book.description_text || rankSnippet(book.description_html || book.description || "", 180),
            source_url: book.source_url || originalBookUrl(book),
            word_count: Number(book.word_count || 0),
            chapter_count: chapterCount(book),
            total_chapters: Number(book.total_chapters || 0),
            subscribed_chapters: Number(book.subscribed_chapters || 0),
            cache_count: Number(book.cache_count || 0),
            heat: Number(book.heat ?? rankHeat(book)),
            display_heat: Number(book.display_heat ?? rankDisplayHeat(book)),
            like_count: Number(book.like_count || 0),
            dislike_count: Number(book.dislike_count || 0),
            supporter_count: Number(book.supporter_count || 0),
            crowd_silver: Number(book.crowd_silver || 0),
            total_popularity: Number(book.total_popularity || 0),
            updated_at: book.updated_at || null,
            created_at: book.created_at || null,
            latest_chapter_date: book.latest_chapter_date || null
        };
    }

    function groupRows(rows = [], keyGetter, labelGetter) {
        const groups = new Map();
        for (const row of rows) {
            const key = String(keyGetter(row) || "").trim() || "unknown";
            const label = String(labelGetter(row) || key || "未知").trim();
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    label,
                    count: 0,
                    heat: 0,
                    cache_count: 0,
                    word_count: 0,
                    latest_at: null,
                    books: []
                });
            }
            const group = groups.get(key);
            group.count += 1;
            group.heat += Number(row.heat || 0);
            group.cache_count += Number(row.cache_count || 0);
            group.word_count += Number(row.word_count || 0);
            const latestAt = row.updated_at || row.latest_chapter_date || row.created_at;
            if (timestamp(latestAt) > timestamp(group.latest_at)) group.latest_at = latestAt || null;
            group.books.push(row);
        }
        return [...groups.values()]
            .map((group) => ({
                ...group,
                top: group.books.sort(compare("overall")).slice(0, 6).map(publicBook),
                books: undefined
            }))
            .sort((a, b) => b.count - a.count || b.heat - a.heat || a.label.localeCompare(b.label, "zh-CN"));
    }

    function filterRows(rows = [], { q = "", site = "", category = "" } = {}) {
        const keyword = String(q || "").trim().toLowerCase();
        const siteKey = normalizePlatformKey(site);
        const categoryKey = String(category || "").trim().toLowerCase();
        return rows.filter((row) => {
            if (siteKey && normalizePlatformKey(row.platform) !== siteKey && normalizePlatformKey(row.platform_label) !== siteKey) return false;
            if (categoryKey && String(row.category_label || row.category || "").trim().toLowerCase() !== categoryKey) return false;
            if (!keyword) return true;
            const haystack = [
                row.book_id,
                row.title,
                row.author,
                row.platform,
                row.platform_label,
                row.category_label,
                row.category,
                ...(Array.isArray(row.tag_list) ? row.tag_list : rankTags(row.tags))
            ].join(" ").toLowerCase();
            return haystack.includes(keyword);
        });
    }

    async function buildPayload(options = {}) {
        if (typeof query !== "function") throw new Error("rank query function is not configured");
        const limit = sourceLimit(options.limit ?? process.env.PO18_RANK_SOURCE_LIMIT);
        const labels = await labelsProvider();
        const result = await query(
            `WITH ranked AS (
                SELECT m.*,
                       ROW_NUMBER() OVER (
                         PARTITION BY COALESCE(NULLIF(TRIM(m.platform), ''), 'unknown'), m.book_id
                         ORDER BY COALESCE(m.total_popularity, 0) DESC,
                                  COALESCE(m.monthly_popularity, 0) DESC,
                                  COALESCE(m.weekly_popularity, 0) DESC,
                                  COALESCE(m.daily_popularity, 0) DESC,
                                  COALESCE(m.subscribed_chapters, 0) DESC,
                                  COALESCE(m.updated_at, m.created_at) DESC,
                                  m.id DESC
                       ) rn
                FROM book_metadata m
             )
             SELECT r.*,
                    COALESCE(bs.cache_count, 0)::int cache_count,
                    COALESCE(bs.like_count, 0)::int like_count,
                    COALESCE(bs.dislike_count, 0)::int dislike_count,
                    COALESCE(bs.crowd_votes, 0)::int supporter_count,
                    COALESCE(bs.crowd_silver, 0)::int crowd_silver,
                    COUNT(*) OVER()::int total_count
             FROM ranked r
             LEFT JOIN book_stats bs ON bs.book_id = r.book_id
             WHERE r.rn = 1
               AND COALESCE(bs.cache_count, 0) >= 1
             ORDER BY COALESCE(r.updated_at, r.created_at) DESC, r.id DESC
             LIMIT $1`,
            [limit]
        );
        const rows = (result.rows || []).map((row) => {
            const platformLabel = rankPlatformLabel(labels, row.platform);
            const tagList = rankTags(row.tags);
            const categoryLabel = rankCategory(row);
            const heat = rankHeat(row);
            return {
                ...row,
                platform_label: platformLabel,
                tag_list: tagList,
                category_label: categoryLabel,
                description_text: rankSnippet(row.description_html || row.description || "", 180),
                source_url: originalBookUrl(row),
                heat,
                display_heat: rankDisplayHeat(row),
                chapter_count: chapterCount(row)
            };
        });
        const generatedAt = new Date();
        const totalCount = Number(rows[0]?.total_count || rows.length || 0);
        const rankings = Object.fromEntries(
            Object.keys(RANK_SORTS).map((key) => [key, [...rows].sort(compare(key)).slice(0, 30).map(publicBook)])
        );
        return {
            meta: {
                generatedAt: generatedAt.toISOString(),
                cacheTtlMs,
                refreshIntervalMs,
                sourceLimit: limit,
                returned: rows.length,
                total: totalCount,
                truncated: totalCount > rows.length
            },
            sorts: RANK_SORTS,
            rows,
            rankings,
            sites: groupRows(rows, (row) => row.platform, (row) => row.platform_label),
            categories: groupRows(rows, (row) => row.category_label, (row) => row.category_label)
        };
    }

    async function getPayload(options = {}) {
        const limit = sourceLimit(options.limit ?? process.env.PO18_RANK_SOURCE_LIMIT);
        const stale = !cache.payload || Date.now() - cache.at > cacheTtlMs || Number(cache.payload?.meta?.sourceLimit || 0) < limit;
        if (!options.refresh && !stale) return cache.payload;
        if (!cache.loading) {
            cache.loading = buildPayload({ limit })
                .then((payload) => {
                    cache.payload = payload;
                    cache.at = Date.now();
                    cache.error = null;
                    return payload;
                })
                .catch((err) => {
                    cache.error = err?.message || String(err);
                    throw err;
                })
                .finally(() => {
                    cache.loading = null;
                });
        }
        return cache.loading;
    }

    function statusPayload() {
        const payload = cache.payload;
        const ageMs = cache.at ? Math.max(0, Date.now() - cache.at) : null;
        return {
            ready: !!payload,
            loading: !!cache.loading,
            error: cache.error,
            entry: "/rank",
            api: "/reader-api/rank",
            generatedAt: payload?.meta?.generatedAt || null,
            cacheAgeMs: ageMs,
            cacheTtlMs,
            refreshIntervalMs,
            sourceLimit: payload?.meta?.sourceLimit || sourceLimit(process.env.PO18_RANK_SOURCE_LIMIT),
            returned: payload?.meta?.returned || 0,
            total: payload?.meta?.total || 0,
            truncated: !!payload?.meta?.truncated,
            sitesCount: payload?.sites?.length || 0,
            categoriesCount: payload?.categories?.length || 0,
            sorts: RANK_SORTS,
            sites: (payload?.sites || []).slice(0, 12),
            categories: (payload?.categories || []).slice(0, 12),
            leaders: Object.fromEntries(Object.keys(RANK_SORTS).map((key) => [key, (payload?.rankings?.[key] || []).slice(0, 5)]))
        };
    }

    async function readerPayload(queryParams = {}) {
        const payload = await getPayload();
        const activeSort = sortKey(queryParams.sort);
        const limit = pageLimit(queryParams.limit);
        const offset = Math.max(0, Number(queryParams.offset || 0));
        const filtered = filterRows(payload.rows, {
            q: queryParams.q,
            site: queryParams.site || queryParams.platform,
            category: queryParams.category
        }).sort(compare(activeSort));
        const rows = filtered.slice(offset, offset + limit).map((row, index) => ({
            rank: offset + index + 1,
            ...publicBook(row)
        }));
        return {
            success: true,
            meta: {
                ...payload.meta,
                cacheAgeMs: cache.at ? Math.max(0, Date.now() - cache.at) : null,
                loading: !!cache.loading
            },
            active: {
                sort: activeSort,
                q: String(queryParams.q || "").trim(),
                site: String(queryParams.site || queryParams.platform || "").trim(),
                category: String(queryParams.category || "").trim(),
                limit,
                offset,
                total: filtered.length
            },
            sorts: payload.sorts,
            sites: payload.sites,
            categories: payload.categories,
            leaders: payload.rankings,
            rows
        };
    }

    function startRefreshScheduler() {
        if (refreshTimer || refreshIntervalMs <= 0) return;
        const refresh = () => {
            getPayload({ refresh: true }).catch((err) => {
                const logger = options.logger || console;
                logger.warn?.(`[rank] refresh failed: ${err.message || String(err)}`);
            });
        };
        const warmTimer = setTimeout(refresh, Math.max(5000, Number(process.env.PO18_RANK_WARM_DELAY_MS || 15000)));
        warmTimer.unref?.();
        refreshTimer = setInterval(refresh, refreshIntervalMs);
        refreshTimer.unref?.();
    }

    function stopRefreshScheduler() {
        if (!refreshTimer) return;
        clearInterval(refreshTimer);
        refreshTimer = null;
    }

    return {
        buildPayload,
        cache,
        chapterCount,
        compare,
        filterRows,
        getPayload,
        pageLimit,
        publicBook,
        readerPayload,
        sourceLimit,
        startRefreshScheduler,
        statusPayload,
        stopRefreshScheduler,
        sortKey,
        sorts: RANK_SORTS
    };
}

module.exports = {
    RANK_SORTS,
    createRankService,
    normalizePlatformKey,
    originalBookUrl,
    rankCategory,
    rankDisplayHeat,
    rankHeat,
    rankPlatformLabel,
    rankSnippet,
    rankTags
};
