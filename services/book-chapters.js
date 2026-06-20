function createBookChapterService(options = {}) {
    const {
        query,
        pool,
        pick,
        bookColumns,
        chapterColumns,
        cleanPgText,
        cleanPgValue,
        cleanPgObject,
        normalizeCorrectionText = (value = "") => String(value || "").replace(/\r\n?/g, "\n"),
        numericBookFields = new Set(),
        booleanChapterFields = new Set(),
        safePgInt,
        safePgBool,
        nowSql,
        recordEvent,
        notifyTelegram,
        logger = console
    } = options;

    function normalizeDigits(value = "") {
        return String(value || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
    }

    function parseChapterOrderFromTitle(title = "") {
        const text = normalizeDigits(title).trim();
        let match = text.match(/第\s*0*(\d{1,5})\s*[章节篇回話话]/u);
        if (match) return Number(match[1]);
        match = text.match(/^0*(\d{1,5})\s*[.．。]/u);
        if (match) return Number(match[1]);
        match = text.match(/^0*(\d{1,5})\s+\S/u);
        return match ? Number(match[1]) : 0;
    }

    const chapterOrderSkipPlatforms = new Set(["po18", "p18", "qidian", "qd", "fanqie", "fq", "tomato"]);

    function chapterOrderPlatformKey(value = "") {
        return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    }

    function shouldNormalizeChapterOrder(platform = "") {
        return !chapterOrderSkipPlatforms.has(chapterOrderPlatformKey(platform));
    }

    function chapterListOrderSql(bookPlatformSql = "platform") {
        const platformExpr = `LOWER(TRIM(COALESCE(${bookPlatformSql}, platform, '')))`;
        return `CASE WHEN ${platformExpr} IN ('qidian','qd') THEN chapter_order END ASC NULLS LAST,
                CASE WHEN ${platformExpr} IN ('qidian','qd') THEN chapter_id END ASC NULLS LAST,
                chapter_order ASC NULLS LAST,
                id ASC`;
    }

    function textFromHtml(html = "") {
        return String(html || "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/gi, "\n")
            .replace(/<(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/[ \t\f\v]+\n/g, "\n")
            .replace(/\n[ \t\f\v]+/g, "\n")
            .replace(/\n{2,}/g, "\n")
            .trim();
    }

    function hasHtmlBreaks(value = "") {
        return /<br\s*\/?>|<\/?(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/i.test(String(value || ""));
    }

    function chapterText(row = {}) {
        const htmlText = textFromHtml(row.html);
        const rawText = normalizeCorrectionText(row.text || "");
        const storedText = (hasHtmlBreaks(rawText) ? textFromHtml(rawText) : rawText).trim();
        if (!htmlText) return storedText;
        if (!storedText) return htmlText;
        const htmlParagraphs = (String(row.html || "").match(/<p\b/gi) || []).length;
        const storedLines = storedText.split(/\n/).filter((line) => line.trim()).length;
        const htmlLines = htmlText.split(/\n/).filter((line) => line.trim()).length;
        if (htmlParagraphs > 1 && storedLines <= 1 && htmlLines > 1) return htmlText;
        return storedText;
    }

    function safeTxtFilename(value = "book") {
        const name = String(value || "book")
            .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
        return name || "book";
    }

    function normalizeTxtBody(value = "") {
        return String(value || "")
            .replace(/\r\n?/g, "\n")
            .replace(/[ \t\f\v]+\n/g, "\n")
            .replace(/\n[ \t\f\v]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    function isVolumeChapter(chapter = {}) {
        return safePgBool(chapter.is_volume ?? chapter.isVolume, false);
    }

    function buildBookTxt(book = {}, chapters = []) {
        const title = String(book.title || book.book_id || "Untitled Book").trim();
        const header = [title];
        if (book.author) header.push(`Author: ${book.author}`);
        if (book.platform) header.push(`Source: ${book.platform}`);

        const sections = [header.join("\n")];
        for (const chapter of chapters) {
            const chapterTitle = String(chapter.title || "Untitled Chapter").trim();
            if (isVolumeChapter(chapter)) {
                sections.push(chapterTitle);
                continue;
            }
            const body = normalizeTxtBody(chapterText(chapter));
            sections.push(body ? `${chapterTitle}\n\n${body}` : chapterTitle);
        }

        return normalizeTxtBody(sections.join("\n\n\n")).replace(/\n/g, "\r\n") + "\r\n";
    }

    function normalizeBook(book = {}) {
        const platform = book.platform || "po18";
        return cleanPgObject({
            book_id: String(book.bookId || book.book_id),
            title: book.title || "",
            author: book.author || "",
            cover: book.cover || "",
            description: book.descriptionHTML || book.description || "",
            description_html: book.description_html || book.descriptionHtml || "",
            tags: book.tags || "",
            category: book.category || "",
            word_count: Number(book.wordCount || book.word_count || 0),
            chapter_count: Number(book.chapter_count || book.chapterCount || 0),
            free_chapters: Number(book.freeChapters || book.free_chapters || 0),
            paid_chapters: Number(book.paidChapters || book.paid_chapters || 0),
            total_chapters: Number(book.totalChapters || book.total_chapters || book.chapterCount || 0),
            subscribed_chapters: Number(book.subscribedChapters || book.subscribed_chapters || book.chapterCount || book.totalChapters || 0),
            status: book.status || "unknown",
            latest_chapter_name: book.latestChapterName || book.latest_chapter_name || "",
            latest_chapter_date: book.latestChapterDate || book.latest_chapter_date || "",
            platform,
            favorites_count: Number(book.favoritesCount || book.favorites_count || 0),
            comments_count: Number(book.commentsCount || book.comments_count || 0),
            monthly_popularity: Number(book.monthlyPopularity || book.monthly_popularity || 0),
            weekly_popularity: Number(book.weeklyPopularity || book.weekly_popularity || 0),
            daily_popularity: Number(book.dailyPopularity || book.daily_popularity || 0),
            total_popularity: Number(book.totalPopularity || book.total_popularity || 0),
            purchase_count: Number(book.purchaseCount || book.purchase_count || 0),
            readers_count: Number(book.readersCount || book.readers_count || 0),
            detail_url:
                book.detailUrl ||
                book.detail_url ||
                (platform === "popo" ? `https://www.popo.tw/books/${book.bookId}` : `https://www.po18.tw/books/${book.bookId}/articles`),
            uploader: book.uploader || "unknown_user",
            uploaderId: book.uploaderId || book.uploaderid || "unknown",
            updated_at: nowSql()
        });
    }

    function col(name) {
        return name === "uploaderId" ? '"uploaderId"' : name;
    }

    function bookOrder(sort = "updated_desc", prefix = "m", statsPrefix = "") {
        const p = prefix ? `${prefix}.` : "";
        const cacheCount = statsPrefix ? `COALESCE(${statsPrefix}.cache_count, 0)` : "cache_count";
        const expectedChapters = `GREATEST(COALESCE(${p}total_chapters, 0), COALESCE(${p}subscribed_chapters, 0), COALESCE(${p}chapter_count, 0))`;
        const completeness = `CASE WHEN ${expectedChapters} > 0 THEN (${cacheCount})::numeric / ${expectedChapters} ELSE 0 END`;
        return {
            updated_desc: `COALESCE(${p}updated_at, ${p}created_at) DESC, ${p}id DESC`,
            updated_asc: `COALESCE(${p}updated_at, ${p}created_at) ASC, ${p}id ASC`,
            cache_desc: `${cacheCount} DESC, ${p}id DESC`,
            cache_asc: `${cacheCount} ASC, ${p}id ASC`,
            complete_desc: `${completeness} DESC, ${cacheCount} DESC, ${p}id DESC`,
            complete_asc: `${completeness} ASC, ${cacheCount} ASC, ${p}id ASC`,
            chapters_desc: `COALESCE(${p}total_chapters, ${p}subscribed_chapters, 0) DESC, ${p}id DESC`,
            chapters_asc: `COALESCE(${p}total_chapters, ${p}subscribed_chapters, 0) ASC, ${p}id ASC`,
            popularity_desc: `COALESCE(${p}total_popularity, 0) DESC, ${p}id DESC`,
            popularity_asc: `COALESCE(${p}total_popularity, 0) ASC, ${p}id ASC`,
            word_desc: `COALESCE(${p}word_count, 0) DESC, ${p}id DESC`,
            word_asc: `COALESCE(${p}word_count, 0) ASC, ${p}id ASC`,
            book_id_desc: `${p}book_id DESC, ${p}id DESC`,
            book_id_asc: `${p}book_id ASC, ${p}id ASC`,
            title_asc: `${p}title ASC, ${p}id ASC`,
            title_desc: `${p}title DESC, ${p}id DESC`
        }[sort] || `COALESCE(${p}updated_at, ${p}created_at) DESC, ${p}id DESC`;
    }

    function isCacheCountSort(sort = "") {
        return sort === "cache_desc" || sort === "cache_asc" || sort === "complete_desc" || sort === "complete_asc";
    }

    function bookUpsertAssignment(key) {
        const target = `book_metadata.${col(key)}`;
        const excluded = `EXCLUDED.${col(key)}`;
        if (numericBookFields.has(key)) {
            return `${col(key)} = GREATEST(COALESCE(${target}, 0), COALESCE(${excluded}, 0))`;
        }
        if (key === "updated_at") return `${col(key)} = ${excluded}`;
        if (key === "status") return `${col(key)} = COALESCE(NULLIF(${excluded}, 'unknown'), ${target}, 'unknown')`;
        if (key === "uploader") return `${col(key)} = COALESCE(NULLIF(${excluded}, 'unknown_user'), ${target}, 'unknown_user')`;
        if (key === "uploaderId") return `${col(key)} = COALESCE(NULLIF(${excluded}, 'unknown'), ${target}, 'unknown')`;
        return `${col(key)} = COALESCE(NULLIF(${excluded}, ''), ${target})`;
    }

    function cleanPatch(data, columns, numericFields) {
        const patch = pick(data || {}, columns);
        delete patch.id;
        delete patch.created_at;
        for (const key of Object.keys(patch)) {
            if (numericFields.has(key)) patch[key] = Number(patch[key] || 0);
            else if (booleanChapterFields.has(key)) patch[key] = safePgBool(patch[key], false);
            else patch[key] = cleanPgValue(patch[key]);
        }
        patch.updated_at = nowSql();
        return patch;
    }

    function updateSql(table, patch, whereSql, whereParams) {
        const keys = Object.keys(patch);
        const values = keys.map((key) => patch[key]);
        const sets = keys.map((key, index) => `${col(key)} = $${index + 1}`).join(", ");
        return {
            sql: `UPDATE ${table} SET ${sets} WHERE ${whereSql} RETURNING *`,
            params: values.concat(whereParams)
        };
    }

    async function upsertBook(book) {
        const data = pick(normalizeBook(book), bookColumns);
        delete data.id;
        const keys = Object.keys(data);
        const values = keys.map((key) => data[key]);
        const updates = keys
            .filter((key) => key !== "book_id" && key !== "platform")
            .map(bookUpsertAssignment)
            .join(", ");
        await query(
            `INSERT INTO book_metadata (${keys.map(col).join(", ")})
             VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
             ON CONFLICT (platform, book_id) DO UPDATE SET ${updates}`,
            values
        );
        const event = await recordEvent({
            eventType: "metadata",
            action: "upsert",
            bookId: data.book_id,
            title: data.title,
            platform: data.platform,
            source: data.detail_url,
            uploader: data.uploader,
            uploaderId: data.uploaderId
        });
        notifyTelegram(event).catch((err) => logger.warn(`[telegram] ${err.message}`));
    }

    async function saveChapter(payload) {
        const bookId = cleanPgText(String(payload.bookId || payload.book_id));
        const chapterId = cleanPgText(String(payload.chapterId || payload.chapter_id));
        const platform = cleanPgText(payload.platform || "po18");
        const normalizeOrder = shouldNormalizeChapterOrder(platform);
        const client = await pool.connect();
        let data;
        try {
            await client.query("BEGIN");
            if (normalizeOrder) {
                await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`chapter_order:${bookId}`]);
            }
            const existing = await client.query(
                "SELECT chapter_order FROM chapter_cache WHERE book_id = $1 AND chapter_id = $2 LIMIT 1",
                [bookId, chapterId]
            );
            const providedOrder = safePgInt(payload.chapterOrder ?? payload.chapter_order, 0);
            let chapterOrder = providedOrder || parseChapterOrderFromTitle(payload.title || "");
            if (existing.rows[0]) {
                chapterOrder = !normalizeOrder && providedOrder
                    ? providedOrder
                    : safePgInt(existing.rows[0].chapter_order, chapterOrder || safePgInt(chapterId, 0));
            } else if (!chapterOrder) {
                const maxOrder = await client.query("SELECT COALESCE(MAX(chapter_order), 0)::int max_order FROM chapter_cache WHERE book_id = $1", [bookId]);
                chapterOrder = Number(maxOrder.rows[0]?.max_order || 0) + 1;
            } else if (normalizeOrder) {
                const occupied = await client.query(
                    "SELECT 1 FROM chapter_cache WHERE book_id = $1 AND chapter_order = $2 LIMIT 1",
                    [bookId, chapterOrder]
                );
                if (occupied.rows[0]) {
                    await client.query(
                        `UPDATE chapter_cache
                         SET chapter_order = -(chapter_order + 1)
                         WHERE book_id = $1
                           AND chapter_order >= $2
                           AND chapter_order > 0`,
                        [bookId, chapterOrder]
                    );
                    await client.query(
                        `UPDATE chapter_cache
                         SET chapter_order = -chapter_order
                         WHERE book_id = $1
                           AND chapter_order < 0`,
                        [bookId]
                    );
                }
            }
            data = pick(
                cleanPgObject({
                    book_id: bookId,
                    chapter_id: chapterId,
                    title: payload.title || "",
                    html: payload.html || "",
                    text: "",
                    chapter_order: safePgInt(chapterOrder, 0),
                    uploader: payload.uploader || "unknown_user",
                    uploaderId: payload.uploaderId || "unknown",
                    platform,
                    is_volume: safePgBool(payload.is_volume ?? payload.isVolume, false),
                    updated_at: nowSql()
                }),
                chapterColumns
            );
            delete data.id;
            const keys = Object.keys(data);
            const updates = keys
                .filter((key) => key !== "book_id" && key !== "chapter_id")
                .map((key) => `${col(key)} = EXCLUDED.${col(key)}`)
                .join(", ");
            await client.query(
                `INSERT INTO chapter_cache (${keys.map(col).join(", ")})
                 VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
                 ON CONFLICT (book_id, chapter_id) DO UPDATE SET ${updates}`,
                keys.map((key) => data[key])
            );
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
        const event = await recordEvent({
            eventType: "chapter",
            action: "upsert",
            bookId,
            chapterId,
            title: data.title,
            platform: data.platform,
            source: cleanPgText(payload.source || "") || "userscript",
            uploader: data.uploader,
            uploaderId: data.uploaderId,
            details: { textLength: textFromHtml(data.html).length, htmlLength: data.html.length, storedText: false }
        });
        notifyTelegram(event).catch((err) => logger.warn(`[telegram] ${err.message}`));
    }

    return {
        bookOrder,
        buildBookTxt,
        chapterListOrderSql,
        chapterText,
        cleanPatch,
        isCacheCountSort,
        safeTxtFilename,
        saveChapter,
        textFromHtml,
        updateSql,
        upsertBook
    };
}

module.exports = { createBookChapterService };
