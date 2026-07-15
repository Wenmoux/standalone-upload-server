/**
 * [INPUT]: 依赖 PostgreSQL query/事务、Telegram 身份规范化、Reader 用户投影与服务端众筹成本
 * [OUTPUT]: 对外提供书籍喜欢/不喜欢、众筹摘要/榜单及原子支持结算服务
 * [POS]: services 的书籍轻互动与众筹聚合根，把反馈幂等写入和银币支持事务从 Bot HTTP 路由中隔离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function crowdError(status, message) {
    return Object.assign(new Error(message), { status });
}

function createBookCrowdService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const botUserSelect = options.botUserSelect || (() => "*");
    const configuredCrowdVoteCost = Number(options.crowdVoteCost ?? 100);
    const crowdVoteCost = Number.isFinite(configuredCrowdVoteCost)
        ? Math.max(1, Math.min(1000000, Math.trunc(configuredCrowdVoteCost)))
        : 100;
    if (typeof query !== "function") throw new Error("book crowd query function is required");

    function normalizeFeedback(value) {
        const raw = String(value || "")
            .trim()
            .toLowerCase();
        if (["like", "liked", "up", "good", "il", "喜欢"].includes(raw)) return "like";
        if (["dislike", "down", "bad", "id", "讨厌", "不喜欢"].includes(raw)) return "dislike";
        return "";
    }

    async function bookFeedbackCounts(bookId, db = query) {
        const result = await db(
            `SELECT
                COUNT(*) FILTER (WHERE feedback = 'like')::int like_count,
                COUNT(*) FILTER (WHERE feedback = 'dislike')::int dislike_count,
                COUNT(DISTINCT user_id)::int feedback_users
             FROM reader_book_feedback
             WHERE book_id = $1`,
            [String(bookId)]
        );
        return result.rows[0] || { like_count: 0, dislike_count: 0, feedback_users: 0 };
    }

    async function createBookFeedback({ telegramId, bookId, feedback, source = "info" } = {}) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "")
            .trim()
            .slice(0, 240);
        const safeFeedback = normalizeFeedback(feedback);
        if (!safeTelegramId || !safeBookId || !safeFeedback) throw crowdError(400, "missing telegram_id/book_id/feedback");
        const userResult = await query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1`, [safeTelegramId]);
        const user = userResult.rows[0];
        if (!user) throw crowdError(404, "user not found");
        if (user.is_banned) throw crowdError(403, "user banned");
        const book = await query("SELECT book_id FROM book_metadata WHERE book_id=$1 LIMIT 1", [safeBookId]);
        if (!book.rows.length) throw crowdError(404, "book not found");
        const inserted = await query(
            `INSERT INTO reader_book_feedback(user_id, telegram_id, book_id, feedback, source, updated_at)
             VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, book_id, feedback) DO NOTHING
             RETURNING *`,
            [user.id, user.telegram_id || safeTelegramId, safeBookId, safeFeedback, String(source || "info").slice(0, 32)]
        );
        return {
            user,
            feedback: safeFeedback,
            already_exists: !inserted.rows.length,
            counts: await bookFeedbackCounts(safeBookId)
        };
    }

    async function bookCrowdSummary(bookId, telegramId = "", db = query) {
        const result = await db(
            `WITH votes AS (
                 SELECT book_id, COUNT(*)::int supporter_count, COALESCE(SUM(vote_cost), 0)::bigint total_silver,
                        MIN(created_at) first_vote_at, MAX(created_at) latest_vote_at
                 FROM reader_book_crowd_votes
                 GROUP BY book_id
             ),
             ranked AS (
                 SELECT v.*,
                        ROW_NUMBER() OVER (
                            ORDER BY supporter_count DESC, total_silver DESC, first_vote_at ASC, book_id ASC
                        )::int AS rank
                 FROM votes v
             )
             SELECT m.book_id, m.title, m.author, m.cover, m.detail_url, m.platform,
                    m.total_chapters, m.subscribed_chapters,
                    COALESCE(cc.cache_count, 0)::int cache_count,
                    COALESCE(r.supporter_count, 0)::int supporter_count,
                    COALESCE(r.total_silver, 0)::bigint total_silver,
                    r.rank,
                    CASE WHEN COALESCE($2, '') = '' THEN FALSE ELSE EXISTS (
                        SELECT 1
                        FROM reader_book_crowd_votes v
                        JOIN reader_users u ON u.id = v.user_id
                        WHERE v.book_id = m.book_id AND u.telegram_id = $2
                        LIMIT 1
                    ) END AS supported_by_me
             FROM (
                 SELECT m.*
                 FROM book_metadata m
                 WHERE m.book_id = $1
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1
             ) m
             LEFT JOIN ranked r ON r.book_id = m.book_id
             LEFT JOIN (
                 SELECT book_id, COUNT(*)::int cache_count
                 FROM chapter_cache
                 WHERE book_id = $1
                 GROUP BY book_id
             ) cc ON cc.book_id = m.book_id`,
            [String(bookId), normalizeTelegramId(telegramId)]
        );
        return result.rows[0] || null;
    }

    async function crowdLeaderboard(limit = 10, telegramId = "", db = query) {
        const parsedLimit = Number(limit);
        const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.trunc(parsedLimit))) : 10;
        const rows = await db(
            `WITH votes AS (
                 SELECT book_id, COUNT(*)::int supporter_count, COALESCE(SUM(vote_cost), 0)::bigint total_silver,
                        MIN(created_at) first_vote_at, MAX(created_at) latest_vote_at
                 FROM reader_book_crowd_votes
                 GROUP BY book_id
             ),
             ranked AS (
                 SELECT v.*,
                        ROW_NUMBER() OVER (
                            ORDER BY supporter_count DESC, total_silver DESC, first_vote_at ASC, book_id ASC
                        )::int AS rank
                 FROM votes v
             )
             SELECT r.rank, r.book_id, r.supporter_count, r.total_silver, r.first_vote_at, r.latest_vote_at,
                    m.title, m.author, m.cover, m.detail_url, m.platform, m.total_chapters, m.subscribed_chapters,
                    COALESCE(cc.cache_count, 0)::int cache_count,
                    CASE WHEN COALESCE($2, '') = '' THEN FALSE ELSE EXISTS (
                        SELECT 1
                        FROM reader_book_crowd_votes v
                        JOIN reader_users u ON u.id = v.user_id
                        WHERE v.book_id = r.book_id AND u.telegram_id = $2
                        LIMIT 1
                    ) END AS supported_by_me
             FROM ranked r
             LEFT JOIN LATERAL (
                 SELECT m.title, m.author, m.cover, m.detail_url, m.platform, m.total_chapters, m.subscribed_chapters
                 FROM book_metadata m
                 WHERE m.book_id = r.book_id
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1
             ) m ON true
             LEFT JOIN LATERAL (
                 SELECT COUNT(*)::int cache_count FROM chapter_cache c WHERE c.book_id = r.book_id
             ) cc ON true
             ORDER BY r.rank ASC
             LIMIT $1`,
            [safeLimit, normalizeTelegramId(telegramId)]
        );
        const totals = await db(
            `SELECT COUNT(DISTINCT book_id)::int book_count,
                    COUNT(*)::int vote_count,
                    COALESCE(SUM(vote_cost), 0)::bigint total_silver
             FROM reader_book_crowd_votes`
        );
        const summary = totals.rows[0] || { book_count: 0, vote_count: 0, total_silver: 0 };
        return {
            rows: rows.rows,
            total_books: Number(summary.book_count || 0),
            total_votes: Number(summary.vote_count || 0),
            total_silver: Number(summary.total_silver || 0)
        };
    }

    async function createCrowdVote({ telegramId, bookId } = {}) {
        if (!pool || typeof pool.connect !== "function") throw new Error("book crowd pool is required");
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "")
            .trim()
            .slice(0, 240);
        if (!safeTelegramId || !safeBookId) throw crowdError(400, "missing telegram_id/book_id");
        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const userResult = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1 FOR UPDATE`, [
                safeTelegramId
            ]);
            const user = userResult.rows[0];
            if (!user) throw crowdError(404, "user not found");
            if (user.is_banned) throw crowdError(403, "user banned");
            const bookResult = await db.query(
                `SELECT m.*
                 FROM book_metadata m
                 WHERE m.book_id=$1
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1`,
                [safeBookId]
            );
            if (!bookResult.rows[0]) throw crowdError(404, "book not found");
            const existing = await db.query(
                `SELECT id, vote_cost
                 FROM reader_book_crowd_votes
                 WHERE user_id=$1 AND book_id=$2
                 LIMIT 1
                 FOR UPDATE`,
                [user.id, safeBookId]
            );
            if (existing.rows.length) {
                const summary = await bookCrowdSummary(safeBookId, safeTelegramId, db.query.bind(db));
                const leaderboard = await crowdLeaderboard(10, safeTelegramId, db.query.bind(db));
                await db.query("COMMIT");
                return {
                    already_exists: true,
                    vote_cost: Number(existing.rows[0].vote_cost || crowdVoteCost),
                    user,
                    book: summary,
                    leaderboard
                };
            }
            const updatedUser = await db.query(
                `UPDATE reader_users
                 SET silver_coins=COALESCE(silver_coins,0)-$1
                 WHERE id=$2 AND COALESCE(silver_coins,0)>=$1
                 RETURNING ${botUserSelect()}`,
                [crowdVoteCost, user.id]
            );
            if (!updatedUser.rows.length) throw crowdError(409, "银币不足");
            await db.query(
                `INSERT INTO reader_book_crowd_votes(user_id, telegram_id, book_id, vote_cost)
                 VALUES ($1,$2,$3,$4)`,
                [user.id, user.telegram_id || safeTelegramId, safeBookId, crowdVoteCost]
            );
            await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,'crowd_vote','silver',$3,$4,$5,'telegram_bot')`,
                [user.id, safeTelegramId, -crowdVoteCost, Number(updatedUser.rows[0].silver_coins || 0), `crowd ${safeBookId}`]
            );
            const summary = await bookCrowdSummary(safeBookId, safeTelegramId, db.query.bind(db));
            const leaderboard = await crowdLeaderboard(10, safeTelegramId, db.query.bind(db));
            await db.query("COMMIT");
            return {
                already_exists: false,
                vote_cost: crowdVoteCost,
                user: updatedUser.rows[0],
                book: summary,
                leaderboard
            };
        } catch (error) {
            await db.query("ROLLBACK").catch(() => {});
            throw error;
        } finally {
            db.release();
        }
    }

    return {
        bookCrowdSummary,
        bookFeedbackCounts,
        createBookFeedback,
        createCrowdVote,
        crowdLeaderboard,
        crowdVoteCost,
        normalizeFeedback
    };
}

module.exports = { createBookCrowdService };
