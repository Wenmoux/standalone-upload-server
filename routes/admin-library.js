const express = require("express");

function createAdminLibraryRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireAdmin,
        query,
        isCacheCountSort,
        bookOrder,
        logSlowSearch,
        slowSearchContext,
        upsertBook,
        cleanPatch,
        bookColumns,
        numericBookFields,
        updateSql,
        cleanPgText,
        recordEvent,
        safeTxtFilename,
        buildBookTxt,
        chapterListOrderSql,
        latestBookMetadata,
        chapterColumns,
        numericChapterFields,
        saveChapter
    } = deps;
    const sendCsv = deps.sendCsv || ((res, filename, rows, columns) => res.json({ filename, rows, columns }));

    router.get("/admin-api/books", requireAdmin, async (req, res, next) => {
        const startedAt = Date.now();
        try {
            const page = Math.max(1, Number(req.query.page || 1));
            const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
            const offset = (page - 1) * limit;
            const sort = String(req.query.sort || "updated_desc");
            const needsStatsSort = isCacheCountSort(sort);
            const pageOrder = needsStatsSort ? bookOrder(sort, "m", "cc") : bookOrder(sort);
            const finalOrder = needsStatsSort ? bookOrder(sort, "m", "bs") : bookOrder(sort);
            const where = [];
            const params = [];
            if (req.query.q) {
                params.push(`%${String(req.query.q).trim()}%`);
                where.push(`(m.book_id ILIKE $${params.length} OR m.title ILIKE $${params.length} OR m.author ILIKE $${params.length} OR m.tags ILIKE $${params.length})`);
            }
            if (req.query.tag) {
                params.push(`%${String(req.query.tag).trim()}%`);
                where.push(`m.tags ILIKE $${params.length}`);
            }
            if (req.query.platform) {
                params.push(String(req.query.platform));
                where.push(`m.platform = $${params.length}`);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const total = await query(`SELECT COUNT(*)::int count FROM book_metadata m ${whereSql}`, params);
            const limitIndex = params.length + 1;
            const offsetIndex = params.length + 2;
            const dataParams = [...params, limit, offset];
            const rows = needsStatsSort
                ? await query(
                      `WITH ranked AS (
                           SELECT m.*, COALESCE(cc.cache_count, 0)::int cache_count
                           FROM book_metadata m
                           LEFT JOIN book_stats cc ON cc.book_id = m.book_id
                           ${whereSql}
                           ORDER BY ${pageOrder}
                           LIMIT $${limitIndex} OFFSET $${offsetIndex}
                       )
                       SELECT m.*,
                              COALESCE(bs.like_count, 0)::int like_count,
                              COALESCE(bs.dislike_count, 0)::int dislike_count
                       FROM ranked m
                       LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                       ORDER BY ${finalOrder}`,
                      dataParams
                  )
                : await query(
                      `WITH page_books AS (
                           SELECT m.*
                           FROM book_metadata m
                           ${whereSql}
                           ORDER BY ${pageOrder}
                           LIMIT $${limitIndex} OFFSET $${offsetIndex}
                       )
                       SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count,
                              COALESCE(bs.like_count, 0)::int like_count,
                              COALESCE(bs.dislike_count, 0)::int dislike_count
                       FROM page_books m
                       LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                       ORDER BY ${finalOrder}`,
                      dataParams
                  );
            const totalCount = Number(total.rows[0]?.count || 0);
            const payload = { rows: rows.rows, total: totalCount, page, limit, sort };
            logSlowSearch("admin-api/books", startedAt, slowSearchContext(req, { total: totalCount, rows: rows.rows.length }));
            res.json(payload);
        } catch (err) {
            logSlowSearch("admin-api/books:error", startedAt, slowSearchContext(req, { error: err.message || String(err) }));
            next(err);
        }
    });

    router.get("/admin-api/books/export.csv", requireAdmin, async (req, res, next) => {
        try {
            const sort = String(req.query.sort || "updated_desc");
            const order = bookOrder(sort, "m", "bs");
            const where = [];
            const params = [];
            if (req.query.q) {
                params.push(`%${String(req.query.q).trim()}%`);
                where.push(`(m.book_id ILIKE $${params.length} OR m.title ILIKE $${params.length} OR m.author ILIKE $${params.length} OR m.tags ILIKE $${params.length})`);
            }
            if (req.query.tag) {
                params.push(`%${String(req.query.tag).trim()}%`);
                where.push(`m.tags ILIKE $${params.length}`);
            }
            if (req.query.platform) {
                params.push(String(req.query.platform));
                where.push(`m.platform = $${params.length}`);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const rows = await query(
                `SELECT m.book_id, m.title, m.author, m.platform, m.tags, m.category, m.status,
                        m.word_count, m.total_chapters, m.subscribed_chapters, m.free_chapters, m.paid_chapters,
                        COALESCE(bs.cache_count, 0)::int cache_count,
                        COALESCE(bs.like_count, 0)::int like_count,
                        COALESCE(bs.dislike_count, 0)::int dislike_count,
                        m.total_popularity, m.latest_chapter_name, m.latest_chapter_date, m.detail_url,
                        m.created_at, m.updated_at
                 FROM book_metadata m
                 LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                 ${whereSql}
                 ORDER BY ${order}
                 LIMIT 10000`,
                params
            );
            sendCsv(res, `po18-books-${new Date().toISOString().slice(0, 10)}.csv`, rows.rows, [
                { key: "book_id", label: "book_id" },
                { key: "title", label: "title" },
                { key: "author", label: "author" },
                { key: "platform", label: "platform" },
                { key: "tags", label: "tags" },
                { key: "category", label: "category" },
                { key: "status", label: "status" },
                { key: "word_count", label: "word_count" },
                { key: "total_chapters", label: "total_chapters" },
                { key: "subscribed_chapters", label: "subscribed_chapters" },
                { key: "free_chapters", label: "free_chapters" },
                { key: "paid_chapters", label: "paid_chapters" },
                { key: "cache_count", label: "cache_count" },
                { key: "like_count", label: "like_count" },
                { key: "dislike_count", label: "dislike_count" },
                { key: "total_popularity", label: "total_popularity" },
                { key: "latest_chapter_name", label: "latest_chapter_name" },
                { key: "latest_chapter_date", label: "latest_chapter_date" },
                { key: "detail_url", label: "detail_url" },
                { key: "created_at", label: "created_at" },
                { key: "updated_at", label: "updated_at" }
            ]);
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/books", requireAdmin, async (req, res, next) => {
        try {
            if (!req.body?.book_id && !req.body?.bookId) return res.status(400).json({ error: "missing book_id" });
            await upsertBook(req.body);
            const result = await query(
                `SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count
                 FROM book_metadata m
                 LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                 WHERE m.book_id = $1
                 ORDER BY m.id DESC
                 LIMIT 1`,
                [String(req.body.book_id || req.body.bookId)]
            );
            res.json({ success: true, book: result.rows[0] || null });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/books/:id", requireAdmin, async (req, res, next) => {
        try {
            const before = await query("SELECT * FROM book_metadata WHERE id = $1", [req.params.id]);
            const oldBook = before.rows[0];
            if (!oldBook) return res.status(404).json({ error: "book not found" });

            const patch = cleanPatch(req.body, bookColumns, numericBookFields);
            if (!Object.keys(patch).length) return res.status(400).json({ error: "empty update" });
            const stmt = updateSql("book_metadata", patch, `id = $${Object.keys(patch).length + 1}`, [req.params.id]);
            const updated = await query(stmt.sql, stmt.params);
            const book = updated.rows[0];

            if (patch.book_id && patch.book_id !== oldBook.book_id) {
                await query("UPDATE chapter_cache SET book_id = $1, updated_at = CURRENT_TIMESTAMP WHERE book_id = $2", [cleanPgText(String(patch.book_id)), cleanPgText(oldBook.book_id)]);
            }
            await recordEvent({
                eventType: "metadata",
                action: "admin_update",
                bookId: book.book_id,
                title: book.title,
                platform: book.platform,
                source: "admin",
                uploader: book.uploader,
                uploaderId: book.uploaderId,
                details: { id: book.id, changed: Object.keys(patch) }
            });
            res.json({ success: true, book });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/books/:id", requireAdmin, async (req, res, next) => {
        try {
            const found = await query("SELECT * FROM book_metadata WHERE id = $1", [req.params.id]);
            const book = found.rows[0];
            if (!book) return res.status(404).json({ error: "book not found" });
            const modeInput = String(req.query.deleteMode || "").trim().toLowerCase();
            const modeMap = {
                "1": "metadata",
                "metadata": "metadata",
                "meta": "metadata",
                "2": "cache",
                "cache": "cache",
                "chapters": "cache",
                "chapter_cache": "cache",
                "3": "all",
                "all": "all"
            };
            if (modeInput && !modeMap[modeInput]) return res.status(400).json({ error: "invalid deleteMode" });
            const deleteMode = modeMap[modeInput] || (String(req.query.deleteChapters || "0") === "1" ? "all" : "metadata");
            let deletedChapters = 0;
            let deletedMetadata = 0;
            if (deleteMode === "cache" || deleteMode === "all") {
                const chapters = await query("DELETE FROM chapter_cache WHERE book_id = $1", [book.book_id]);
                deletedChapters = chapters.rowCount;
            }
            if (deleteMode === "metadata" || deleteMode === "all") {
                const deleted = await query("DELETE FROM book_metadata WHERE id = $1", [req.params.id]);
                deletedMetadata = deleted.rowCount;
            }
            await recordEvent({
                eventType: deleteMode === "cache" ? "chapter" : "metadata",
                action: deleteMode === "cache" ? "admin_delete_book_chapters" : "admin_delete",
                bookId: book.book_id,
                title: book.title,
                platform: book.platform,
                source: "admin",
                uploader: req.session.adminUser?.username || book.uploader,
                uploaderId: req.session.adminUser?.username || book.uploaderId,
                details: { id: book.id, deleteMode, deletedMetadata, deletedChapters }
            });
            res.json({ success: true, mode: deleteMode, deleted: deletedMetadata, deletedMetadata, deletedChapters });
        } catch (err) {
            next(err);
        }
    });


    router.get("/admin-api/books/:bookId/export.txt", requireAdmin, async (req, res, next) => {
        try {
            const bookId = String(req.params.bookId || "").trim();
            if (!bookId) return res.status(400).json({ error: "missing book_id" });

            const [bookResult, chapterResult] = await Promise.all([
                query(
                    `SELECT *
                     FROM book_metadata
                     WHERE book_id = $1
                     ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                     LIMIT 1`,
                    [bookId]
                ),
                query(
                    `WITH book_platform AS (
                        SELECT platform
                        FROM book_metadata
                        WHERE book_id = $1
                        ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                        LIMIT 1
                     )
                     SELECT *
                     FROM chapter_cache
                     WHERE book_id = $1
                     ORDER BY ${chapterListOrderSql("(SELECT platform FROM book_platform)")}`,
                    [bookId]
                )
            ]);
            const book = bookResult.rows[0] || { book_id: bookId, title: bookId };
            const chapters = chapterResult.rows || [];
            if (!bookResult.rows.length && !chapters.length) return res.status(404).json({ error: "book not found" });

            const filename = `${safeTxtFilename(book.title || book.book_id || bookId)}.txt`;
            const fallbackName = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
            res.send(`\ufeff${buildBookTxt(book, chapters)}`);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/books/:bookId/chapters", requireAdmin, async (req, res, next) => {
        try {
            const rows = await query(
                `WITH book_platform AS (
                    SELECT platform
                    FROM book_metadata
                    WHERE book_id = $1
                    ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                    LIMIT 1
                 )
                 SELECT *
                 FROM chapter_cache
                 WHERE book_id = $1
                 ORDER BY ${chapterListOrderSql("(SELECT platform FROM book_platform)")}`,
                [req.params.bookId]
            );
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/books/:bookId/chapters", requireAdmin, async (req, res, next) => {
        try {
            const bookId = String(req.params.bookId || "").trim();
            if (!bookId) return res.status(400).json({ error: "missing book_id" });
            const book = await latestBookMetadata(bookId);
            const deleted = await query("DELETE FROM chapter_cache WHERE book_id = $1", [bookId]);
            await recordEvent({
                eventType: "chapter",
                action: "admin_delete_book_chapters",
                bookId,
                title: book?.title || "",
                platform: book?.platform || "",
                source: "admin",
                uploader: req.session.adminUser?.username || "admin",
                uploaderId: req.session.adminUser?.username || "admin",
                details: { deletedChapters: deleted.rowCount }
            });
            res.json({ success: true, deleted: deleted.rowCount, deletedChapters: deleted.rowCount });
        } catch (err) {
            next(err);
        }
    });


    router.post("/admin-api/chapters", requireAdmin, async (req, res, next) => {
        try {
            const bookId = String(req.body?.book_id || req.body?.bookId || "").trim();
            const chapterId = String(req.body?.chapter_id || req.body?.chapterId || "").trim();
            if (!bookId) return res.status(400).json({ error: "missing book_id" });
            if (!chapterId) return res.status(400).json({ error: "missing chapter_id" });

            const payload = {
                ...req.body,
                bookId,
                chapterId,
                title: req.body?.title || "",
                html: req.body?.html || "",
                text: req.body?.text || "",
                platform: req.body?.platform || "po18",
                uploader: req.body?.uploader || req.session.adminUser?.username || "admin",
                uploaderId: req.body?.uploaderId || req.session.adminUser?.username || "admin"
            };

            await saveChapter(payload);
            const result = await query(
                "SELECT * FROM chapter_cache WHERE book_id = $1 AND chapter_id = $2 LIMIT 1",
                [bookId, chapterId]
            );
            res.json({ success: true, chapter: result.rows[0] || null });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/chapters/:id", requireAdmin, async (req, res, next) => {
        try {
            const found = await query("SELECT * FROM chapter_cache WHERE id = $1", [req.params.id]);
            const oldChapter = found.rows[0];
            if (!oldChapter) return res.status(404).json({ error: "chapter not found" });
            const patch = cleanPatch(req.body, chapterColumns, numericChapterFields);
            if (!Object.keys(patch).length) return res.status(400).json({ error: "empty update" });
            const stmt = updateSql("chapter_cache", patch, `id = $${Object.keys(patch).length + 1}`, [req.params.id]);
            const updated = await query(stmt.sql, stmt.params);
            const chapter = updated.rows[0];
            await recordEvent({
                eventType: "chapter",
                action: "admin_update",
                bookId: chapter.book_id,
                chapterId: chapter.chapter_id,
                title: chapter.title,
                platform: chapter.platform,
                source: "admin",
                uploader: chapter.uploader,
                uploaderId: chapter.uploaderId,
                details: { id: chapter.id, oldChapterId: oldChapter.chapter_id, changed: Object.keys(patch) }
            });
            res.json({ success: true, chapter });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/chapters/:id", requireAdmin, async (req, res, next) => {
        try {
            const found = await query("SELECT * FROM chapter_cache WHERE id = $1", [req.params.id]);
            const chapter = found.rows[0];
            if (!chapter) return res.status(404).json({ error: "chapter not found" });
            const deleted = await query("DELETE FROM chapter_cache WHERE id = $1", [req.params.id]);
            await recordEvent({
                eventType: "chapter",
                action: "admin_delete",
                bookId: chapter.book_id,
                chapterId: chapter.chapter_id,
                title: chapter.title,
                platform: chapter.platform,
                source: "admin",
                uploader: chapter.uploader,
                uploaderId: chapter.uploaderId,
                details: { id: chapter.id, deleted: deleted.rowCount }
            });
            res.json({ success: true, deleted: deleted.rowCount });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createAdminLibraryRoutes };
