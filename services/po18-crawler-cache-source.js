/**
 * [INPUT]: 依赖注入的 PostgreSQL query、缓存来源数量上限与 po18-crawler Parser 的书籍详情 URL 构造器
 * [OUTPUT]: 对外提供单次查询返回的未完整缓存 PO18 元信息书籍列表及已完结全缓存跳过计数
 * [POS]: services 的 PO18 数据库来源适配器，把去重、缓存完整性 SQL 与网络抓取编排隔离并避免重复数据库往返
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { bookDetailUrl } = require("./po18-crawler-parsers");

async function listIncompletePo18Books(options = {}) {
    const query = options.query;
    const cappedLimit = Math.max(1, Number(options.limit || options.defaultLimit || 500));
    const result = await query(
        `WITH latest AS (
            SELECT DISTINCT ON (m.book_id)
                m.book_id,
                m.title,
                m.author,
                m.tags,
                m.category,
                m.status,
                m.platform,
                m.detail_url,
                m.total_chapters,
                m.subscribed_chapters,
                m.chapter_count,
                m.free_chapters,
                m.paid_chapters,
                COALESCE(m.updated_at, m.created_at) AS metadata_at
            FROM book_metadata m
            WHERE LOWER(TRIM(COALESCE(m.platform, ''))) = 'po18'
              AND TRIM(COALESCE(m.book_id, '')) <> ''
            ORDER BY m.book_id, COALESCE(m.updated_at, m.created_at) DESC NULLS LAST, m.id DESC
         ),
         ranked AS (
            SELECT
                latest.*,
                COALESCE(s.cache_count, 0)::int AS cache_count,
                GREATEST(
                    COALESCE(latest.total_chapters, 0),
                    COALESCE(latest.subscribed_chapters, 0),
                    COALESCE(latest.chapter_count, 0),
                    COALESCE(latest.free_chapters, 0) + COALESCE(latest.paid_chapters, 0)
                )::int AS expected_chapters
            FROM latest
            LEFT JOIN book_stats s ON s.book_id = latest.book_id
         ),
         classified AS (
            SELECT
                ranked.*,
                expected_chapters > 0
                    AND cache_count >= expected_chapters
                    AND COALESCE(status, '') ~ '(完结|完結|完本|已完成)' AS complete
            FROM ranked
         ),
         selected AS (
            SELECT *
            FROM classified
            WHERE NOT complete
            ORDER BY metadata_at DESC NULLS LAST, book_id DESC
            LIMIT $1
         )
         SELECT
            (SELECT COUNT(*)::int FROM classified WHERE complete) AS skipped_complete,
            COALESCE(
                jsonb_agg(to_jsonb(selected) ORDER BY selected.metadata_at DESC NULLS LAST, selected.book_id DESC)
                    FILTER (WHERE selected.book_id IS NOT NULL),
                '[]'::jsonb
            ) AS books
         FROM selected`,
        [cappedLimit]
    );
    const payload = result.rows?.[0] || {};
    const rows = Array.isArray(payload.books) ? payload.books : [];

    return {
        skippedComplete: Number(payload.skipped_complete || 0),
        books: rows.map((row) => ({
            bookId: String(row.book_id),
            book_id: String(row.book_id),
            title: row.title || "",
            author: row.author || "",
            tags: row.tags || "",
            category: row.category || "",
            status: row.status || "",
            totalChapters: Number(row.total_chapters || 0),
            subscribedChapters: Number(row.subscribed_chapters || 0),
            chapterCount: Number(row.chapter_count || 0),
            freeChapters: Number(row.free_chapters || 0),
            paidChapters: Number(row.paid_chapters || 0),
            cacheCount: Number(row.cache_count || 0),
            expectedChapters: Number(row.expected_chapters || 0),
            platform: "po18",
            detailUrl: row.detail_url || bookDetailUrl(row.book_id)
        }))
    };
}

module.exports = { listIncompletePo18Books };
