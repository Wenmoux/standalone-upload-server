/**
 * [INPUT]: 依赖注入的 PostgreSQL query/事务能力，读取并锁定章节顺序与分卷标记
 * [OUTPUT]: 对外提供章节结构预览/修复、重复顺序整理及同书同名分卷去重的维护服务工厂
 * [POS]: services 的章节结构修复用例层，以整书锁定先去除重复分卷再连续重排章节，并保留独立兼容能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createChapterMaintenanceService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const chapterListOrderSql = options.chapterListOrderSql || (() => "chapter_order ASC, id ASC");

    function safeLimit(value, fallback = 50, max = 500) {
        const num = Number(value || fallback);
        return Math.max(1, Math.min(max, Number.isFinite(num) ? Math.trunc(num) : fallback));
    }

    async function normalizeBookChapterOrder(client, bookId) {
        const chapters = await client.query(
            `SELECT id, book_id, chapter_id, title, chapter_order, platform
             FROM chapter_cache
             WHERE book_id = $1
             ORDER BY ${chapterListOrderSql()}
             FOR UPDATE`,
            [bookId]
        );
        const changes = chapters.rows.flatMap((chapter, index) => {
            const nextOrder = index + 1;
            return Number(chapter.chapter_order || 0) === nextOrder ? [] : [{ id: chapter.id, nextOrder }];
        });
        for (const change of changes) {
            await client.query("UPDATE chapter_cache SET chapter_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [
                -change.nextOrder,
                change.id
            ]);
        }
        for (const change of changes) {
            await client.query("UPDATE chapter_cache SET chapter_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [
                change.nextOrder,
                change.id
            ]);
        }
        return changes.length;
    }

    async function previewChapterOrderRepairs({ limit = 50 } = {}) {
        const rows = await query(
            `WITH duplicate_groups AS (
                 SELECT book_id, chapter_order, COUNT(*)::int duplicates,
                        MIN(COALESCE(NULLIF(platform, ''), 'po18')) AS platform
                 FROM chapter_cache
                 WHERE chapter_order > 0
                 GROUP BY book_id, chapter_order
                 HAVING COUNT(*) > 1
             )
             SELECT dg.book_id, MIN(dg.platform) AS platform,
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
             GROUP BY dg.book_id, m.title
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
                await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`chapter_order:${target.book_id}`]);
                const changedChapterCount = await normalizeBookChapterOrder(client, target.book_id);
                updatedChapters += changedChapterCount;
                repaired.push({
                    book_id: target.book_id,
                    title: target.title || target.book_id,
                    platform: target.platform,
                    duplicate_order_groups: target.duplicate_order_groups,
                    affected_chapters: target.affected_chapters,
                    updated_chapters: changedChapterCount
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

    async function previewDuplicateVolumeCleanup({ limit = 50 } = {}) {
        const safe = safeLimit(limit);
        const rows = await query(
            `WITH ranked_volumes AS (
                 SELECT id, book_id, BTRIM(title) AS volume_name,
                        COALESCE(NULLIF(platform, ''), 'po18') AS platform,
                        ROW_NUMBER() OVER (
                            PARTITION BY book_id, BTRIM(title)
                            ORDER BY chapter_order ASC NULLS LAST, id ASC
                        ) AS duplicate_rank
                 FROM chapter_cache
                 WHERE COALESCE(is_volume, FALSE) = TRUE
                   AND NULLIF(BTRIM(COALESCE(title, '')), '') IS NOT NULL
             ), duplicate_volumes AS (
                 SELECT book_id, volume_name, platform
                 FROM ranked_volumes
                 WHERE duplicate_rank > 1
             )
             SELECT duplicate.book_id,
                    COALESCE(metadata.title, duplicate.book_id) AS title,
                    MIN(duplicate.platform) AS platform,
                    COUNT(*)::int AS duplicate_volumes,
                    ARRAY_AGG(DISTINCT duplicate.volume_name ORDER BY duplicate.volume_name) AS duplicate_titles
             FROM duplicate_volumes duplicate
             LEFT JOIN LATERAL (
                 SELECT row.title
                 FROM book_metadata row
                 WHERE row.book_id = duplicate.book_id
                 ORDER BY COALESCE(row.updated_at, row.created_at) DESC, row.id DESC
                 LIMIT 1
             ) metadata ON TRUE
             GROUP BY duplicate.book_id, metadata.title
             ORDER BY duplicate_volumes DESC, duplicate.book_id ASC
             LIMIT $1`,
            [safe]
        );
        return { rows: rows.rows || [], limit: safe };
    }

    async function cleanupDuplicateVolumes({ limit = 50 } = {}) {
        const targets = await previewDuplicateVolumeCleanup({ limit });
        if (!targets.rows.length) {
            return { success: true, scannedBooks: 0, changedBookCount: 0, removedVolumes: 0, changedBooks: [] };
        }

        const client = await pool.connect();
        const changedBooks = [];
        let removedVolumes = 0;
        try {
            await client.query("BEGIN");
            for (const target of targets.rows) {
                await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`chapter_order:${target.book_id}`]);
                const removed = await client.query(
                    `WITH ranked_volumes AS (
                         SELECT id,
                                ROW_NUMBER() OVER (
                                    PARTITION BY BTRIM(title)
                                    ORDER BY chapter_order ASC NULLS LAST, id ASC
                                ) AS duplicate_rank
                         FROM chapter_cache
                         WHERE book_id = $1
                           AND COALESCE(is_volume, FALSE) = TRUE
                           AND NULLIF(BTRIM(COALESCE(title, '')), '') IS NOT NULL
                     )
                     DELETE FROM chapter_cache chapter
                     USING ranked_volumes ranked
                     WHERE chapter.id = ranked.id
                       AND ranked.duplicate_rank > 1
                     RETURNING chapter.title`,
                    [target.book_id]
                );
                if (!removed.rowCount) continue;
                const removedTitles = [...new Set(removed.rows.map((row) => String(row.title || "").trim()).filter(Boolean))];
                const updatedChapters = await normalizeBookChapterOrder(client, target.book_id);
                removedVolumes += removed.rowCount;
                changedBooks.push({
                    book_id: target.book_id,
                    title: target.title || target.book_id,
                    platform: target.platform || "",
                    removed_volumes: removed.rowCount,
                    removed_titles: removedTitles,
                    updated_chapters: updatedChapters
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
            changedBookCount: changedBooks.length,
            removedVolumes,
            changedBooks
        };
    }

    async function previewChapterStructureRepairs({ limit = 50 } = {}) {
        const [orderPreview, volumePreview] = await Promise.all([
            previewChapterOrderRepairs({ limit }),
            previewDuplicateVolumeCleanup({ limit })
        ]);
        const affectedBookIds = new Set([
            ...orderPreview.rows.map((row) => String(row.book_id || "")).filter(Boolean),
            ...volumePreview.rows.map((row) => String(row.book_id || "")).filter(Boolean)
        ]);
        return {
            rows: orderPreview.rows,
            orderRows: orderPreview.rows,
            duplicateVolumeRows: volumePreview.rows,
            affectedBooks: affectedBookIds.size,
            affectedChapters: orderPreview.rows.reduce((total, row) => total + Number(row.affected_chapters || 0), 0),
            duplicateVolumes: volumePreview.rows.reduce((total, row) => total + Number(row.duplicate_volumes || 0), 0),
            limit: safeLimit(limit)
        };
    }

    async function repairChapterStructure({ limit = 50 } = {}) {
        const volumeCleanup = await cleanupDuplicateVolumes({ limit });
        const orderRepair = await repairChapterOrderDuplicates({ limit });
        return {
            success: true,
            changedBookCount: volumeCleanup.changedBookCount,
            removedVolumes: volumeCleanup.removedVolumes,
            changedBooks: volumeCleanup.changedBooks,
            repairedBooks: orderRepair.repairedBooks,
            updatedChapters:
                orderRepair.updatedChapters +
                volumeCleanup.changedBooks.reduce((total, row) => total + Number(row.updated_chapters || 0), 0),
            volumeCleanup,
            orderRepair
        };
    }

    return {
        previewChapterOrderRepairs,
        repairChapterOrderDuplicates,
        previewDuplicateVolumeCleanup,
        cleanupDuplicateVolumes,
        previewChapterStructureRepairs,
        repairChapterStructure
    };
}

module.exports = {
    createChapterMaintenanceService
};
