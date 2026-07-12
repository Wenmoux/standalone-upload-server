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
    const cacheLookupTtlMs = Math.max(0, Number(options.cacheLookupTtlMs ?? process.env.PO18_CHECK_CACHE_TTL_MS ?? 5000));
    const cacheLookupMaxEntries = Math.max(1, Number(options.cacheLookupMaxEntries ?? process.env.PO18_CHECK_CACHE_MAX_ENTRIES ?? 500));
    const cacheLookups = new Map();

    function readCachedLookup(bookId) {
        const row = cacheLookups.get(bookId);
        if (!row || row.expiresAt <= Date.now()) {
            cacheLookups.delete(bookId);
            return null;
        }
        cacheLookups.delete(bookId);
        cacheLookups.set(bookId, row);
        return row.payload;
    }

    function writeCachedLookup(bookId, payload) {
        if (!cacheLookupTtlMs) return;
        cacheLookups.delete(bookId);
        cacheLookups.set(bookId, { payload, expiresAt: Date.now() + cacheLookupTtlMs });
        while (cacheLookups.size > cacheLookupMaxEntries) cacheLookups.delete(cacheLookups.keys().next().value);
    }

    function invalidateCachedLookup(bookId) {
        cacheLookups.delete(String(bookId || ""));
    }

    router.get("/api/parse/chapter-content", (req, res) => res.status(405).json({ error: "Method Not Allowed" }));

    router.post("/api/parse/chapter-content", requireUploadApi, async (req, res, next) => {
        try {
            const { bookId, chapterId, html, text, title, fromUserScript, cacheOnly } = req.body || {};
            if (!bookId || !chapterId) return res.status(400).json({ error: "Missing bookId or chapterId" });

            const platformKey = String(req.body?.platform || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
            const isQidianOrderOnly = ["qidian", "qd"].includes(platformKey)
                && (
                    safePgBool(req.body?.orderOnly, false)
                    || safePgBool(req.body?.updateOrderOnly, false)
                    || safePgBool(req.body?.skipContentUpdate, false)
                );

            if ((fromUserScript && (html || text || safePgBool(req.body?.is_volume ?? req.body?.isVolume, false))) || isQidianOrderOnly) {
                const saved = await saveChapter(req.body);
                invalidateCachedLookup(bookId);
                const safeHtml = cleanPgText(html);
                const safeText = cleanPgText(text);
                if (saved?.orderOnly) {
                    return res.json({
                        html: "",
                        text: "",
                        title: "",
                        fromCache: true,
                        uploaded: false,
                        orderOnly: true,
                        updated: !!saved.updated
                    });
                }
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
            const safeBookId = String(bookId);
            const cachedPayload = readCachedLookup(safeBookId);
            if (cachedPayload) return res.json(cachedPayload);
            const cached = await query(
                `WITH book_platform AS (
                    SELECT platform
                    FROM book_metadata
                    WHERE book_id = $1
                    ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                    LIMIT 1
                 )
                 SELECT chapter_id, chapter_order
                 FROM chapter_cache
                 WHERE book_id = $1
                 ORDER BY ${chapterListOrderSql("(SELECT platform FROM book_platform)")}`,
                [safeBookId]
            );
            const chapters = cached.rows.map((row) => ({
                chapterId: String(row.chapter_id),
                chapterOrder: row.chapter_order === null || row.chapter_order === undefined ? null : Number(row.chapter_order)
            }));
            const chapterIds = chapters.map((chapter) => chapter.chapterId);
            const payload = {
                cached: cached.rows.length > 0,
                chapterIds,
                cachedChapters: chapterIds,
                chapters
            };
            writeCachedLookup(safeBookId, payload);
            return res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    router.delete("/api/chapters/:bookId", requireUploadApi, async (req, res, next) => {
        try {
            const result = await query("DELETE FROM chapter_cache WHERE book_id = $1", [String(req.params.bookId)]);
            invalidateCachedLookup(req.params.bookId);
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
