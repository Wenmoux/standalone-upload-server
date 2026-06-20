const express = require("express");

function createUploadApiRoutes(options = {}) {
    const router = express.Router();
    const {
        query,
        requireUploadApi,
        saveChapter,
        safePgBool,
        cleanPgText,
        chapterText,
        upsertBook,
        isPgConnectionError,
        chapterListOrderSql,
        recordEvent
    } = options;

    router.get("/api/parse/chapter-content", (req, res) => res.status(405).json({ error: "Method Not Allowed" }));

    router.post("/api/parse/chapter-content", requireUploadApi, async (req, res, next) => {
        try {
            const { bookId, chapterId, html, text, title, fromUserScript, cacheOnly } = req.body || {};
            if (!bookId || !chapterId) return res.status(400).json({ error: "Missing bookId or chapterId" });

            if (fromUserScript && (html || text || safePgBool(req.body?.is_volume ?? req.body?.isVolume, false))) {
                await saveChapter(req.body);
                const safeHtml = cleanPgText(html);
                const safeText = cleanPgText(text);
                return res.json({
                    html: safeHtml,
                    text: chapterText({ html: safeHtml, text: safeText }),
                    title: cleanPgText(title || ""),
                    fromCache: false,
                    uploaded: true
                });
            }

            const cached = await query("SELECT * FROM chapter_cache WHERE book_id = $1 AND chapter_id = $2", [
                cleanPgText(String(bookId)),
                cleanPgText(String(chapterId))
            ]);
            if (cached.rows[0]) {
                return res.json({
                    html: cached.rows[0].html || "",
                    text: chapterText(cached.rows[0]),
                    title: cached.rows[0].title || "",
                    fromCache: true
                });
            }
            if (cacheOnly === true) return res.status(404).json({ error: "Chapter not cached", fromCache: false });
            res.status(404).json({ error: "Chapter content not found", fromCache: false });
        } catch (err) {
            next(err);
        }
    });

    router.post("/api/metadata/batch", requireUploadApi, async (req, res, next) => {
        try {
            const books = req.body?.books;
            if (!Array.isArray(books)) return res.status(400).json({ success: false, error: "books must be an array" });

            const stats = { success: 0, failed: 0, errors: [] };
            for (const book of books) {
                try {
                    if (!book.bookId && !book.book_id) throw new Error("Missing bookId");
                    await upsertBook(book);
                    stats.success++;
                } catch (err) {
                    stats.failed++;
                    stats.errors.push(`${book?.bookId || book?.book_id || "unknown"}: ${err.message}`);
                    if (isPgConnectionError(err)) break;
                }
            }
            res.json({ success: true, stats });
        } catch (err) {
            next(err);
        }
    });

    router.post("/api/parse/check-cache", async (req, res, next) => {
        try {
            const { bookId } = req.body || {};
            if (!bookId) return res.status(400).json({ error: "Missing bookId" });
            const cached = await query(
                `WITH book_platform AS (
                    SELECT platform
                    FROM book_metadata
                    WHERE book_id = $1
                    ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                    LIMIT 1
                 )
                 SELECT chapter_id
                 FROM chapter_cache
                 WHERE book_id = $1
                 ORDER BY ${chapterListOrderSql("(SELECT platform FROM book_platform)")}`,
                [String(bookId)]
            );
            return res.json({
                cached: cached.rows.length > 0,
                chapterIds: cached.rows.map((row) => String(row.chapter_id)),
                cachedChapters: cached.rows.map((row) => String(row.chapter_id))
            });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/api/chapters/:bookId", requireUploadApi, async (req, res, next) => {
        try {
            const result = await query("DELETE FROM chapter_cache WHERE book_id = $1", [String(req.params.bookId)]);
            await recordEvent({
                eventType: "chapter",
                action: "delete_book_chapters",
                bookId: req.params.bookId,
                source: "api",
                details: { changes: result.rowCount }
            });
            res.json({ success: true, deleted: result.rowCount });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createUploadApiRoutes };
