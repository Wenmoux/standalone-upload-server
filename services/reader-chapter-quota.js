/**
 * [INPUT]: 依赖 PostgreSQL Pool、北京时间日期键及 Reader 用户/章节读取事实
 * [OUTPUT]: 对外提供 createReaderChapterQuotaService，以事务原子判定并记录按日去重的章节阅读配额
 * [POS]: services 的 Reader 正文配额领域服务，在内容路由与数据库用量账本之间统一并发、重复请求和自然日边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function normalizedChapterRefs(chapters = []) {
    const refs = new Map();
    for (const chapter of Array.isArray(chapters) ? chapters : [chapters]) {
        if (!chapter || chapter.is_volume === true || chapter.isVolume === true) continue;
        const bookId = String(chapter.book_id ?? chapter.bookId ?? "").trim();
        const chapterId = String(chapter.chapter_id ?? chapter.chapterId ?? "").trim();
        if (!bookId || !chapterId) continue;
        refs.set(`${bookId}\u0000${chapterId}`, { bookId, chapterId });
    }
    return [...refs.values()];
}

function createReaderChapterQuotaService(options = {}) {
    const pool = options.pool;
    const todayDateKey = options.todayDateKey;

    async function consumeReaderChapters({ userId, chapters } = {}) {
        const safeUserId = Number(userId);
        if (!Number.isSafeInteger(safeUserId) || safeUserId <= 0) {
            return { allowed: false, status: 401, code: "UNAUTHORIZED", error: "请登录" };
        }
        const refs = normalizedChapterRefs(chapters);
        if (!refs.length) return { allowed: true, limit: 0, used: 0, added: 0, remaining: null };
        if (!pool || typeof pool.connect !== "function" || typeof todayDateKey !== "function") {
            throw new Error("reader chapter quota service is not configured");
        }

        const client = await pool.connect();
        let transactionOpen = false;
        try {
            await client.query("BEGIN");
            transactionOpen = true;
            const user = await client.query(
                `SELECT COALESCE(daily_chapter_limit, 0)::int daily_chapter_limit
                 FROM reader_users
                 WHERE id = $1
                 FOR UPDATE`,
                [safeUserId]
            );
            if (!user.rows[0]) {
                await client.query("ROLLBACK");
                transactionOpen = false;
                return { allowed: false, status: 401, code: "UNAUTHORIZED", error: "请重新登录" };
            }

            const readDate = todayDateKey();
            const inserted = await client.query(
                `INSERT INTO reader_chapter_usage(user_id, read_date, book_id, chapter_id)
                 SELECT $1, $2::date, ref.book_id, ref.chapter_id
                 FROM UNNEST($3::text[], $4::text[]) AS ref(book_id, chapter_id)
                 ON CONFLICT (user_id, read_date, book_id, chapter_id) DO NOTHING
                 RETURNING book_id, chapter_id`,
                [safeUserId, readDate, refs.map((ref) => ref.bookId), refs.map((ref) => ref.chapterId)]
            );
            const usage = await client.query(
                `SELECT COUNT(*)::int used
                 FROM reader_chapter_usage
                 WHERE user_id = $1 AND read_date = $2::date`,
                [safeUserId, readDate]
            );
            const limit = Math.max(0, Number(user.rows[0].daily_chapter_limit || 0));
            const added = Number(inserted.rowCount ?? inserted.rows?.length ?? 0);
            const used = Number(usage.rows[0]?.used || 0);

            if (limit > 0 && added > 0 && used > limit) {
                await client.query("ROLLBACK");
                transactionOpen = false;
                const committedUsed = Math.max(0, used - added);
                return {
                    allowed: false,
                    status: 429,
                    code: "DAILY_CHAPTER_LIMIT_EXCEEDED",
                    error: "今日阅读章节次数已超过上限，请等待明日刷新",
                    limit,
                    used: committedUsed,
                    attempted: added,
                    remaining: Math.max(0, limit - committedUsed),
                    read_date: readDate
                };
            }

            await client.query("COMMIT");
            transactionOpen = false;
            return {
                allowed: true,
                limit,
                used,
                added,
                remaining: limit > 0 ? Math.max(0, limit - used) : null,
                read_date: readDate
            };
        } catch (error) {
            if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    return { consumeReaderChapters };
}

module.exports = { createReaderChapterQuotaService, normalizedChapterRefs };
