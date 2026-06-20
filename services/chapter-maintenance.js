function createChapterMaintenanceService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const chapterListOrderSql = options.chapterListOrderSql || (() => "chapter_order ASC, id ASC");

    function safeLimit(value, fallback = 50, max = 500) {
        const num = Number(value || fallback);
        return Math.max(1, Math.min(max, Number.isFinite(num) ? Math.trunc(num) : fallback));
    }

    async function previewChapterOrderRepairs({ limit = 50 } = {}) {
        const rows = await query(
            `WITH duplicate_groups AS (
                 SELECT book_id, COALESCE(NULLIF(platform, ''), 'po18') AS platform, chapter_order, COUNT(*)::int duplicates
                 FROM chapter_cache
                 WHERE chapter_order > 0
                 GROUP BY book_id, COALESCE(NULLIF(platform, ''), 'po18'), chapter_order
                 HAVING COUNT(*) > 1
             )
             SELECT dg.book_id, dg.platform,
                    COUNT(*)::int duplicate_order_groups,
                    SUM(dg.duplicates)::int affected_chapters,
                    COALESCE(m.title, dg.book_id) AS title
             FROM duplicate_groups dg
             LEFT JOIN LATERAL (
                 SELECT title
                 FROM book_metadata m
                 WHERE m.book_id = dg.book_id
                 ORDER BY COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1
             ) m ON TRUE
             GROUP BY dg.book_id, dg.platform, m.title
             ORDER BY affected_chapters DESC, duplicate_order_groups DESC, dg.book_id ASC
             LIMIT $1`,
            [safeLimit(limit)]
        );
        return { rows: rows.rows || [], limit: safeLimit(limit) };
    }

    async function repairChapterOrderDuplicates({ limit = 50 } = {}) {
        const targets = await previewChapterOrderRepairs({ limit });
        const client = await pool.connect();
        const repaired = [];
        let updatedChapters = 0;
        try {
            await client.query("BEGIN");
            for (const target of targets.rows) {
                const chapters = await client.query(
                    `SELECT id, book_id, chapter_id, title, chapter_order, platform
                     FROM chapter_cache
                     WHERE book_id = $1 AND COALESCE(NULLIF(platform, ''), 'po18') = $2
                     ORDER BY ${chapterListOrderSql("$2")}
                     FOR UPDATE`,
                    [target.book_id, target.platform]
                );
                let changed = 0;
                for (const [index, chapter] of chapters.rows.entries()) {
                    const nextOrder = index + 1;
                    if (Number(chapter.chapter_order || 0) === nextOrder) continue;
                    await client.query(
                        "UPDATE chapter_cache SET chapter_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [nextOrder, chapter.id]
                    );
                    changed += 1;
                    updatedChapters += 1;
                }
                repaired.push({
                    book_id: target.book_id,
                    title: target.title || target.book_id,
                    platform: target.platform,
                    duplicate_order_groups: target.duplicate_order_groups,
                    affected_chapters: target.affected_chapters,
                    updated_chapters: changed
                });
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
        return {
            success: true,
            scannedBooks: targets.rows.length,
            repairedBooks: repaired.filter((item) => item.updated_chapters > 0).length,
            updatedChapters,
            rows: repaired
        };
    }

    return {
        previewChapterOrderRepairs,
        repairChapterOrderDuplicates
    };
}

module.exports = {
    createChapterMaintenanceService
};
