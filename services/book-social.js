function createBookSocialService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const botUserSelect = options.botUserSelect || (() => "*");
    const scholarProfile = options.scholarProfile || (() => ({ level: 1, name: "L1" }));
    const reviewPublishCost = Math.max(0, Math.trunc(Number(options.reviewPublishCost ?? 100)));
    const reviewMinLevel = Math.max(1, Math.trunc(Number(options.reviewMinLevel ?? 2)));
    const reviewMaxLength = Math.max(200, Math.trunc(Number(options.reviewMaxLength ?? 1200)));
    const reviewMinLength = Math.max(1, Math.trunc(Number(options.reviewMinLength ?? 6)));

    function normalizeFeedback(value) {
        const raw = String(value || "").trim().toLowerCase();
        if (["like", "liked", "up", "good", "il", "\u559c\u6b22"].includes(raw)) return "like";
        if (["dislike", "down", "bad", "id", "\u8ba8\u538c", "\u4e0d\u559c\u6b22"].includes(raw)) return "dislike";
        return "";
    }

    function normalizeReviewVote(value) {
        return normalizeFeedback(value);
    }

    function normalizeReviewContent(value = "") {
        return String(value || "")
            .replace(/\r\n?/g, "\n")
            .replace(/\u0000/g, "")
            .trim();
    }

    function reviewCharLength(value = "") {
        return Array.from(String(value || "")).length;
    }

    function reviewVoteReward(vote) {
        if (vote === "like") return 100;
        if (vote === "dislike") return -1;
        return 0;
    }

    function dbQuery(db, sql, params = []) {
        return typeof db === "function" ? db(sql, params) : db.query(sql, params);
    }

    function publicReview(row = {}) {
        if (!row) return null;
        return {
            id: row.id,
            book_id: row.book_id,
            content: row.content || "",
            publish_cost: Number(row.publish_cost || 0),
            status: row.status || "published",
            source: row.source || "",
            telegram_username: row.telegram_username || "",
            nickname: row.nickname || row.author_nickname || "",
            author_username: row.author_username || "",
            author_nickname: row.author_nickname || row.nickname || "",
            author_telegram_username: row.author_telegram_username || row.telegram_username || "",
            like_count: Number(row.like_count || 0),
            dislike_count: Number(row.dislike_count || 0),
            my_vote: row.my_vote || "",
            channel_chat_id: row.channel_chat_id || "",
            channel_message_id: row.channel_message_id || "",
            channel_status: row.channel_status || "",
            channel_error: row.channel_error || "",
            created_at: row.created_at,
            updated_at: row.updated_at,
            book_title: row.book_title || row.title || "",
            book_author: row.book_author || row.author || "",
            book_platform: row.book_platform || row.platform || "",
            detail_url: row.detail_url || ""
        };
    }

    function publicBookSummary(row = {}, fallbackBookId = "") {
        if (!row && !fallbackBookId) return null;
        return {
            book_id: row?.book_id || fallbackBookId || "",
            title: row?.title || row?.book_title || "",
            author: row?.author || row?.book_author || "",
            platform: row?.platform || row?.book_platform || "",
            detail_url: row?.detail_url || ""
        };
    }

    async function bookFeedbackCounts(bookId) {
        if (typeof query !== "function") throw new Error("book social query function is not configured");
        const result = await query(
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

    async function bookCrowdSummary(bookId, telegramId = "", dbQuery = query) {
        if (typeof dbQuery !== "function") throw new Error("book social query function is not configured");
        const result = await dbQuery(
            `WITH votes AS (
                 SELECT
                     book_id,
                     COUNT(*)::int supporter_count,
                     COALESCE(SUM(vote_cost), 0)::bigint total_silver,
                     MIN(created_at) first_vote_at,
                     MAX(created_at) latest_vote_at
                 FROM reader_book_crowd_votes
                 GROUP BY book_id
             ),
             ranked AS (
                 SELECT
                     v.*,
                     ROW_NUMBER() OVER (
                         ORDER BY supporter_count DESC, total_silver DESC, first_vote_at ASC, book_id ASC
                     )::int AS rank
                 FROM votes v
             )
             SELECT
                 m.book_id,
                 m.title,
                 m.author,
                 m.cover,
                 m.detail_url,
                 m.platform,
                 m.total_chapters,
                 m.subscribed_chapters,
                 COALESCE(cc.cache_count, 0)::int cache_count,
                 COALESCE(r.supporter_count, 0)::int supporter_count,
                 COALESCE(r.total_silver, 0)::bigint total_silver,
                 r.rank,
                 CASE
                     WHEN COALESCE($2, '') = '' THEN FALSE
                     ELSE EXISTS (
                         SELECT 1
                         FROM reader_book_crowd_votes v
                         JOIN reader_users u ON u.id = v.user_id
                         WHERE v.book_id = m.book_id AND u.telegram_id = $2
                         LIMIT 1
                     )
                 END AS supported_by_me
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

    async function crowdLeaderboard(limit = 10, telegramId = "", dbQuery = query) {
        if (typeof dbQuery !== "function") throw new Error("book social query function is not configured");
        const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
        const rows = await dbQuery(
            `WITH votes AS (
                 SELECT
                     book_id,
                     COUNT(*)::int supporter_count,
                     COALESCE(SUM(vote_cost), 0)::bigint total_silver,
                     MIN(created_at) first_vote_at,
                     MAX(created_at) latest_vote_at
                 FROM reader_book_crowd_votes
                 GROUP BY book_id
             ),
             ranked AS (
                 SELECT
                     v.*,
                     ROW_NUMBER() OVER (
                         ORDER BY supporter_count DESC, total_silver DESC, first_vote_at ASC, book_id ASC
                     )::int AS rank
                 FROM votes v
             )
             SELECT
                 r.rank,
                 r.book_id,
                 r.supporter_count,
                 r.total_silver,
                 r.first_vote_at,
                 r.latest_vote_at,
                 m.title,
                 m.author,
                 m.cover,
                 m.detail_url,
                 m.platform,
                 m.total_chapters,
                 m.subscribed_chapters,
                 COALESCE(cc.cache_count, 0)::int cache_count,
                 CASE
                     WHEN COALESCE($2, '') = '' THEN FALSE
                     ELSE EXISTS (
                         SELECT 1
                         FROM reader_book_crowd_votes v
                         JOIN reader_users u ON u.id = v.user_id
                         WHERE v.book_id = r.book_id AND u.telegram_id = $2
                         LIMIT 1
                     )
                 END AS supported_by_me
             FROM ranked r
             LEFT JOIN LATERAL (
                 SELECT
                     m.title,
                     m.author,
                     m.cover,
                     m.detail_url,
                     m.platform,
                     m.total_chapters,
                     m.subscribed_chapters
                 FROM book_metadata m
                 WHERE m.book_id = r.book_id
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1
             ) m ON true
             LEFT JOIN LATERAL (
                 SELECT COUNT(*)::int cache_count
                 FROM chapter_cache c
                 WHERE c.book_id = r.book_id
             ) cc ON true
             ORDER BY r.rank ASC
             LIMIT $1`,
            [safeLimit, normalizeTelegramId(telegramId)]
        );
        const totals = await dbQuery(
            `SELECT
                 COUNT(DISTINCT book_id)::int book_count,
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

    async function listBookReviews(bookId, optionsOrLimit = {}) {
        if (typeof query !== "function" && typeof optionsOrLimit?.query !== "function") throw new Error("book social query function is not configured");
        const opts = typeof optionsOrLimit === "number" ? { limit: optionsOrLimit } : (optionsOrLimit || {});
        const db = opts.query || query;
        const safeBookId = String(bookId || "").trim();
        const safeLimit = Math.max(1, Math.min(50, Number(opts.limit || 10)));
        const safeOffset = Math.max(0, Math.trunc(Number(opts.offset || 0)));
        const viewerUserId = opts.viewerUserId ? Number(opts.viewerUserId) : null;
        if (!safeBookId) return { rows: [], total: 0, limit: safeLimit, offset: safeOffset, book: null };
        const bookResult = await dbQuery(
            db,
            `SELECT book_id, title, author, platform, detail_url
             FROM book_metadata
             WHERE book_id = $1
             ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1`,
            [safeBookId]
        );
        const total = await dbQuery(
            db,
            `SELECT COUNT(*)::int count
             FROM reader_book_reviews
             WHERE book_id = $1 AND status = 'published'`,
            [safeBookId]
        );
        const rows = await dbQuery(
            db,
            `WITH page AS (
                 SELECT *
                 FROM reader_book_reviews
                 WHERE book_id = $1 AND status = 'published'
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2 OFFSET $3
             )
             SELECT
                 p.*,
                 u.username author_username,
                 u.nickname author_nickname,
                 u.telegram_username author_telegram_username,
                 u.telegram_id author_telegram_id,
                 COALESCE(v.like_count, 0)::int like_count,
                 COALESCE(v.dislike_count, 0)::int dislike_count,
                 COALESCE(mv.vote, '') my_vote,
                 bm.title book_title,
                 bm.author book_author,
                 bm.platform book_platform,
                 bm.detail_url
             FROM page p
             LEFT JOIN reader_users u ON u.id = p.user_id
             LEFT JOIN LATERAL (
                 SELECT
                    COUNT(*) FILTER (WHERE vote = 'like')::int like_count,
                    COUNT(*) FILTER (WHERE vote = 'dislike')::int dislike_count
                 FROM reader_book_review_votes
                 WHERE review_id = p.id
             ) v ON true
             LEFT JOIN reader_book_review_votes mv ON mv.review_id = p.id AND mv.user_id = $4
             LEFT JOIN LATERAL (
                 SELECT title, author, platform, detail_url
                 FROM book_metadata
                 WHERE book_id = p.book_id
                 ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                 LIMIT 1
             ) bm ON true
             ORDER BY p.created_at DESC, p.id DESC`,
            [safeBookId, safeLimit, safeOffset, viewerUserId]
        );
        return {
            book: publicBookSummary(bookResult.rows[0], safeBookId),
            rows: rows.rows.map(publicReview),
            total: Number(total.rows[0]?.count || 0),
            limit: safeLimit,
            offset: safeOffset
        };
    }

    async function bookReviewById(reviewId, viewerUserId = null, db = query) {
        const safeId = Number(reviewId);
        if (!Number.isSafeInteger(safeId) || safeId <= 0) return null;
        const result = await dbQuery(
            db,
            `SELECT
                 r.*,
                 u.username author_username,
                 u.nickname author_nickname,
                 u.telegram_username author_telegram_username,
                 u.telegram_id author_telegram_id,
                 COALESCE(v.like_count, 0)::int like_count,
                 COALESCE(v.dislike_count, 0)::int dislike_count,
                 COALESCE(mv.vote, '') my_vote,
                 bm.title book_title,
                 bm.author book_author,
                 bm.platform book_platform,
                 bm.detail_url
             FROM reader_book_reviews r
             LEFT JOIN reader_users u ON u.id = r.user_id
             LEFT JOIN LATERAL (
                 SELECT
                    COUNT(*) FILTER (WHERE vote = 'like')::int like_count,
                    COUNT(*) FILTER (WHERE vote = 'dislike')::int dislike_count
                 FROM reader_book_review_votes
                 WHERE review_id = r.id
             ) v ON true
             LEFT JOIN reader_book_review_votes mv ON mv.review_id = r.id AND mv.user_id = $2
             LEFT JOIN LATERAL (
                 SELECT title, author, platform, detail_url
                 FROM book_metadata
                 WHERE book_id = r.book_id
                 ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                 LIMIT 1
             ) bm ON true
             WHERE r.id = $1
             LIMIT 1`,
            [safeId, viewerUserId ? Number(viewerUserId) : null]
        );
        return publicReview(result.rows[0]);
    }

    async function createBookReview({ telegramId, bookId, content, source = "telegram_bot" } = {}) {
        if (!pool) throw new Error("book social pool is not configured");
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "").trim();
        const safeContent = normalizeReviewContent(content);
        const length = reviewCharLength(safeContent);
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!safeBookId) throw Object.assign(new Error("missing book_id"), { status: 400 });
        if (length < reviewMinLength) throw Object.assign(new Error(`书评至少 ${reviewMinLength} 字`), { status: 400 });
        if (length > reviewMaxLength) throw Object.assign(new Error(`书评最多 ${reviewMaxLength} 字`), { status: 400 });

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const userResult = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const user = userResult.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const scholar = scholarProfile(user.scholar_exp);
            if (Number(scholar.level || 1) < reviewMinLevel) {
                throw Object.assign(new Error(`Lv.${reviewMinLevel} 才能发布书评`), { status: 403, scholar });
            }
            const bookResult = await client.query(
                `SELECT *
                 FROM book_metadata
                 WHERE book_id = $1
                 ORDER BY COALESCE(subscribed_chapters, 0) DESC, COALESCE(updated_at, created_at) DESC, id DESC
                 LIMIT 1`,
                [safeBookId]
            );
            const book = bookResult.rows[0];
            if (!book) throw Object.assign(new Error("book not found"), { status: 404 });
            if (Number(user.copper_coins || 0) < reviewPublishCost) {
                throw Object.assign(new Error(`铜币不足，需要 ${reviewPublishCost}`), { status: 409 });
            }
            const updatedUser = reviewPublishCost > 0
                ? await client.query(
                      `UPDATE reader_users
                       SET copper_coins = COALESCE(copper_coins, 0) - $1
                       WHERE id = $2
                       RETURNING ${botUserSelect()}`,
                      [reviewPublishCost, user.id]
                  )
                : { rows: [user] };
            const reviewResult = await client.query(
                `INSERT INTO reader_book_reviews
                    (user_id, telegram_id, telegram_username, nickname, book_id, content, publish_cost, status, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8)
                 RETURNING *`,
                [
                    user.id,
                    user.telegram_id || safeTelegramId,
                    user.telegram_username || "",
                    user.nickname || user.username || "",
                    safeBookId,
                    safeContent,
                    reviewPublishCost,
                    String(source || "telegram_bot").slice(0, 64)
                ]
            );
            let transaction = null;
            if (reviewPublishCost > 0) {
                const tx = await client.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                     VALUES ($1,$2,$3,'copper',$4,$5,$6,$7)
                     RETURNING *`,
                    [
                        user.id,
                        user.telegram_id || safeTelegramId,
                        "book_review_publish",
                        -reviewPublishCost,
                        Number(updatedUser.rows[0].copper_coins || 0),
                        `book=${safeBookId} review=${reviewResult.rows[0].id}`,
                        String(source || "telegram_bot").slice(0, 64)
                    ]
                );
                transaction = tx.rows[0] || null;
            }
            await client.query("COMMIT");
            const review = await bookReviewById(reviewResult.rows[0].id);
            return {
                success: true,
                cost: reviewPublishCost,
                review,
                book,
                user: updatedUser.rows[0],
                transaction
            };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async function voteBookReview({ telegramId, reviewId, vote, source = "telegram_bot" } = {}) {
        if (!pool) throw new Error("book social pool is not configured");
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeReviewId = Number(reviewId);
        const safeVote = normalizeReviewVote(vote);
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!Number.isSafeInteger(safeReviewId) || safeReviewId <= 0) throw Object.assign(new Error("invalid review_id"), { status: 400 });
        if (!safeVote) throw Object.assign(new Error("invalid vote"), { status: 400 });

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const voterResult = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const voter = voterResult.rows[0];
            if (!voter) throw Object.assign(new Error("user not found"), { status: 404 });
            if (voter.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const reviewResult = await client.query(
                `SELECT r.*
                 FROM reader_book_reviews r
                 WHERE r.id = $1 AND r.status = 'published'
                 LIMIT 1
                 FOR UPDATE`,
                [safeReviewId]
            );
            const review = reviewResult.rows[0];
            if (!review) throw Object.assign(new Error("review not found"), { status: 404 });
            if (review.user_id && Number(review.user_id) === Number(voter.id)) {
                throw Object.assign(new Error("不能给自己的书评投票"), { status: 409 });
            }
            const authorResult = review.user_id
                ? await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE id = $1 FOR UPDATE`, [review.user_id])
                : { rows: [] };
            const author = authorResult.rows[0] || null;
            const existed = await client.query(
                `SELECT *
                 FROM reader_book_review_votes
                 WHERE review_id = $1 AND user_id = $2
                 LIMIT 1
                 FOR UPDATE`,
                [safeReviewId, voter.id]
            );
            const previousVote = existed.rows[0]?.vote || "";
            if (previousVote === safeVote) {
                const currentReview = await bookReviewById(safeReviewId, voter.id, client.query.bind(client));
                await client.query("COMMIT");
                return {
                    success: true,
                    already_exists: true,
                    vote: safeVote,
                    reward_delta: 0,
                    review: currentReview,
                    voter,
                    author
                };
            }

            const previousReward = reviewVoteReward(previousVote);
            const nextReward = reviewVoteReward(safeVote);
            const rewardDelta = nextReward - previousReward;
            if (existed.rows.length) {
                await client.query(
                    `UPDATE reader_book_review_votes
                     SET vote = $1, reward_delta = $2, telegram_id = $3, source = $4, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $5`,
                    [safeVote, nextReward, voter.telegram_id || safeTelegramId, String(source || "telegram_bot").slice(0, 64), existed.rows[0].id]
                );
            } else {
                await client.query(
                    `INSERT INTO reader_book_review_votes(review_id, user_id, telegram_id, vote, reward_delta, source)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [safeReviewId, voter.id, voter.telegram_id || safeTelegramId, safeVote, nextReward, String(source || "telegram_bot").slice(0, 64)]
                );
            }

            let updatedAuthor = author;
            let transaction = null;
            if (author && rewardDelta !== 0) {
                const updated = await client.query(
                    `UPDATE reader_users
                     SET copper_coins = GREATEST(0, COALESCE(copper_coins, 0) + $1)
                     WHERE id = $2
                     RETURNING ${botUserSelect()}`,
                    [rewardDelta, author.id]
                );
                updatedAuthor = updated.rows[0] || author;
                const tx = await client.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                     VALUES ($1,$2,$3,'copper',$4,$5,$6,$7)
                     RETURNING *`,
                    [
                        author.id,
                        author.telegram_id || "",
                        safeVote === "like" ? "book_review_like" : "book_review_dislike",
                        rewardDelta,
                        Number(updatedAuthor.copper_coins || 0),
                        `review=${safeReviewId} voter=${voter.telegram_id || safeTelegramId}`,
                        String(source || "telegram_bot").slice(0, 64)
                    ]
                );
                transaction = tx.rows[0] || null;
            }
            const currentReview = await bookReviewById(safeReviewId, voter.id, client.query.bind(client));
            await client.query("COMMIT");
            return {
                success: true,
                already_exists: false,
                vote: safeVote,
                previous_vote: previousVote,
                reward_delta: rewardDelta,
                review: currentReview,
                voter,
                author: updatedAuthor,
                transaction
            };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async function updateBookReviewChannelMessage(reviewId, patch = {}) {
        if (typeof query !== "function") throw new Error("book social query function is not configured");
        const safeId = Number(reviewId);
        if (!Number.isSafeInteger(safeId) || safeId <= 0) return null;
        const result = await query(
            `UPDATE reader_book_reviews
             SET channel_chat_id = COALESCE($2, channel_chat_id),
                 channel_message_id = COALESCE($3, channel_message_id),
                 channel_status = COALESCE($4, channel_status),
                 channel_error = COALESCE($5, channel_error),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [
                safeId,
                patch.channel_chat_id ?? patch.chatId ?? null,
                patch.channel_message_id ?? patch.messageId ?? null,
                patch.channel_status ?? patch.status ?? null,
                patch.channel_error ?? patch.error ?? null
            ]
        );
        return result.rows[0] || null;
    }

    return {
        bookReviewById,
        bookCrowdSummary,
        bookFeedbackCounts,
        createBookReview,
        crowdLeaderboard,
        listBookReviews,
        normalizeReviewContent,
        normalizeReviewVote,
        publicReview,
        reviewCharLength,
        reviewMinLength,
        reviewMaxLength,
        reviewMinLevel,
        reviewPublishCost,
        reviewVoteReward,
        updateBookReviewChannelMessage,
        voteBookReview,
        normalizeFeedback
    };
}

module.exports = { createBookSocialService };
