const express = require("express");

const STALE_PO18_BOOK_PLATFORM = "po18";
const STALE_PO18_BOOK_CUTOFF = "2025-01-01";
const STALE_PO18_BOOK_MAX_CHAPTER_COUNT = 10;
const STALE_PO18_BOOK_CHAPTER_COUNT_SQL = "GREATEST(COALESCE(total_chapters, 0), COALESCE(subscribed_chapters, 0), COALESCE(chapter_count, 0))";
const STALE_PO18_BOOK_SOURCE_DATE_SQL = "CASE WHEN TRIM(COALESCE(latest_chapter_date, '')) ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}' THEN regexp_replace(TRIM(latest_chapter_date), '^([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2}).*$', '\\1-\\2-\\3')::date ELSE NULL END";
const STALE_PO18_BOOK_WHERE = `LOWER(TRIM(COALESCE(platform, ''))) = $1 AND ${STALE_PO18_BOOK_SOURCE_DATE_SQL} < $2::date AND ${STALE_PO18_BOOK_CHAPTER_COUNT_SQL} < $3`;

async function stalePo18BooksPreview(query) {
    const params = [STALE_PO18_BOOK_PLATFORM, STALE_PO18_BOOK_CUTOFF, STALE_PO18_BOOK_MAX_CHAPTER_COUNT];
    const summary = await query(
        `WITH targets AS (
             SELECT id, book_id
             FROM book_metadata
             WHERE ${STALE_PO18_BOOK_WHERE}
         )
         SELECT
             COUNT(*)::int metadata_count,
             COUNT(DISTINCT book_id)::int book_count,
             (
                SELECT COUNT(*)::int
                FROM chapter_cache c
                WHERE c.book_id IN (SELECT DISTINCT book_id FROM targets)
                  AND LOWER(TRIM(COALESCE(NULLIF(c.platform, ''), 'po18'))) = $1
             ) chapter_count
         FROM targets`,
        params
    );
    const sample = await query(
        `SELECT id, book_id, title, platform, word_count, total_chapters, subscribed_chapters, chapter_count,
                ${STALE_PO18_BOOK_CHAPTER_COUNT_SQL} AS metadata_chapter_count,
                latest_chapter_date,
                to_char(${STALE_PO18_BOOK_SOURCE_DATE_SQL}, 'YYYY-MM-DD') AS source_update_date,
                updated_at, created_at
         FROM book_metadata
         WHERE ${STALE_PO18_BOOK_WHERE}
         ORDER BY ${STALE_PO18_BOOK_SOURCE_DATE_SQL} ASC, id ASC
         LIMIT 20`,
        params
    );
    const row = summary.rows[0] || {};
    return {
        platform: STALE_PO18_BOOK_PLATFORM,
        cutoff: STALE_PO18_BOOK_CUTOFF,
        maxChapterCount: STALE_PO18_BOOK_MAX_CHAPTER_COUNT,
        metadataCount: Number(row.metadata_count || 0),
        bookCount: Number(row.book_count || 0),
        chapterCount: Number(row.chapter_count || 0),
        sample: sample.rows
    };
}

