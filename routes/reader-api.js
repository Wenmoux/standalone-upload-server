const express = require("express");
const { createReaderAuthRoutes } = require("./reader-auth");
const { createReaderTtsRoutes } = require("./reader-tts");

function truthyQuery(value) {
    return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function positiveInteger(value, fallback, max = 1000) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.floor(parsed));
}

function createReaderApiRoutes(deps = {}) {
    const router = express.Router();
    const {
        query,
        currentReaderUser,
        requireReader,
        requireLibraryAccess,
        requireReaderContentAccess,
        getHotKeywords,
        platformConfigPayload,
        isCacheCountSort,
        bookOrder,
        logSlowSearch,
        slowSearchContext,
        chapterListOrderSql,
        chapterText,
        listBookReviews,
        normalizeCorrectionText,
        correctionCharLength
    } = deps;

    router.use(createReaderAuthRoutes(deps));
    router.use(createReaderTtsRoutes(deps));

    router.get("/reader-api/me/bookshelf", requireLibraryAccess, async (req, res, next) => {
        try {
            const idsOnly = truthyQuery(req.query.idsOnly || req.query.ids_only || req.query.onlyIds || req.query.only_ids);
            if (idsOnly) {
                const rows = await query(
                    "SELECT book_id FROM reader_bookshelf WHERE user_id = $1 ORDER BY id DESC",
                    [req.session.readerUser.id]
                );
                res.json({ rows: rows.rows });
                return;
            }
            const sort = String(req.query.sort || req.query.order || "last_read_time");
            const orderBy = {
                last_read_time: "COALESCE(rh.updated_at, rb.updated_at, rb.created_at) DESC, rb.id DESC",
                reading_time: "COALESCE(rh.reading_seconds, 0) DESC, COALESCE(rh.updated_at, rb.updated_at, rb.created_at) DESC, rb.id DESC",
                shelved_time: "rb.created_at DESC, rb.id DESC"
            }[sort] || "COALESCE(rh.updated_at, rb.updated_at, rb.created_at) DESC, rb.id DESC";
            const limit = positiveInteger(req.query.limit || req.query.count, 1000, 1000);
            const page = positiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
            const offset = (page - 1) * limit;
            const rows = await query(
                `WITH shelf_rows AS (
                    SELECT rb.id as shelf_row_id, rb.book_id,
                           rb.created_at as shelved_at, rb.updated_at as shelved_updated_at,
                           rh.chapter_id as last_chapter_id, rh.progress as last_progress,
                           COALESCE(rh.reading_seconds, 0)::int reading_seconds, rh.updated_at as last_read_at,
                           ROW_NUMBER() OVER (ORDER BY ${orderBy}) as shelf_rank
                    FROM reader_bookshelf rb
                    LEFT JOIN reader_history rh ON rh.user_id = rb.user_id AND rh.book_id = rb.book_id
                    WHERE rb.user_id = $1
                    ORDER BY ${orderBy}
                    LIMIT $2 OFFSET $3
                 ),
                 metadata_rows AS (
                    SELECT DISTINCT ON (bm.book_id) bm.*
                    FROM book_metadata bm
                    JOIN shelf_rows sr ON sr.book_id = bm.book_id
                    ORDER BY bm.book_id, COALESCE(bm.subscribed_chapters, 0) DESC, COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC
                 )
                 SELECT sr.book_id, sr.shelved_at, sr.shelved_updated_at,
                        m.id, m.title, m.author, m.cover, m.tags, m.category, m.status, m.platform,
                        m.word_count, m.total_chapters, m.subscribed_chapters,
                        m.total_popularity, m.updated_at, COALESCE(cc.cache_count, 0)::int cache_count,
                        sr.last_chapter_id, sr.last_progress,
                        sr.reading_seconds, sr.last_read_at
                 FROM shelf_rows sr
                 LEFT JOIN metadata_rows m ON m.book_id = sr.book_id
                 LEFT JOIN book_stats cc ON cc.book_id = sr.book_id
                 ORDER BY sr.shelf_rank`,
                [req.session.readerUser.id, limit, offset]
            );
            res.json({ rows: rows.rows, page, limit });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-api/me/bookshelf/:bookId", requireLibraryAccess, async (req, res, next) => {
        try {
            await query(
                `INSERT INTO reader_bookshelf(user_id, book_id, updated_at) VALUES ($1,$2,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, book_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
                [req.session.readerUser.id, String(req.params.bookId)]
            );
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/reader-api/me/bookshelf/:bookId", requireReader, async (req, res, next) => {
        try {
            await query("DELETE FROM reader_bookshelf WHERE user_id = $1 AND book_id = $2", [req.session.readerUser.id, String(req.params.bookId)]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/me/bookshelf/:bookId/status", requireReader, async (req, res, next) => {
        try {
            const result = await query("SELECT 1 FROM reader_bookshelf WHERE user_id = $1 AND book_id = $2 LIMIT 1", [req.session.readerUser.id, String(req.params.bookId)]);
            res.json({ inShelf: !!result.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/me/history", requireReader, async (req, res, next) => {
        try {
            const rows = await query(
                `SELECT rh.*, m.title, m.author, m.cover, c.title as chapter_title
                 FROM reader_history rh
                 LEFT JOIN LATERAL (
                    SELECT * FROM book_metadata bm WHERE bm.book_id = rh.book_id ORDER BY COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC LIMIT 1
                 ) m ON true
                 LEFT JOIN chapter_cache c ON c.book_id = rh.book_id AND c.chapter_id = rh.chapter_id
                 WHERE rh.user_id = $1
                 ORDER BY rh.updated_at DESC
                 LIMIT 50`,
                [req.session.readerUser.id]
            );
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-api/me/history", requireReader, async (req, res, next) => {
        try {
            const bookId = String(req.body?.bookId || req.body?.book_id || "").trim();
            const chapterId = String(req.body?.chapterId || req.body?.chapter_id || "").trim();
            const progress = Math.max(0, Math.min(1, Number(req.body?.progress || 0)));
            const readingSeconds = Math.max(0, Math.min(24 * 60 * 60, Math.floor(Number(req.body?.readingSeconds || req.body?.reading_seconds || 0))));
            if (!bookId || !chapterId) return res.status(400).json({ error: "缺少 bookId/chapterId" });
            await query(
                `INSERT INTO reader_history(user_id, book_id, chapter_id, progress, reading_seconds, updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, book_id) DO UPDATE SET chapter_id = EXCLUDED.chapter_id, progress = EXCLUDED.progress, reading_seconds = COALESCE(reader_history.reading_seconds, 0) + EXCLUDED.reading_seconds, updated_at = CURRENT_TIMESTAMP`,
                [req.session.readerUser.id, bookId, chapterId, progress, readingSeconds]
            );
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/hot-keywords", async (req, res, next) => {
        try {
            res.json({ rows: await getHotKeywords(req.query.limit || 12) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/platforms", async (req, res, next) => {
        try {
            const data = await platformConfigPayload();
            res.json(data);
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/search/suggest", async (req, res, next) => {
        try {
            const keyword = String(req.query.q || req.query.keyword || "").trim();
            const platform = String(req.query.platform || "").trim();
            const limit = Math.min(20, Math.max(1, Number(req.query.limit || 10)));
            const params = [];
            const platformSql = platform ? `AND platform = $${params.push(platform)}` : "";
            const suggestions = [];
            const seen = new Set();
            const pushSuggestion = (type, value, extra = {}) => {
                const text = String(value || "").trim();
                if (!text) return;
                const key = `${type}:${text.toLowerCase()}`;
                if (seen.has(key) || suggestions.length >= limit) return;
                seen.add(key);
                suggestions.push({ type, value: text, ...extra });
            };

            if (keyword) {
                params.push(`%${keyword}%`);
                const keywordIndex = params.length;
                const rows = await query(
                    `SELECT 'title' AS type, title AS value, book_id, author, platform, COALESCE(total_popularity, 0) AS score
                     FROM book_metadata
                     WHERE title ILIKE $${keywordIndex} ${platformSql}
                     UNION ALL
                     SELECT 'author' AS type, author AS value, NULL AS book_id, author, platform, COUNT(*)::int AS score
                     FROM book_metadata
                     WHERE author ILIKE $${keywordIndex} ${platformSql}
                     GROUP BY author, platform
                     UNION ALL
                     SELECT 'tag' AS type, tag AS value, NULL AS book_id, NULL AS author, platform, COUNT(*)::int AS score
                     FROM (
                        SELECT platform, trim(regexp_split_to_table(COALESCE(tags, ''), '[,，、|/\\s:：;；#＃·•・]+')) AS tag
                        FROM book_metadata
                        WHERE tags ILIKE $${keywordIndex} ${platformSql}
                     ) t
                     WHERE tag <> '' AND tag ILIKE $${keywordIndex}
                     GROUP BY tag, platform
                     ORDER BY score DESC NULLS LAST, value ASC
                     LIMIT $${params.push(limit * 3)}`,
                    params
                );
                for (const row of rows.rows || []) {
                    pushSuggestion(row.type, row.value, {
                        book_id: row.book_id || undefined,
                        author: row.author || undefined,
                        platform: row.platform || undefined,
                        score: Number(row.score || 0)
                    });
                }
            }

            if (suggestions.length < limit) {
                const hotRows = await getHotKeywords(limit);
                for (const row of hotRows || []) {
                    if (keyword && !String(row.keyword || "").toLowerCase().includes(keyword.toLowerCase())) continue;
                    pushSuggestion("hot", row.keyword, { count: Number(row.count || 0), result_count: Number(row.result_count || row.total_results || 0) });
                }
            }

            res.json({ rows: suggestions.slice(0, limit), q: keyword, platform });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/search", async (req, res, next) => {
        const startedAt = Date.now();
        try {
            const page = Math.max(1, Number(req.query.page || 1));
            const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
            const offset = (page - 1) * limit;
            const where = [];
            const params = [];
            const keyword = String(req.query.keyword || req.query.q || "").trim();
            const author = String(req.query.author || "").trim();
            const tag = String(req.query.tag || "").trim();
            const platform = String(req.query.platform || "").trim();
            const numberFilter = (name) => {
                const raw = req.query[name];
                if (raw === undefined || raw === null || raw === "") return null;
                const parsed = Number(raw);
                return Number.isFinite(parsed) ? parsed : null;
            };
            const wordMin = numberFilter("word_min");
            const wordMax = numberFilter("word_max");
            const cacheMin = numberFilter("cache_min");
            const cacheMax = numberFilter("cache_max");
            const popularityMin = numberFilter("popularity_min");
            const popularityMax = numberFilter("popularity_max");
            const sort = String(req.query.sort || "updated_desc");
            const fastSearch = truthyQuery(req.query.fast || req.query.fast_search || req.query.no_total);
            const requireCachedBook = !keyword;
            const effectiveCacheMin = requireCachedBook ? Math.max(1, cacheMin ?? 1) : cacheMin;
            const needsCacheJoin = effectiveCacheMin !== null || cacheMax !== null || isCacheCountSort(sort);
            if (keyword) {
                params.push(`%${keyword}%`);
                where.push(`(m.book_id ILIKE $${params.length} OR m.title ILIKE $${params.length} OR m.author ILIKE $${params.length} OR m.tags ILIKE $${params.length})`);
            }
            if (author) {
                params.push(`%${author}%`);
                where.push(`m.author ILIKE $${params.length}`);
            }
            if (tag) {
                params.push(`%${tag}%`);
                where.push(`m.tags ILIKE $${params.length}`);
            }
            if (platform) {
                params.push(platform);
                where.push(`m.platform = $${params.length}`);
            }
            if (wordMin !== null) {
                params.push(wordMin);
                where.push(`COALESCE(m.word_count, 0) >= $${params.length}`);
            }
            if (wordMax !== null) {
                params.push(wordMax);
                where.push(`COALESCE(m.word_count, 0) <= $${params.length}`);
            }
            if (effectiveCacheMin !== null) {
                params.push(effectiveCacheMin);
                where.push(`COALESCE(cc.cache_count, 0) >= $${params.length}`);
            }
            if (cacheMax !== null) {
                params.push(cacheMax);
                where.push(`COALESCE(cc.cache_count, 0) <= $${params.length}`);
            }
            if (popularityMin !== null) {
                params.push(popularityMin);
                where.push(`COALESCE(m.total_popularity, 0) >= $${params.length}`);
            }
            if (popularityMax !== null) {
                params.push(popularityMax);
                where.push(`COALESCE(m.total_popularity, 0) <= $${params.length}`);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
            const cacheJoinSql = needsCacheJoin
                ? `LEFT JOIN book_stats cc ON cc.book_id = m.book_id`
                : "";
            const total = fastSearch ? null : await query(`SELECT COUNT(*)::int count FROM book_metadata m ${cacheJoinSql} ${whereSql}`, params);
            const pageOrder = needsCacheJoin ? bookOrder(sort, "m", "cc") : bookOrder(sort);
            const finalOrder = needsCacheJoin ? bookOrder(sort, "m", "bs") : bookOrder(sort);
            const limitIndex = params.length + 1;
            const offsetIndex = params.length + 2;
            const fetchLimit = fastSearch ? limit + 1 : limit;
            const dataParams = [...params, fetchLimit, offset];
            const baseColumns = `m.id, m.book_id, m.title, m.author, m.cover, m.description, m.tags, m.category,
                        m.status, m.platform, m.word_count, m.free_chapters, m.paid_chapters,
                        m.chapter_count, m.total_chapters, m.subscribed_chapters,
                        m.latest_chapter_name, m.latest_chapter_date, m.total_popularity,
                        m.monthly_popularity, m.weekly_popularity, m.daily_popularity,
                        m.favorites_count, m.comments_count, m.readers_count, m.detail_url,
                        m.created_at, m.updated_at`;
            const rows = needsCacheJoin
                ? await query(
                      `WITH page_books AS (
                           SELECT ${baseColumns}, COALESCE(cc.cache_count, 0)::int cache_count
                           FROM book_metadata m
                           ${cacheJoinSql}
                           ${whereSql}
                           ORDER BY ${pageOrder}
                           LIMIT $${limitIndex} OFFSET $${offsetIndex}
                       )
                       SELECT m.*, COALESCE(bs.like_count, 0)::int like_count,
                              COALESCE(bs.dislike_count, 0)::int dislike_count
                       FROM page_books m
                       LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                       ORDER BY ${finalOrder}`,
                      dataParams
                  )
                : await query(
                      `WITH page_books AS (
                           SELECT ${baseColumns}
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
            const pageRows = rows.rows || [];
            const hasMore = fastSearch && pageRows.length > limit;
            const visibleRows = hasMore ? pageRows.slice(0, limit) : pageRows;
            const totalCount = fastSearch
                ? offset + visibleRows.length + (hasMore ? 1 : 0)
                : Number(total.rows[0]?.count || 0);
            const payload = { rows: visibleRows, total: totalCount, page, limit };
            if (fastSearch) {
                payload.has_more = hasMore;
                payload.total_is_estimated = true;
            }
            logSlowSearch("reader-api/search", startedAt, slowSearchContext(req, { total: totalCount, rows: visibleRows.length }));
            res.json(payload);
        } catch (err) {
            logSlowSearch("reader-api/search:error", startedAt, slowSearchContext(req, { error: err.message || String(err) }));
            next(err);
        }
    });

    router.get("/reader-api/books/:bookId", async (req, res, next) => {
        try {
            const result = await query(
                `SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count,
                        COALESCE(bs.like_count, 0)::int like_count,
                        COALESCE(bs.dislike_count, 0)::int dislike_count
                 FROM book_metadata m
                 LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                 WHERE m.book_id = $1
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1`,
                [String(req.params.bookId)]
            );
            if (!result.rows[0]) return res.status(404).json({ error: "book not found" });
            res.json({ book: result.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/books/:bookId/chapters", async (req, res, next) => {
        try {
            const includeContent = ["1", "true", "yes"].includes(String(req.query.includeContent || "").toLowerCase());
            const rows = await query(
                `WITH book_platform AS (
                    SELECT platform
                    FROM book_metadata
                    WHERE book_id = $1
                    ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                    LIMIT 1
                 )
                 SELECT id, book_id, chapter_id, title, chapter_order, uploader, "uploaderId",
                        platform, COALESCE(is_volume, FALSE) AS is_volume,
                        created_at, updated_at, LENGTH(COALESCE(html, ''))::int html_length
                        ${includeContent ? ", html, text" : ""}
                 FROM chapter_cache
                 WHERE book_id = $1
                 ORDER BY ${chapterListOrderSql("(SELECT platform FROM book_platform)")}`,
                [String(req.params.bookId)]
            );
            if (includeContent) {
                for (const row of rows.rows) {
                    row.text = chapterText(row);
                }
            }
            res.json({ rows: rows.rows, total: rows.rows.length });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/books/:bookId/chapters/:chapterId", requireReaderContentAccess, async (req, res, next) => {
        try {
            const result = await query(
                `SELECT id, book_id, chapter_id, title, html, text, chapter_order, uploader, "uploaderId",
                        platform, COALESCE(is_volume, FALSE) AS is_volume, created_at, updated_at
                 FROM chapter_cache
                 WHERE book_id = $1 AND chapter_id = $2
                 LIMIT 1`,
                [String(req.params.bookId), String(req.params.chapterId)]
            );
            const chapter = result.rows[0];
            if (!chapter) return res.status(404).json({ error: "chapter not found" });
            chapter.text = chapterText(chapter);
            res.json({ chapter });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/books/:bookId/chapters/:chapterId/html", requireReaderContentAccess, async (req, res, next) => {
        try {
            const result = await query("SELECT title, html FROM chapter_cache WHERE book_id = $1 AND chapter_id = $2 LIMIT 1", [String(req.params.bookId), String(req.params.chapterId)]);
            if (!result.rows[0]) return res.status(404).send("chapter not found");
            res.type("html").send(result.rows[0].html || "");
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-api/books/:bookId/reviews", async (req, res, next) => {
        try {
            if (typeof listBookReviews !== "function") return res.json({ rows: [], total: 0, limit: 10, offset: 0 });
            let viewer = null;
            if (req.session?.readerUser?.id) {
                viewer = await currentReaderUser(req).catch(() => null);
            }
            const limit = positiveInteger(req.query.limit, 10, 50);
            const page = positiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
            const offset = Math.max(0, (page - 1) * limit);
            const result = await listBookReviews(req.params.bookId, {
                limit,
                offset,
                viewerUserId: viewer?.id || null
            });
            res.json({ ...result, page });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-api/corrections", requireReader, async (req, res, next) => {
        try {
            const user = await currentReaderUser(req);
            if (!user) return res.status(401).json({ error: "请先登录" });
            if (user.is_banned) return res.status(403).json({ error: "账号已被限制" });

            const bookId = String(req.body?.bookId || req.body?.book_id || "").trim();
            const chapterId = String(req.body?.chapterId || req.body?.chapter_id || "").trim();
            const originalText = normalizeCorrectionText(req.body?.originalText || req.body?.original_text || "");
            const correctedText = normalizeCorrectionText(req.body?.correctedText || req.body?.corrected_text || "");
            const bookTitleInput = String(req.body?.bookTitle || req.body?.book_title || "").trim();
            const chapterTitleInput = String(req.body?.chapterTitle || req.body?.chapter_title || "").trim();
            const startOffsetInput = Number(req.body?.startOffset ?? req.body?.start_offset);
            const endOffsetInput = Number(req.body?.endOffset ?? req.body?.end_offset);
            const startOffset = Number.isFinite(startOffsetInput) && startOffsetInput >= 0 ? Math.trunc(startOffsetInput) : null;
            const endOffset = Number.isFinite(endOffsetInput) && endOffsetInput >= 0 ? Math.trunc(endOffsetInput) : null;
            const originalLength = correctionCharLength(originalText);
            const correctedLength = correctionCharLength(correctedText);

            if (!bookId) return res.status(400).json({ error: "缺少书籍ID" });
            if (!chapterId) return res.status(400).json({ error: "缺少章节ID" });
            if (!originalText.trim()) return res.status(400).json({ error: "请选择需要纠错的原文" });
            if (!correctedText.trim()) return res.status(400).json({ error: "请填写修正后的文字" });
            if (originalText === correctedText) return res.status(400).json({ error: "修正内容不能和原文完全相同" });
            if (originalLength !== correctedLength) return res.status(400).json({ error: "纠错前后字数必须一致" });
            if (originalLength > 1000) return res.status(400).json({ error: "单次纠错最多选择 1000 字" });

            const chapterResult = await query(
                `SELECT c.book_id, c.chapter_id, c.title, c.html, c.text,
                        m.title book_title
                 FROM chapter_cache c
                 LEFT JOIN LATERAL (
                    SELECT title FROM book_metadata bm
                    WHERE bm.book_id = c.book_id
                    ORDER BY COALESCE(bm.subscribed_chapters, 0) DESC, COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC
                    LIMIT 1
                 ) m ON true
                 WHERE c.book_id = $1 AND c.chapter_id = $2
                 LIMIT 1`,
                [bookId, chapterId]
            );
            const chapter = chapterResult.rows[0];
            if (!chapter) return res.status(404).json({ error: "章节不存在" });
            const chapterText = chapter.text || textFromHtml(chapter.html);
            if (!chapterText.includes(originalText) && !String(chapter.html || "").includes(originalText)) {
                return res.status(409).json({ error: "原文未在当前章节中找到，请重新选择后提交" });
            }

            const inserted = await query(
                `INSERT INTO reader_corrections
                 (user_id, book_id, chapter_id, book_title, chapter_title, original_text, corrected_text, original_length, corrected_length, start_offset, end_offset)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING *`,
                [
                    user.id,
                    bookId,
                    chapterId,
                    bookTitleInput || chapter.book_title || "",
                    chapterTitleInput || chapter.title || "",
                    originalText,
                    correctedText,
                    originalLength,
                    correctedLength,
                    startOffset,
                    endOffset
                ]
            );
            res.json({ success: true, correction: inserted.rows[0] });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createReaderApiRoutes };




