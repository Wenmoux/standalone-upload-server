/**
 * [INPUT]: 依赖注入的标签/热搜/榜单查询与平台过滤参数，将多来源权重合并为词频
 * [OUTPUT]: 对外提供词云服务以及词条规范化、标签拆分、热词计分和结果合并函数
 * [POS]: services 的发现聚合层，为 Bot 与 Reader 提供稳定词云而不暴露各来源查询结构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const TAG_SPLIT_RE = /[,，、/\s:：;；|#]+/u;

function clampInt(value, min, max, fallback) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizeCloudWord(value = "") {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^#/, "")
        .slice(0, 40);
}

function splitCloudTags(value = "") {
    return String(value || "")
        .split(TAG_SPLIT_RE)
        .map(normalizeCloudWord)
        .filter((word) => word && !/^[\d._-]+$/.test(word));
}

function scoreHotKeyword(row = {}) {
    const count = Math.max(0, Number(row.count || 0));
    const resultCount = Math.max(0, Number(row.result_count || row.total_results || 0));
    return Math.max(1, Math.round(count * 30 + Math.sqrt(resultCount) * 5));
}

function mergeCloudRows(...groups) {
    const map = new Map();
    for (const rows of groups) {
        for (const row of Array.isArray(rows) ? rows : []) {
            const text = normalizeCloudWord(row.text || row.keyword || row.tag || row.value);
            if (!text) continue;
            const key = text.toLowerCase();
            const weight = Math.max(1, Math.round(Number(row.weight ?? row.score ?? row.count ?? row.value ?? 1) || 1));
            const current = map.get(key) || { text, weight: 0, count: 0, sources: new Set(), type: row.type || "" };
            current.text = current.text || text;
            current.weight += weight;
            current.count += Math.max(0, Math.round(Number(row.count || 0) || 0));
            if (row.type) current.sources.add(String(row.type));
            map.set(key, current);
        }
    }
    return [...map.values()]
        .map((row) => ({ ...row, sources: [...row.sources] }))
        .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text, "zh-CN"));
}

function createWordCloudService(options = {}) {
    const query = options.query;
    const getHotKeywords = options.getHotKeywords || (async () => []);
    const cacheTtlMs = clampInt(options.cacheTtlMs ?? process.env.PO18_WORD_CLOUD_CACHE_TTL_MS, 0, 3600000, 300000);
    const cache = new Map();

    function cacheKey({ limit, hotLimit, sourceLimit, platform }) {
        return [platform || "", limit, hotLimit, sourceLimit].join("|");
    }

    function readCache(key) {
        if (!cacheTtlMs) return null;
        const row = cache.get(key);
        if (!row) return null;
        if (row.expiresAt <= Date.now()) {
            cache.delete(key);
            return null;
        }
        return JSON.parse(JSON.stringify(row.payload));
    }

    function writeCache(key, payload) {
        if (!cacheTtlMs) return;
        cache.set(key, { expiresAt: Date.now() + cacheTtlMs, payload: JSON.parse(JSON.stringify(payload)) });
        while (cache.size > 30) cache.delete(cache.keys().next().value);
    }

    async function hotTagRows({ platform = "", sourceLimit = 300, limit = 80 } = {}) {
        if (typeof query !== "function") return [];
        const safePlatform = String(platform || "").trim().toLowerCase().slice(0, 40);
        const safeSourceLimit = clampInt(sourceLimit, 20, 2000, 300);
        const safeLimit = clampInt(limit, 5, 200, 80);
        const params = [safePlatform, safeSourceLimit, safeLimit];
        const result = await query(
            `WITH source_books AS (
                SELECT bs.book_id,
                       bs.platform,
                       bs.cache_count,
                       bs.updated_at
                FROM book_stats bs
                WHERE bs.cache_count > 0
                  AND ($1::text = '' OR LOWER(TRIM(COALESCE(bs.platform, ''))) = $1)
                ORDER BY bs.cache_count DESC, bs.updated_at DESC, bs.book_id ASC
                LIMIT $2
             ),
             hot_books AS (
                SELECT meta.tags,
                       meta.category,
                       source_books.cache_count,
                       (
                         COALESCE(meta.total_popularity, 0)
                         + COALESCE(meta.monthly_popularity, 0) * 2
                         + COALESCE(meta.weekly_popularity, 0) * 3
                         + COALESCE(meta.favorites_count, 0) * 5
                         + COALESCE(meta.comments_count, 0) * 2
                         + COALESCE(source_books.cache_count, 0) * 20
                       )::int AS heat,
                       COALESCE(meta.updated_at, meta.created_at, source_books.updated_at) AS updated_at,
                       meta.id
                FROM source_books
                JOIN LATERAL (
                    SELECT m.*
                    FROM book_metadata m
                    WHERE m.book_id = source_books.book_id
                      AND ($1::text = '' OR LOWER(TRIM(COALESCE(m.platform, source_books.platform, ''))) = $1)
                    ORDER BY COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                    LIMIT 1
                ) meta ON true
                ORDER BY heat DESC, source_books.cache_count DESC, updated_at DESC, meta.id DESC
                LIMIT $2
             ),
             words AS (
                SELECT trim(regexp_split_to_table(CONCAT_WS(',', category, tags), '[,，、/:：;；|#[:space:]]+')) AS tag,
                       GREATEST(1, heat) AS heat,
                       GREATEST(1, cache_count) AS cache_count
                FROM hot_books
             )
             SELECT tag AS text,
                    'tag' AS type,
                    COUNT(*)::int AS count,
                    SUM(heat + cache_count * 8)::int AS weight
             FROM words
             WHERE tag <> '' AND char_length(tag) <= 40 AND tag !~ '^[0-9._-]+$'
             GROUP BY tag
             ORDER BY weight DESC, count DESC, tag ASC
             LIMIT $3`,
            params
        );
        return result.rows || [];
    }

    async function wordCloudPayload(options = {}) {
        const limit = clampInt(options.limit, 10, 120, 60);
        const hotLimit = clampInt(options.hotLimit, 5, 100, Math.min(40, limit));
        const sourceLimit = clampInt(options.sourceLimit, 20, 2000, 300);
        const platform = String(options.platform || "").trim().toLowerCase().slice(0, 40);
        const key = cacheKey({ limit, hotLimit, sourceLimit, platform });
        const cached = readCache(key);
        if (cached) return { ...cached, cached: true };
        const [hotRows, tagRows] = await Promise.all([
            getHotKeywords(hotLimit).catch(() => []),
            hotTagRows({ platform, sourceLimit, limit: Math.max(limit, 80) }).catch(() => [])
        ]);
        const hotCloudRows = (Array.isArray(hotRows) ? hotRows : []).map((row) => ({
            text: row.keyword,
            type: row.type || "search",
            count: row.count || 0,
            weight: scoreHotKeyword(row)
        }));
        const rows = mergeCloudRows(hotCloudRows, tagRows)
            .slice(0, limit)
            .map((row, index) => ({
                text: row.text,
                weight: row.weight,
                count: row.count,
                rank: index + 1,
                sources: row.sources
            }));
        const payload = {
            rows,
            generated_at: new Date().toISOString(),
            cached: false,
            limit,
            sourceLimit,
            platform,
            sources: {
                hot_keywords: hotCloudRows.length,
                tags: tagRows.length
            }
        };
        writeCache(key, payload);
        return payload;
    }

    return {
        hotTagRows,
        mergeCloudRows,
        normalizeCloudWord,
        splitCloudTags,
        wordCloudPayload
    };
}

module.exports = {
    createWordCloudService,
    mergeCloudRows,
    normalizeCloudWord,
    scoreHotKeyword,
    splitCloudTags
};