async function cleanupStalePo18Books({ pool, recordEvent, req }) {
    const client = await pool.connect();
    let payload;
    try {
        await client.query("BEGIN");
        const params = [STALE_PO18_BOOK_PLATFORM, STALE_PO18_BOOK_CUTOFF, STALE_PO18_BOOK_MAX_CHAPTER_COUNT];
        const targets = await client.query(
            `SELECT id, book_id, title, platform, word_count, total_chapters, subscribed_chapters, chapter_count,
                    ${STALE_PO18_BOOK_CHAPTER_COUNT_SQL} AS metadata_chapter_count,
                    latest_chapter_date,
                    to_char(${STALE_PO18_BOOK_SOURCE_DATE_SQL}, 'YYYY-MM-DD') AS source_update_date,
                    updated_at, created_at
             FROM book_metadata
             WHERE ${STALE_PO18_BOOK_WHERE}
             ORDER BY ${STALE_PO18_BOOK_SOURCE_DATE_SQL} ASC, id ASC`,
            params
        );
        const metadataIds = targets.rows.map((row) => String(row.id)).filter(Boolean);
        const bookIds = [...new Set(targets.rows.map((row) => String(row.book_id || "").trim()).filter(Boolean))];

        let deletedChapters = 0;
        let deletedMetadata = 0;
        if (bookIds.length) {
            const chapters = await client.query(
                "DELETE FROM chapter_cache WHERE book_id = ANY($1::text[]) AND LOWER(TRIM(COALESCE(NULLIF(platform, ''), 'po18'))) = $2",
                [bookIds, STALE_PO18_BOOK_PLATFORM]
            );
            deletedChapters = chapters.rowCount;
        }
        if (metadataIds.length) {
            const metadata = await client.query("DELETE FROM book_metadata WHERE id = ANY($1::bigint[])", [metadataIds]);
            deletedMetadata = metadata.rowCount;
        }
        await client.query("COMMIT");
        payload = {
            success: true,
            platform: STALE_PO18_BOOK_PLATFORM,
            cutoff: STALE_PO18_BOOK_CUTOFF,
            maxChapterCount: STALE_PO18_BOOK_MAX_CHAPTER_COUNT,
            metadataCount: metadataIds.length,
            bookCount: bookIds.length,
            deletedMetadata,
            deletedChapters,
            sample: targets.rows.slice(0, 20)
        };
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    await recordEvent({
        eventType: "metadata",
        action: "admin_cleanup_stale",
        source: "admin",
        uploader: req.session.adminUser?.username || "admin",
        details: payload
    }).catch((err) => console.warn(`[cleanup-stale] record event failed: ${err.message}`));
    return payload;
}

function createAdminMaintenanceRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireAdmin,
        query,
        pool,
        recordEvent,
        stalePo18BooksPreview: maintenanceStalePo18BooksPreview,
        cleanupStalePo18Books: maintenanceCleanupStalePo18Books,
        previewChapterOrderRepairs,
        repairChapterOrderDuplicates,
        runTrackedJob
    } = deps;

    router.get("/admin-api/books/cleanup-stale/preview", requireAdmin, async (req, res, next) => {
        try {
            const preview = maintenanceStalePo18BooksPreview || (() => stalePo18BooksPreview(query));
            res.json(await preview());
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/books/cleanup-stale", requireAdmin, async (req, res, next) => {
        if (req.body?.confirm !== true) return res.status(400).json({ error: "missing confirm" });
        try {
            const input = {
                platform: STALE_PO18_BOOK_PLATFORM,
                cutoff: STALE_PO18_BOOK_CUTOFF,
                maxChapterCount: STALE_PO18_BOOK_MAX_CHAPTER_COUNT
            };
            const worker = maintenanceCleanupStalePo18Books
                ? () => maintenanceCleanupStalePo18Books({ actor: req.session.adminUser?.username || "admin" })
                : () => cleanupStalePo18Books({ pool, recordEvent, req });
            const payload = typeof runTrackedJob === "function"
                ? await runTrackedJob(req, "books_cleanup_stale", input, worker)
                : await worker();
            res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/chapters/repair-order/preview", requireAdmin, async (req, res, next) => {
        try {
            if (typeof previewChapterOrderRepairs !== "function") return res.status(503).json({ error: "chapter order repair unavailable" });
            res.json(await previewChapterOrderRepairs({ limit: req.query.limit }));
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/chapters/repair-order", requireAdmin, async (req, res, next) => {
        if (req.body?.confirm !== true) return res.status(400).json({ error: "missing confirm" });
        try {
            if (typeof repairChapterOrderDuplicates !== "function") return res.status(503).json({ error: "chapter order repair unavailable" });
            const limit = Math.max(1, Math.min(500, Number(req.body?.limit || 50)));
            const input = { limit };
            const worker = () => repairChapterOrderDuplicates(input);
            const payload = typeof runTrackedJob === "function"
                ? await runTrackedJob(req, "chapters_repair_order", input, worker)
                : await worker();
            res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    createAdminMaintenanceRoutes,
    stalePo18BooksPreview,
    cleanupStalePo18Books
};
