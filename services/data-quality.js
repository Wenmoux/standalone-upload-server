const latestBooksSql = `
    SELECT DISTINCT ON (book_id)
           book_id, title, author, cover, description, platform,
           COALESCE(total_chapters, subscribed_chapters, 0)::int expected_chapters,
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
                        COUNT(*) FILTER (WHERE COALESCE(NULLIF(TRIM(platform), ''), '') = '' OR LENGTH(platform) > 40)::int platform_abnormal,
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
                 SELECT book_id, title, platform, expected_chapters,
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
                duplicate_order_groups: rowNumber(a, "duplicate_order_groups"),
                stale_books: rowNumber(s, "stale_books"),
                large_chapters: rowNumber(a, "large_chapters"),
                coverage_percent: rowNumber(s, "coverage_percent")
            },
            samples: {
                duplicate_books: duplicateBooks.rows,
                missing_chapters: missingChapters.rows,
                no_cover: noCover.rows,
                no_description: noDescription.rows,
                platform_abnormal: platformAbnormal.rows,
                duplicate_orders: duplicateOrders.rows,
                stale_books: staleBooks.rows,
                large_chapters: largeChapters.rows
            }
        };
    }

    return {
        collectDataQuality
    };
}

module.exports = {
    createDataQualityService,
    latestBooksSql,
    rowNumber
};
