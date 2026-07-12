/**
 * [INPUT]: 依赖注入的 PostgreSQL query 与书库质量阈值，执行只读诊断 SQL
 * [OUTPUT]: 对外提供重复书籍、缺章、元数据异常与大正文诊断服务，以及查询/行号辅助函数
 * [POS]: services 的数据质量观测层，只报告潜在缺陷而不混入修复副作用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const latestBooksSql = `
    SELECT DISTINCT ON (book_id)
           book_id, title, author, cover, description, platform, status,
           expected_chapters::int,
           expected_chapters_source,
           source_updated_at, catalog_updated_at, metadata_cached_at,
           updated_at, created_at
    FROM book_metadata
    ORDER BY book_id,
             COALESCE(subscribed_chapters, total_chapters, 0) DESC,
             COALESCE(updated_at, created_at) DESC,
             id DESC
`;

function rowNumber(row, key, fallback = 0) {
    return Number(row?.[key] ?? fallback) || 0;
}

function createDataQualityService(options = {}) {
    const query = options.query || (async () => ({ rows: [] }));
    const metricsTtlMs = Math.max(1000, Number(options.metricsTtlMs || process.env.PO18_QUALITY_METRICS_TTL_MS || 60000));
    let metricsCache = null;
    let metricsCachedAt = 0;

    async function collectDataQualityMetrics({ force = false } = {}) {
        if (!force && metricsCache && Date.now() - metricsCachedAt < metricsTtlMs) return metricsCache;
        const largeChapterBytes = Math.max(1024, Number(process.env.PO18_QUALITY_LARGE_CHAPTER_BYTES || 1024 * 1024));
        const result = await query(
            `WITH latest_books AS (${latestBooksSql}),
                  cache AS (
                    SELECT book_id,
                           COUNT(*) FILTER (WHERE COALESCE(is_volume, false) = false)::int cached_chapters
                    FROM chapter_cache
                    GROUP BY book_id
                  ),
                  order_drift AS (
                    SELECT book_id
                    FROM chapter_cache
                    WHERE COALESCE(is_volume, false) = false
                    GROUP BY book_id
                    HAVING MIN(chapter_order) < 0
                       OR (COUNT(*) FILTER (WHERE chapter_order > 0) > 0 AND MIN(chapter_order) FILTER (WHERE chapter_order > 0) <> 1)
                       OR MAX(chapter_order) FILTER (WHERE chapter_order > 0) <> COUNT(DISTINCT chapter_order) FILTER (WHERE chapter_order > 0)
                  )
             SELECT COUNT(*)::int books,
                    COUNT(*) FILTER (WHERE COALESCE(cache.cached_chapters, 0) > 0)::int cached_books,
                    COUNT(*) FILTER (
                        WHERE latest_books.expected_chapters > 0
                          AND COALESCE(cache.cached_chapters, 0) >= latest_books.expected_chapters
                    )::int complete_books,
                    COALESCE(SUM(cache.cached_chapters), 0)::bigint cached_chapters,
                    (SELECT COUNT(*)::int FROM order_drift)::int order_drift_books,
                    (SELECT COUNT(*)::int
                     FROM chapter_cache
                     WHERE COALESCE(is_volume, false) = false
                       AND (GREATEST(OCTET_LENGTH(COALESCE(html, '')), OCTET_LENGTH(COALESCE(text, ''))) = 0
                            OR GREATEST(OCTET_LENGTH(COALESCE(html, '')), OCTET_LENGTH(COALESCE(text, ''))) > $1))::int abnormal_chapters
             FROM latest_books
             LEFT JOIN cache USING (book_id)`,
            [largeChapterBytes]
        );
        const row = result.rows[0] || {};
        metricsCache = {
            available: true,
            books: rowNumber(row, "books"),
            cached_books: rowNumber(row, "cached_books"),
            complete_books: rowNumber(row, "complete_books"),
            cached_chapters: rowNumber(row, "cached_chapters"),
            order_drift_books: rowNumber(row, "order_drift_books"),
            abnormal_chapters: rowNumber(row, "abnormal_chapters"),
            collected_at: new Date().toISOString()
        };
        metricsCachedAt = Date.now();
        return metricsCache;
    }

    async function collectDataQuality() {
        const staleDays = Math.max(7, Number(process.env.PO18_QUALITY_STALE_DAYS || 180));
        const largeChapterBytes = Math.max(1024, Number(process.env.PO18_QUALITY_LARGE_CHAPTER_BYTES || 1024 * 1024));
        const limit = Math.max(5, Math.min(100, Number(process.env.PO18_QUALITY_SAMPLE_LIMIT || 30)));
        const [
            summary,
            anomalyCounts,
            duplicateBooks,
            missingChapters,
            noCover,
            noDescription,
            platformAbnormal,
            statusAbnormal,
            duplicateOrders,
            staleBooks,
            largeChapters
        ] = await Promise.all([
            query(
                `WITH latest_books AS (${latestBooksSql}),
                      cache AS (
                        SELECT book_id,
                               COUNT(*) FILTER (WHERE COALESCE(is_volume, false) = false)::int cached_chapters,
                               MAX(updated_at) last_cached_at
                        FROM chapter_cache
                        GROUP BY book_id
                      )
                 SELECT COUNT(*)::int books,
                        COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(cover), ''), '') = '')::int no_cover,
                        COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(description), ''), '') = '')::int no_description,
                        COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(platform), ''), '') = '' OR LENGTH(platform) > 40
                            OR NOT EXISTS (SELECT 1 FROM platform_dictionary pd WHERE pd.platform = latest_books.platform AND pd.active))::int platform_abnormal,
                        COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(status), ''), '') = ''
                            OR NOT EXISTS (SELECT 1 FROM book_status_dictionary sd WHERE sd.status = latest_books.status))::int status_abnormal,
                        COUNT(*) FILTER (WHERE expected_chapters_source = 'site_total')::int denominator_site_total,
                        COUNT(*) FILTER (WHERE expected_chapters_source = 'purchasable')::int denominator_purchasable,
                        COUNT(*) FILTER (WHERE expected_chapters_source = 'catalog')::int denominator_catalog,
                        COUNT(*) FILTER (WHERE expected_chapters_source = 'free_plus_paid')::int denominator_free_plus_paid,
                        COUNT(*) FILTER (WHERE expected_chapters_source = 'unknown')::int denominator_unknown,
                        COUNT(*) FILTER (WHERE expected_chapters > COALESCE(cache.cached_chapters, 0))::int missing_chapter_books,
                        COUNT(*) FILTER (WHERE COALESCE(updated_at, created_at, TIMESTAMP 'epoch') < NOW() - ($1::int * INTERVAL '1 day'))::int stale_books,
                        COALESCE(ROUND(AVG(
                          CASE WHEN expected_chapters > 0
                               THEN LEAST(1, COALESCE(cache.cached_chapters, 0)::numeric / GREATEST(expected_chapters, 1))
                               ELSE NULL END
                        ) * 100, 2), 0)::float coverage_percent
                 FROM latest_books
                 LEFT JOIN cache USING (book_id)`,
                [staleDays]
            ),
            query(
                `SELECT
                    (SELECT COUNT(*)::int FROM (
                        SELECT book_id FROM book_metadata GROUP BY book_id HAVING COUNT(*) > 1
                    ) d) duplicate_books,
                    (SELECT COUNT(*)::int FROM (
                        SELECT book_id, chapter_order
                        FROM chapter_cache
                        WHERE COALESCE(is_volume, false) = false AND chapter_order > 0
                        GROUP BY book_id, chapter_order
                        HAVING COUNT(*) > 1
                    ) o) duplicate_order_groups,
                    (SELECT COUNT(*)::int
                     FROM chapter_cache
                     WHERE GREATEST(OCTET_LENGTH(COALESCE(html, '')), OCTET_LENGTH(COALESCE(text, ''))) > $1) large_chapters`,
                [largeChapterBytes]
            ),
            query(
                `SELECT book_id, MAX(title) title, COUNT(*)::int duplicates
                 FROM book_metadata
                 GROUP BY book_id
                 HAVING COUNT(*) > 1
                 ORDER BY duplicates DESC, book_id
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql}),
                      cache AS (
                        SELECT book_id, COUNT(*) FILTER (WHERE COALESCE(is_volume, false) = false)::int cached_chapters
                        FROM chapter_cache
                        GROUP BY book_id
                      )
                 SELECT book_id, title, platform, expected_chapters, expected_chapters_source,
                        COALESCE(cache.cached_chapters, 0)::int cached_chapters,
                        GREATEST(expected_chapters - COALESCE(cache.cached_chapters, 0), 0)::int missing_chapters,
                        CASE WHEN expected_chapters > 0
                             THEN ROUND(COALESCE(cache.cached_chapters, 0)::numeric / GREATEST(expected_chapters, 1) * 100, 2)
                             ELSE 0 END::float coverage_percent
                 FROM latest_books
                 LEFT JOIN cache USING (book_id)
                 WHERE expected_chapters > COALESCE(cache.cached_chapters, 0)
                 ORDER BY missing_chapters DESC, expected_chapters DESC
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql})
                 SELECT book_id, title, platform, updated_at
                 FROM latest_books
                 WHERE COALESCE(NULLIF(TRIM(cover), ''), '') = ''
                 ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql})
                 SELECT book_id, title, platform, updated_at
                 FROM latest_books
                 WHERE COALESCE(NULLIF(TRIM(description), ''), '') = ''
                 ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql})
                 SELECT book_id, title, platform, updated_at
                 FROM latest_books
                 WHERE COALESCE(NULLIF(TRIM(platform), ''), '') = '' OR LENGTH(platform) > 40
                    OR NOT EXISTS (SELECT 1 FROM platform_dictionary pd WHERE pd.platform = latest_books.platform AND pd.active)
                 ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql})
                 SELECT book_id, title, platform, status, updated_at
                 FROM latest_books
                 WHERE COALESCE(NULLIF(TRIM(status), ''), '') = ''
                    OR NOT EXISTS (SELECT 1 FROM book_status_dictionary sd WHERE sd.status = latest_books.status)
                 ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
                 LIMIT $1`,
                [limit]
            ),
            query(
                `SELECT book_id, chapter_order, COUNT(*)::int duplicates
                 FROM chapter_cache
                 WHERE COALESCE(is_volume, false) = false AND chapter_order > 0
                 GROUP BY book_id, chapter_order
                 HAVING COUNT(*) > 1
                 ORDER BY duplicates DESC, book_id, chapter_order
                 LIMIT $1`,
                [limit]
            ),
            query(
                `WITH latest_books AS (${latestBooksSql})
                 SELECT book_id, title, platform, updated_at
                 FROM latest_books
                 WHERE COALESCE(updated_at, created_at, TIMESTAMP 'epoch') < NOW() - ($1::int * INTERVAL '1 day')
                 ORDER BY COALESCE(updated_at, created_at) ASC NULLS FIRST
                 LIMIT $2`,
                [staleDays, limit]
            ),
            query(
                `SELECT book_id, chapter_id, title,
                        GREATEST(OCTET_LENGTH(COALESCE(html, '')), OCTET_LENGTH(COALESCE(text, '')))::int bytes,
                        updated_at
                 FROM chapter_cache
                 WHERE GREATEST(OCTET_LENGTH(COALESCE(html, '')), OCTET_LENGTH(COALESCE(text, ''))) > $1
                 ORDER BY bytes DESC
                 LIMIT $2`,
                [largeChapterBytes, limit]
            )
        ]);
        const s = summary.rows[0] || {};
        const a = anomalyCounts.rows[0] || {};
        return {
            generated_at: new Date().toISOString(),
            thresholds: { stale_days: staleDays, large_chapter_bytes: largeChapterBytes, sample_limit: limit },
            summary: {
                books: rowNumber(s, "books"),
                duplicate_books: rowNumber(a, "duplicate_books"),
                missing_chapter_books: rowNumber(s, "missing_chapter_books"),
                no_cover: rowNumber(s, "no_cover"),
                no_description: rowNumber(s, "no_description"),
                platform_abnormal: rowNumber(s, "platform_abnormal"),
                status_abnormal: rowNumber(s, "status_abnormal"),
                duplicate_order_groups: rowNumber(a, "duplicate_order_groups"),
                stale_books: rowNumber(s, "stale_books"),
                large_chapters: rowNumber(a, "large_chapters"),
                coverage_percent: rowNumber(s, "coverage_percent"),
                completeness_denominator_sources: {
                    site_total: rowNumber(s, "denominator_site_total"),
                    purchasable: rowNumber(s, "denominator_purchasable"),
                    catalog: rowNumber(s, "denominator_catalog"),
                    free_plus_paid: rowNumber(s, "denominator_free_plus_paid"),
                    unknown: rowNumber(s, "denominator_unknown")
                }
            },
            samples: {
                duplicate_books: duplicateBooks.rows,
                missing_chapters: missingChapters.rows,
                no_cover: noCover.rows,
                no_description: noDescription.rows,
                platform_abnormal: platformAbnormal.rows,
                status_abnormal: statusAbnormal.rows,
                duplicate_orders: duplicateOrders.rows,
                stale_books: staleBooks.rows,
                large_chapters: largeChapters.rows
            }
        };
    }

    return {
        collectDataQuality,
        collectDataQualityMetrics
    };
}

module.exports = {
    createDataQualityService,
    latestBooksSql,
    rowNumber
};
