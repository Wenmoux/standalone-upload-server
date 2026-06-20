const express = require("express");
const { createBotApiSystemRoutes } = require("./bot-api-system");
const { createBotApiUserRoutes } = require("./bot-api-users");

function createBotApiRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        query,
        pool,
        botUserSelect,
        botPublicUser,
        normalizeTelegramId,
        normalizeChatId,
        findBotUserByTelegramId,
        randomRedPacketAmount,
        normalizeFeedback,
        bookFeedbackCounts,
        bookCrowdSummary,
        crowdLeaderboard,
        bookReviewById,
        createBookReview,
        listBookReviews,
        reviewMaxLength,
        reviewMinLength,
        reviewMinLevel,
        reviewPublishCost,
        updateBookReviewChannelMessage,
        voteBookReview,
        pushBookReviewToChannel,
        getHotKeywords,
        addHotKeyword,
        recordEvent
    } = deps;

    router.use(createBotApiSystemRoutes(deps));

    router.use(createBotApiUserRoutes(deps));

    router.post("/bot-api/red-packets", requireBotApi, async (req, res, next) => {
        const client = await pool.connect();
        try {
            const senderTelegramId = normalizeTelegramId(req.body?.sender_telegram_id || req.body?.senderTelegramId);
            const targetTelegramId = normalizeTelegramId(req.body?.target_telegram_id || req.body?.targetTelegramId || "");
            const chatId = normalizeChatId(req.body?.chat_id || req.body?.chatId || "");
            const currencyName = String(req.body?.currency || "copper").toLowerCase() === "silver" ? "silver" : "copper";
            const column = currencyName === "silver" ? "silver_coins" : "copper_coins";
            const totalAmount = Math.max(1, Math.trunc(Number(req.body?.total_amount || req.body?.totalAmount || 0)));
            const totalCount = targetTelegramId ? 1 : Math.max(1, Math.min(100, Math.trunc(Number(req.body?.total_count || req.body?.totalCount || 1))));
            const note = String(req.body?.note || "").slice(0, 120);
            if (!senderTelegramId || !chatId) return res.status(400).json({ error: "missing sender/chat" });
            if (totalAmount < totalCount) return res.status(400).json({ error: "红包金额不能小于份数" });

            await client.query("BEGIN");
            const sender = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1 FOR UPDATE`, [senderTelegramId]);
            const senderUser = sender.rows[0];
            if (!senderUser) throw Object.assign(new Error("sender not found"), { status: 404 });
            if (senderUser.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            if (Number(senderUser[column] || 0) < totalAmount) throw Object.assign(new Error(`${currencyName === "silver" ? "银币" : "铜币"}不足`), { status: 409 });

            const updatedSender = await client.query(
                `UPDATE reader_users SET ${column}=COALESCE(${column},0)-$1 WHERE id=$2 RETURNING ${botUserSelect()}`,
                [totalAmount, senderUser.id]
            );
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const packet = await client.query(
                `INSERT INTO reader_red_packets(sender_user_id, sender_telegram_id, target_telegram_id, chat_id, currency,
                                               total_amount, total_count, remaining_count, remaining_amount, note, expired_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$6,$8,$9)
                 RETURNING *`,
                [senderUser.id, senderTelegramId, targetTelegramId, chatId, currencyName, totalAmount, totalCount, note, expiresAt]
            );
            await client.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [senderUser.id, senderTelegramId, "hb_send", currencyName, -totalAmount, updatedSender.rows[0][column], `hb ${totalAmount}x${totalCount}`, "telegram_bot"]
            );
            let targetUser = null;
            let claim = null;
            if (targetTelegramId) {
                const target = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1 FOR UPDATE`, [targetTelegramId]);
                targetUser = target.rows[0];
                if (!targetUser) throw Object.assign(new Error("target not found"), { status: 404 });
                const targetUpdated = await client.query(
                    `UPDATE reader_users SET ${column}=COALESCE(${column},0)+$1 WHERE id=$2 RETURNING ${botUserSelect()}`,
                    [totalAmount, targetUser.id]
                );
                await client.query(
                    `UPDATE reader_red_packets SET claimed_count=1, claimed_amount=$1, remaining_count=0, remaining_amount=0, status='claimed' WHERE id=$2`,
                    [totalAmount, packet.rows[0].id]
                );
                claim = await client.query(
                    `INSERT INTO reader_red_packet_claims(packet_id, user_id, telegram_id, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
                    [packet.rows[0].id, targetUser.id, targetTelegramId, totalAmount]
                );
                await client.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [targetUser.id, targetTelegramId, "hb_receive", currencyName, totalAmount, targetUpdated.rows[0][column], `hb from ${senderTelegramId}`, "telegram_bot"]
                );
            }
            await client.query("COMMIT");
            res.json({ success: true, packet: packet.rows[0], sender: botPublicUser(updatedSender.rows[0]), target: botPublicUser(targetUser), claim: claim?.rows?.[0] || null });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            res.status(err.status || 500).json({ error: err.message || "red packet failed" });
        } finally {
            client.release();
        }
    });

    router.post("/bot-api/red-packets/claim", requireBotApi, async (req, res) => {
        const client = await pool.connect();
        try {
            const telegramId = normalizeTelegramId(req.body?.telegram_id || req.body?.telegramId);
            const chatId = normalizeChatId(req.body?.chat_id || req.body?.chatId || "");
            const packetId = String(req.body?.packet_id || req.body?.packetId || "").trim();
            if (!telegramId || !chatId) return res.status(400).json({ error: "missing user/chat" });
            await client.query("BEGIN");
            const userResult = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1 FOR UPDATE`, [telegramId]);
            const user = userResult.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const packetResult = await client.query(
                `SELECT * FROM reader_red_packets
                 WHERE status='open' AND remaining_count>0 AND chat_id=$1
                   AND ($2='' OR id=$2::bigint)
                   AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)
                 ORDER BY id ASC
                 LIMIT 1
                 FOR UPDATE`,
                [chatId, packetId]
            );
            const packet = packetResult.rows[0];
            if (!packet) throw Object.assign(new Error("当前没有可抢的红包"), { status: 404 });
            if (String(packet.sender_telegram_id || "") === telegramId) throw Object.assign(new Error("不能抢自己的红包"), { status: 409 });
            if (packet.target_telegram_id && String(packet.target_telegram_id) !== telegramId) throw Object.assign(new Error("这个红包不是发给你的"), { status: 403 });
            const existed = await client.query("SELECT id FROM reader_red_packet_claims WHERE packet_id=$1 AND user_id=$2 LIMIT 1", [packet.id, user.id]);
            if (existed.rows.length) throw Object.assign(new Error("你已经抢过这个红包了"), { status: 409 });
            const claimAmount = randomRedPacketAmount(Number(packet.remaining_amount || 0), Number(packet.remaining_count || 0));
            const currencyName = packet.currency === "silver" ? "silver" : "copper";
            const column = currencyName === "silver" ? "silver_coins" : "copper_coins";
            const updatedUser = await client.query(`UPDATE reader_users SET ${column}=COALESCE(${column},0)+$1 WHERE id=$2 RETURNING ${botUserSelect()}`, [claimAmount, user.id]);
            const statusExpr = Number(packet.remaining_count || 0) - 1 <= 0 ? "claimed" : "open";
            const updatedPacket = await client.query(
                `UPDATE reader_red_packets
                 SET remaining_count=remaining_count-1,
                     remaining_amount=remaining_amount-$1,
                     claimed_count=claimed_count+1,
                     claimed_amount=claimed_amount+$1,
                     status=$2
                 WHERE id=$3
                 RETURNING *`,
                [claimAmount, statusExpr, packet.id]
            );
            const claim = await client.query(
                `INSERT INTO reader_red_packet_claims(packet_id, user_id, telegram_id, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
                [packet.id, user.id, telegramId, claimAmount]
            );
            await client.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [user.id, telegramId, "hb_receive", currencyName, claimAmount, updatedUser.rows[0][column], `hb ${packet.id} from ${packet.sender_telegram_id}`, "telegram_bot"]
            );
            await client.query("COMMIT");
            res.json({ success: true, amount: claimAmount, currency: currencyName, packet: updatedPacket.rows[0], claim: claim.rows[0], user: botPublicUser(updatedUser.rows[0]) });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            res.status(err.status || 500).json({ error: err.message || "claim failed" });
        } finally {
            client.release();
        }
    });

    router.get("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const found = await query("SELECT account, cookies_json, updated_at, last_login_at, last_status FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
            const row = found.rows[0];
            res.json({
                account: row?.account || "",
                cookies: Array.isArray(row?.cookies_json) ? row.cookies_json : [],
                updated_at: row?.updated_at || null,
                last_login_at: row?.last_login_at || null,
                last_status: row?.last_status || ""
            });
        } catch (err) {
            next(err);
        }
    });

    router.put("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const account = String(req.body?.account || "").trim();
            const password = String(req.body?.password || "");
            const cookies = Array.isArray(req.body?.cookies) ? req.body.cookies : undefined;
            const lastStatus = String(req.body?.last_status || req.body?.lastStatus || "").slice(0, 120);
            const current = await query("SELECT account, password, cookies_json FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
            const nextAccount = account || current.rows[0]?.account || "";
            const nextPassword = password || current.rows[0]?.password || "";
            const nextCookies = cookies === undefined ? current.rows[0]?.cookies_json || [] : cookies;
            const saved = await query(
                `INSERT INTO reader_po18_accounts(user_id, telegram_id, account, password, cookies_json, last_login_at, last_status, updated_at)
                 VALUES ($1,$2,$3,$4,$5::jsonb,CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE NULL END,$7,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id) DO UPDATE SET
                    telegram_id=EXCLUDED.telegram_id,
                    account=EXCLUDED.account,
                    password=EXCLUDED.password,
                    cookies_json=EXCLUDED.cookies_json,
                    last_login_at=CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE reader_po18_accounts.last_login_at END,
                    last_status=EXCLUDED.last_status,
                    updated_at=CURRENT_TIMESTAMP
                 RETURNING account, cookies_json, updated_at, last_login_at, last_status`,
                [user.id, user.telegram_id, nextAccount, nextPassword, JSON.stringify(nextCookies), cookies !== undefined, lastStatus]
            );
            res.json({ success: true, account: saved.rows[0].account, has_cookies: (saved.rows[0].cookies_json || []).length > 0, updated_at: saved.rows[0].updated_at });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query("DELETE FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query(
                `INSERT INTO reader_bookshelf(user_id, book_id, updated_at) VALUES ($1,$2,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, book_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
                [user.id, String(req.params.bookId)]
            );
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query("DELETE FROM reader_bookshelf WHERE user_id = $1 AND book_id = $2", [user.id, String(req.params.bookId)]);
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/bookshelf/:telegramId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const rows = await query(
                `SELECT rb.book_id, rb.created_at as shelved_at,
                        m.title, m.author, m.cover, m.tags, m.platform, m.total_chapters, m.subscribed_chapters,
                        m.total_popularity, COALESCE(cc.cache_count, 0)::int cache_count
                 FROM reader_bookshelf rb
                 LEFT JOIN LATERAL (
                    SELECT * FROM book_metadata bm
                    WHERE bm.book_id = rb.book_id
                    ORDER BY COALESCE(bm.subscribed_chapters, 0) DESC, COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC
                    LIMIT 1
                 ) m ON true
                 LEFT JOIN book_stats cc ON cc.book_id = rb.book_id
                 WHERE rb.user_id = $1
                 ORDER BY rb.updated_at DESC, rb.id DESC
                 LIMIT 50`,
                [user.id]
            );
            res.json({ rows: rows.rows });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/search-requests", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.body?.telegram_id || req.body?.telegramId);
            const queryText = String(req.body?.query || req.body?.keyword || "").replace(/\s+/g, " ").trim().slice(0, 200);
            const cleanQuery = String(req.body?.clean_query || req.body?.cleanQuery || queryText).replace(/\s+/g, " ").trim().slice(0, 200);
            const searchType = String(req.body?.type || req.body?.search_type || req.body?.searchType || "search").trim().slice(0, 32) || "search";
            const platform = String(req.body?.platform || "").trim().toLowerCase().slice(0, 40);
            const resultCount = Math.max(0, Math.trunc(Number(req.body?.result_count ?? req.body?.resultCount ?? 0) || 0));
            const source = String(req.body?.source || "bot_search_no_result").trim().slice(0, 64) || "bot_search_no_result";
            const telegramUsername = String(req.body?.telegram_username || req.body?.telegramUsername || "").replace(/^@/, "").trim().slice(0, 64);
            const nickname = String(req.body?.nickname || "").replace(/\s+/g, " ").trim().slice(0, 80);
            if (!telegramId || !queryText) return res.status(400).json({ error: "missing telegram_id/query" });
            const user = await findBotUserByTelegramId(telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const inserted = await query(
                `INSERT INTO reader_search_requests
                    (user_id, telegram_id, telegram_username, nickname, query, clean_query, search_type, platform, result_count, source, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, query, platform, search_type) DO NOTHING
                 RETURNING *`,
                [user.id, user.telegram_id || telegramId, telegramUsername, nickname, queryText, cleanQuery, searchType, platform, resultCount, source]
            );
            if (inserted.rows[0]) return res.json({ success: true, already_exists: false, request: inserted.rows[0] });
            const updated = await query(
                `UPDATE reader_search_requests
                 SET telegram_id=$2,
                     telegram_username=$3,
                     nickname=$4,
                     clean_query=$5,
                     result_count=$6,
                     source=$7,
                     updated_at=CURRENT_TIMESTAMP
                 WHERE user_id=$1 AND query=$8 AND platform=$9 AND search_type=$10
                 RETURNING *`,
                [user.id, user.telegram_id || telegramId, telegramUsername, nickname, cleanQuery, resultCount, source, queryText, platform, searchType]
            );
            res.json({ success: true, already_exists: true, request: updated.rows[0] || null });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/books/:bookId/feedback", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.body?.telegram_id || req.body?.telegramId);
            const bookId = String(req.params.bookId || "").trim();
            const feedback = normalizeFeedback(req.body?.feedback);
            const source = String(req.body?.source || "info").slice(0, 32);
            if (!telegramId || !bookId || !feedback) return res.status(400).json({ error: "missing telegram_id/book_id/feedback" });
            const user = await findBotUserByTelegramId(telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const book = await query("SELECT book_id FROM book_metadata WHERE book_id = $1 LIMIT 1", [bookId]);
            if (!book.rows.length) return res.status(404).json({ error: "book not found" });
            const inserted = await query(
                `INSERT INTO reader_book_feedback(user_id, telegram_id, book_id, feedback, source, updated_at)
                 VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, book_id, feedback) DO NOTHING
                 RETURNING *`,
                [user.id, user.telegram_id || telegramId, bookId, feedback, source]
            );
            const counts = await bookFeedbackCounts(bookId);
            res.json({ success: true, already_exists: !inserted.rows.length, feedback, counts });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/books/:bookId/crowd", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            const summary = await bookCrowdSummary(req.params.bookId, telegramId);
            if (!summary) return res.status(404).json({ error: "book not found" });
            const leaderboard = await crowdLeaderboard(Math.max(5, Number(req.query.limit || 5)), telegramId);
            res.json({ success: true, book: summary, leaderboard: leaderboard.rows, stats: {
                total_books: leaderboard.total_books,
                total_votes: leaderboard.total_votes,
                total_silver: leaderboard.total_silver
            } });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/book-crowd", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            const leaderboard = await crowdLeaderboard(req.query.limit || 10, telegramId);
            res.json({
                success: true,
                leaderboard: leaderboard.rows,
                stats: {
                    total_books: leaderboard.total_books,
                    total_votes: leaderboard.total_votes,
                    total_silver: leaderboard.total_silver
                }
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/books/:bookId/crowd", requireBotApi, async (req, res, next) => {
        const client = await pool.connect();
        try {
            const telegramId = normalizeTelegramId(req.body?.telegram_id || req.body?.telegramId);
            const bookId = String(req.params.bookId || "").trim();
            const voteCost = 100;
            if (!telegramId || !bookId) return res.status(400).json({ error: "missing telegram_id/book_id" });
            await client.query("BEGIN");
            const userResult = await client.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id=$1 FOR UPDATE`, [telegramId]);
            const user = userResult.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const bookResult = await client.query(
                `SELECT m.*
                 FROM book_metadata m
                 WHERE m.book_id = $1
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1`,
                [bookId]
            );
            const book = bookResult.rows[0];
            if (!book) throw Object.assign(new Error("book not found"), { status: 404 });
            const existing = await client.query(
                `SELECT id, vote_cost
                 FROM reader_book_crowd_votes
                 WHERE user_id = $1 AND book_id = $2
                 LIMIT 1
                 FOR UPDATE`,
                [user.id, bookId]
            );
            if (existing.rows.length) {
                const summary = await bookCrowdSummary(bookId, telegramId, client.query.bind(client));
                const leaderboard = await crowdLeaderboard(10, telegramId, client.query.bind(client));
                await client.query("COMMIT");
                return res.json({
                    success: true,
                    already_exists: true,
                    vote_cost: Number(existing.rows[0].vote_cost || voteCost),
                    user: botPublicUser(user),
                    book: summary,
                    leaderboard: leaderboard.rows,
                    stats: {
                        total_books: leaderboard.total_books,
                        total_votes: leaderboard.total_votes,
                        total_silver: leaderboard.total_silver
                    }
                });
            }
            if (Number(user.silver_coins || 0) < voteCost) throw Object.assign(new Error("银币不足"), { status: 409 });
            const updatedUser = await client.query(
                `UPDATE reader_users
                 SET silver_coins = COALESCE(silver_coins, 0) - $1
                 WHERE id = $2
                 RETURNING ${botUserSelect()}`,
                [voteCost, user.id]
            );
            await client.query(
                `INSERT INTO reader_book_crowd_votes(user_id, telegram_id, book_id, vote_cost)
                 VALUES ($1,$2,$3,$4)`,
                [user.id, user.telegram_id || telegramId, bookId, voteCost]
            );
            await client.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [user.id, telegramId, "crowd_vote", "silver", -voteCost, Number(updatedUser.rows[0].silver_coins || 0), `crowd ${bookId}`, "telegram_bot"]
            );
            const summary = await bookCrowdSummary(bookId, telegramId, client.query.bind(client));
            const leaderboard = await crowdLeaderboard(10, telegramId, client.query.bind(client));
            await client.query("COMMIT");
            res.json({
                success: true,
                already_exists: false,
                vote_cost: voteCost,
                user: botPublicUser(updatedUser.rows[0]),
                book: summary,
                leaderboard: leaderboard.rows,
                stats: {
                    total_books: leaderboard.total_books,
                    total_votes: leaderboard.total_votes,
                    total_silver: leaderboard.total_silver
                }
            });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            res.status(err.status || 500).json({ error: err.message || "crowd vote failed" });
        } finally {
            client.release();
        }
    });

    router.get("/bot-api/books/:bookId/reviews", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            let viewerUserId = null;
            if (telegramId) {
                const viewer = await findBotUserByTelegramId(telegramId);
                viewerUserId = viewer?.id || null;
            }
            const result = await listBookReviews(req.params.bookId, {
                limit: req.query.limit || 10,
                offset: req.query.offset || 0,
                viewerUserId
            });
            res.json({
                success: true,
                ...result,
                rules: {
                    min_level: reviewMinLevel,
                    cost_copper: reviewPublishCost,
                    min_length: reviewMinLength,
                    max_length: reviewMaxLength
                }
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/books/:bookId/reviews", requireBotApi, async (req, res, next) => {
        try {
            if (typeof createBookReview !== "function") return res.status(503).json({ error: "book review service is not configured" });
            const result = await createBookReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                bookId: req.params.bookId,
                content: req.body?.content || req.body?.text || "",
                source: req.body?.source || "telegram_bot"
            });
            let channel = { skipped: "not_configured" };
            if (typeof pushBookReviewToChannel === "function") {
                try {
                    channel = await pushBookReviewToChannel(result);
                } catch (err) {
                    channel = { ok: false, error: err.message || String(err) };
                }
            }
            const review = typeof bookReviewById === "function"
                ? await bookReviewById(result.review.id).catch(() => result.review)
                : result.review;
            res.json({
                success: true,
                cost: result.cost,
                review,
                book: result.book,
                user: botPublicUser(result.user),
                transaction: result.transaction,
                channel,
                rules: {
                    min_level: reviewMinLevel,
                    cost_copper: reviewPublishCost,
                    min_length: reviewMinLength,
                    max_length: reviewMaxLength
                }
            });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message, scholar: err.scholar || null });
            next(err);
        }
    });

    router.post("/bot-api/book-reviews/:reviewId/vote", requireBotApi, async (req, res, next) => {
        try {
            if (typeof voteBookReview !== "function") return res.status(503).json({ error: "book review service is not configured" });
            const result = await voteBookReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                reviewId: req.params.reviewId,
                vote: req.body?.vote || req.body?.feedback,
                source: req.body?.source || "telegram_bot"
            });
            res.json({
                success: true,
                already_exists: result.already_exists,
                vote: result.vote,
                previous_vote: result.previous_vote || "",
                reward_delta: result.reward_delta,
                review: result.review,
                author: botPublicUser(result.author),
                voter: botPublicUser(result.voter),
                transaction: result.transaction || null
            });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            next(err);
        }
    });

    router.post("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            if (Array.isArray(req.body?.rows)) {
                const merged = await getHotKeywords(200);
                for (const row of req.body.rows) {
                    await addHotKeyword(row.keyword || row.query, row.type || row.search_type, row.result_count ?? row.total_results ?? 0, row.count || 1, row.last_searched_at || row.created_at);
                }
                res.json({ success: true, rows: await getHotKeywords(20), previous: merged.length });
                return;
            }
            const row = await addHotKeyword(req.body?.keyword || req.body?.query, req.body?.type || req.body?.search_type, req.body?.result_count || req.body?.resultCount || 0);
            res.json({ success: true, row, rows: await getHotKeywords(20) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            res.json({ rows: await getHotKeywords(req.query.limit || 20) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/books/:bookId/share", requireBotApi, async (req, res, next) => {
        try {
            const bookId = String(req.params.bookId || "").trim();
            const found = await query(
                `SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count
                 FROM book_metadata m
                 LEFT JOIN book_stats bs ON bs.book_id = m.book_id
                 WHERE m.book_id = $1
                 ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
                 LIMIT 1`,
                [bookId]
            );
            const book = found.rows[0];
            if (!book) return res.status(404).json({ error: "book not found" });
            await recordEvent({
                eventType: "bot_share",
                action: "share_book",
                bookId,
                title: book.title,
                platform: book.platform,
                source: "telegram_bot",
                uploader: req.body?.telegram_username || req.body?.telegram_id || "telegram",
                uploaderId: req.body?.telegram_id || "",
                details: {
                    cachedChapters: Number(book.cache_count || 0),
                    alreadyInLibrary: true
                }
            });
            res.json({ success: true, book, cached_chapters: Number(book.cache_count || 0) });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createBotApiRoutes };

