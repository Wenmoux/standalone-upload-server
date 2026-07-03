const TAG_SPLIT_RE = /[,，、|/\s:：;；#＃·•・]+/u;

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

    async function hotTagRows({ platform = "", sourceLimit = 300, limit = 80 } = {}) {
        if (typeof query !== "function") return [];
        const safePlatform = String(platform || "").trim().toLowerCase().slice(0, 40);
        const safeSourceLimit = clampInt(sourceLimit, 20, 2000, 300);
        const safeLimit = clampInt(limit, 5, 200, 80);
        const params = [safePlatform, safeSourceLimit, safeLimit];
        const result = await query(
            `WITH ranked AS (
                SELECT DISTINCT ON (m.book_id)
                       m.book_id,
                       m.tags,
                       m.category,
                       m.platform,
                       COALESCE(bs.cache_count, 0)::int AS cache_count,
                       (
                         COALESCE(m.total_popularity, 0)
                         + COALESCE(m.monthly_popularity, 0) * 2
                         + COALESCE(m.weekly_popularity, 0) * 3
                         + COALESCE(m.favorites_count, 0) * 5
                         + COALESCE(m.comments_count, 0) * 2
                         + COALESCE(bs.cache_count, 0) * 20
                       )::int AS heat,
                       COALESCE(m.updated_at, m.created_at) AS updated_at,
                       m.id
                FROM book_metadata m
                LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                WHERE ($1::text = '' OR LOWER(TRIM(COALESCE(m.platform, ''))) = $1)
                  AND COALESCE(bs.cache_count, 0) > 0
                ORDER BY m.book_id,
                         COALESCE(bs.cache_count, 0) DESC,
                         COALESCE(m.subscribed_chapters, m.total_chapters, m.chapter_count, 0) DESC,
                         COALESCE(m.updated_at, m.created_at) DESC,
                         m.id DESC
             ),
             hot_books AS (
                SELECT *
                FROM ranked
                ORDER BY heat DESC, cache_count DESC, updated_at DESC, id DESC
                LIMIT $2
             ),
             words AS (
                SELECT trim(regexp_split_to_table(CONCAT_WS(',', category, tags), '[,，、|/\\s:：;；#＃·•・]+')) AS tag,
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
        return {
            rows,
            generated_at: new Date().toISOString(),
            limit,
            sourceLimit,
            platform,
            sources: {
                hot_keywords: hotCloudRows.length,
                tags: tagRows.length
            }
        };
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
