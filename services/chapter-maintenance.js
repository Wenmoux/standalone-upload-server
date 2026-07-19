/**
 * [INPUT]: 依赖注入的 PostgreSQL query/事务能力，读取并锁定章节顺序与分卷标记
 * [OUTPUT]: 对外提供全量章节结构预览/批量修复、保留合法顺序缺口的重复顺序整理及同书同名分卷去重维护服务工厂
 * [POS]: services 的章节结构修复用例层，以有序整书锁和集合更新消除重复值，但不把来源分卷缺口压成连续编号
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createChapterMaintenanceService(options = {}) {
    const query = options.query;
    const pool = options.pool;

    function safeLimit(value, fallback = 50, max = 500) {
        const num = Number(value || fallback);
        return Math.max(1, Math.min(max, Number.isFinite(num) ? Math.trunc(num) : fallback));
    }

    function optionalLimit(value) {
        if (value === undefined || value === null || value === "" || value === 0 || value === "0" || value === "all") return null;
        return safeLimit(value);
    }

    function uniqueBookIds(rows = []) {
        return [...new Set(rows.map((row) => String(row.book_id || "").trim()).filter(Boolean))].sort();
    }

    async function lockBooks(client, bookIds) {
        if (!bookIds.length) return;
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('chapter_order:' || target.book_id))
             FROM UNNEST($1::text[]) AS target(book_id)
             ORDER BY target.book_id`,
            [bookIds]
        );
    }

    async function repairDuplicateBookChapterOrders(client, bookIds) {
        if (!bookIds.length) return new Map();
        const staged = await client.query(
            `WITH ranked_duplicates AS (
                 SELECT id, book_id, chapter_id, chapter_order,
                        ROW_NUMBER() OVER (
                            PARTITION BY book_id, chapter_order
                            ORDER BY chapter_id ASC NULLS LAST, id ASC
                        ) AS duplicate_rank
                 FROM chapter_cache
                 WHERE book_id = ANY($1::text[])
                   AND chapter_order > 0
             ), duplicates AS (
                 SELECT id, book_id, chapter_id, chapter_order
                 FROM ranked_duplicates
                 WHERE duplicate_rank > 1
             ), book_max AS (
                 SELECT book_id, MAX(chapter_order)::bigint AS max_order
                 FROM chapter_cache
                 WHERE book_id = ANY($1::text[])
                   AND chapter_order > 0
                 GROUP BY book_id
             ), assignments AS (
                 SELECT duplicate.id,
                        duplicate.book_id,
                        (book_max.max_order + ROW_NUMBER() OVER (
                            PARTITION BY duplicate.book_id
                            ORDER BY duplicate.chapter_order ASC, duplicate.chapter_id ASC NULLS LAST, duplicate.id ASC
                        ))::integer AS next_order
                 FROM duplicates duplicate
                 JOIN book_max USING (book_id)
             ), updated AS (
                 UPDATE chapter_cache chapter
                 SET chapter_order = -assignment.next_order,
                     updated_at = CURRENT_TIMESTAMP
                 FROM assignments assignment
                 WHERE chapter.id = assignment.id
                 RETURNING chapter.book_id
             )
             SELECT book_id, COUNT(*)::int AS updated_chapters
             FROM updated
             GROUP BY book_id`,
            [bookIds]
        );
        await client.query(
            `UPDATE chapter_cache
             SET chapter_order = -chapter_order,
                 updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ANY($1::text[])
               AND chapter_order < 0`,
            [bookIds]
        );
        return new Map(staged.rows.map((row) => [String(row.book_id), Number(row.updated_chapters || 0)]));
    }

    async function previewChapterOrderRepairs({ limit = null } = {}) {
        const targetLimit = optionalLimit(limit);
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
             ${targetLimit ? "LIMIT $1" : ""}`,
            targetLimit ? [targetLimit] : []
        );
        return { rows: rows.rows || [], limit: targetLimit };
    }

    async function repairChapterOrderDuplicates({ limit = null } = {}) {
        const targets = await previewChapterOrderRepairs({ limit });
        const client = await pool.connect();
        const repaired = [];
        let updatedChapters = 0;
        try {
            await client.query("BEGIN");
            const bookIds = uniqueBookIds(targets.rows);
            await lockBooks(client, bookIds);
            const updatesByBook = await repairDuplicateBookChapterOrders(client, bookIds);
            for (const target of targets.rows) {
                const changedChapterCount = updatesByBook.get(String(target.book_id)) || 0;
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

    async function previewDuplicateVolumeCleanup({ limit = null } = {}) {
        const targetLimit = optionalLimit(limit);
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
             ${targetLimit ? "LIMIT $1" : ""}`,
            targetLimit ? [targetLimit] : []
        );
        return { rows: rows.rows || [], limit: targetLimit };
    }

    async function deleteDuplicateVolumes(client, bookIds) {
        if (!bookIds.length) return { rows: [], rowCount: 0 };
        return client.query(
            `WITH ranked_volumes AS (
                 SELECT id,
                        ROW_NUMBER() OVER (
                            PARTITION BY book_id, BTRIM(title)
                            ORDER BY chapter_order ASC NULLS LAST, id ASC
                        ) AS duplicate_rank
                 FROM chapter_cache
                 WHERE book_id = ANY($1::text[])
                   AND COALESCE(is_volume, FALSE) = TRUE
                   AND NULLIF(BTRIM(COALESCE(title, '')), '') IS NOT NULL
             )
             DELETE FROM chapter_cache chapter
             USING ranked_volumes ranked
             WHERE chapter.id = ranked.id
               AND ranked.duplicate_rank > 1
             RETURNING chapter.book_id, chapter.title`,
            [bookIds]
        );
    }

    function buildChangedBooks({ targets = [], removedRows = [], updatesByBook = new Map() } = {}) {
        const targetByBook = new Map();
        for (const target of targets) {
            const bookId = String(target.book_id || "").trim();
            if (!bookId) continue;
            const current = targetByBook.get(bookId) || {};
            targetByBook.set(bookId, {
                ...current,
                ...target,
                book_id: bookId,
                title: target.title || current.title || bookId,
                platform: target.platform || current.platform || ""
            });
        }
        const removedByBook = new Map();
        for (const row of removedRows) {
            const bookId = String(row.book_id || "").trim();
            if (!bookId) continue;
            const current = removedByBook.get(bookId) || { count: 0, titles: new Set() };
            current.count += 1;
            const title = String(row.title || "").trim();
            if (title) current.titles.add(title);
            removedByBook.set(bookId, current);
        }
        return [...new Set([...targetByBook.keys(), ...removedByBook.keys(), ...updatesByBook.keys()])]
            .map((bookId) => {
                const target = targetByBook.get(bookId) || {};
                const removed = removedByBook.get(bookId) || { count: 0, titles: new Set() };
                return {
                    book_id: bookId,
                    title: target.title || bookId,
                    platform: target.platform || "",
                    removed_volumes: removed.count,
                    removed_titles: [...removed.titles],
                    updated_chapters: updatesByBook.get(bookId) || 0
                };
            })
            .filter((row) => row.removed_volumes > 0 || row.updated_chapters > 0)
            .sort(
                (left, right) =>
                    right.removed_volumes - left.removed_volumes ||
                    right.updated_chapters - left.updated_chapters ||
                    left.book_id.localeCompare(right.book_id)
            );
    }

    async function cleanupDuplicateVolumes({ limit = null } = {}) {
        const targets = await previewDuplicateVolumeCleanup({ limit });
        if (!targets.rows.length) {
            return { success: true, scannedBooks: 0, changedBookCount: 0, removedVolumes: 0, changedBooks: [] };
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const bookIds = uniqueBookIds(targets.rows);
            await lockBooks(client, bookIds);
            const removed = await deleteDuplicateVolumes(client, bookIds);
            const updatesByBook = await repairDuplicateBookChapterOrders(client, bookIds);
            await client.query("COMMIT");
            const changedBooks = buildChangedBooks({ targets: targets.rows, removedRows: removed.rows, updatesByBook });
            return {
                success: true,
                scannedBooks: targets.rows.length,
                changedBookCount: changedBooks.length,
                removedVolumes: removed.rowCount,
                changedBooks
            };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async function previewChapterStructureRepairs({ limit = null } = {}) {
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
            orderBooks: orderPreview.rows.length,
            duplicateVolumeBooks: volumePreview.rows.length,
            affectedChapters: orderPreview.rows.reduce((total, row) => total + Number(row.affected_chapters || 0), 0),
            duplicateVolumes: volumePreview.rows.reduce((total, row) => total + Number(row.duplicate_volumes || 0), 0),
            limit: optionalLimit(limit),
            complete: optionalLimit(limit) === null
        };
    }

    async function repairChapterStructure({ limit = null } = {}) {
        const preview = await previewChapterStructureRepairs({ limit });
        const bookIds = uniqueBookIds([...preview.orderRows, ...preview.duplicateVolumeRows]);
        if (!bookIds.length) {
            return {
                success: true,
                scannedBooks: 0,
                changedBookCount: 0,
                removedVolumes: 0,
                repairedBooks: 0,
                updatedChapters: 0,
                changedBooks: []
            };
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await lockBooks(client, bookIds);
            const volumeBookIds = uniqueBookIds(preview.duplicateVolumeRows);
            const removed = await deleteDuplicateVolumes(client, volumeBookIds);
            const updatesByBook = await repairDuplicateBookChapterOrders(client, bookIds);
            await client.query("COMMIT");
            const changedBooks = buildChangedBooks({
                targets: [...preview.duplicateVolumeRows, ...preview.orderRows],
                removedRows: removed.rows,
                updatesByBook
            });
            return {
                success: true,
                scannedBooks: bookIds.length,
                changedBookCount: changedBooks.length,
                removedVolumes: removed.rowCount,
                repairedBooks: [...updatesByBook.values()].filter((count) => count > 0).length,
                updatedChapters: [...updatesByBook.values()].reduce((total, count) => total + count, 0),
                changedBooks
            };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
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
