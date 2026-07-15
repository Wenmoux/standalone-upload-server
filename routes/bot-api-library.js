/**
 * [INPUT]: 依赖 Express、Bot Token 鉴权、PO18 凭据加密、书架/搜索/热词/词云查询与领域事件服务
 * [OUTPUT]: 对外提供 Bot PO18 账户、书架、缺书请求、热词、词云和分享事实路由工厂
 * [POS]: routes 的 Bot 书库协议适配层，隔离凭据与检索类 HTTP 边界，不承载用户经济或社交结算
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createBotApiLibraryRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        query,
        normalizeTelegramId,
        findBotUserByTelegramId,
        getHotKeywords,
        addHotKeyword,
        wordCloudPayload,
        recordEvent,
        credentialCrypto
    } = deps;

    router.get("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const found = await query(
                "SELECT account, cookies_json, updated_at, last_login_at, last_status FROM reader_po18_accounts WHERE user_id=$1",
                [user.id]
            );
            const row = found.rows[0];
            const cookies = credentialCrypto?.decryptJson(row?.cookies_json, []) ?? row?.cookies_json;
            res.json({
                account: row?.account || "",
                cookies: Array.isArray(cookies) ? cookies : [],
                updated_at: row?.updated_at || null,
                last_login_at: row?.last_login_at || null,
                last_status: row?.last_status || ""
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/users/:telegramId/po18/credentials", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const found = await query(
                "SELECT account, password, cookies_json, updated_at, last_login_at, last_status FROM reader_po18_accounts WHERE user_id=$1",
                [user.id]
            );
            const row = found.rows[0];
            const cookies = credentialCrypto?.decryptJson(row?.cookies_json, []) ?? row?.cookies_json;
            res.json({
                account: row?.account || "",
                password: (credentialCrypto?.decryptString(row?.password || "") ?? row?.password) || "",
                cookies: Array.isArray(cookies) ? cookies : [],
                updated_at: row?.updated_at || null,
                last_login_at: row?.last_login_at || null,
                last_status: row?.last_status || ""
            });
        } catch (error) {
            next(error);
        }
    });

    router.put("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const account = String(req.body?.account || "")
                .trim()
                .slice(0, 240);
            const password = String(req.body?.password || "").slice(0, 1000);
            const cookies = Array.isArray(req.body?.cookies) ? req.body.cookies.slice(0, 200) : undefined;
            const lastStatus = String(req.body?.last_status || req.body?.lastStatus || "").slice(0, 120);
            const current = await query("SELECT account, password, cookies_json FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
            const nextAccount = account || current.rows[0]?.account || "";
            const currentPassword = (credentialCrypto?.decryptString(current.rows[0]?.password || "") ?? current.rows[0]?.password) || "";
            const currentCookies =
                (credentialCrypto?.decryptJson(current.rows[0]?.cookies_json, []) ?? current.rows[0]?.cookies_json) || [];
            const nextPassword = password || currentPassword;
            const nextCookies = cookies === undefined ? currentCookies : cookies;
            const storedPassword = credentialCrypto?.encryptString(nextPassword) ?? nextPassword;
            const storedCookies = credentialCrypto?.encryptJson(nextCookies) ?? nextCookies;
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
                [user.id, user.telegram_id, nextAccount, storedPassword, JSON.stringify(storedCookies), cookies !== undefined, lastStatus]
            );
            res.json({
                success: true,
                account: saved.rows[0].account,
                has_cookies: nextCookies.length > 0,
                updated_at: saved.rows[0].updated_at
            });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query("DELETE FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query(
                `INSERT INTO reader_bookshelf(user_id, book_id, updated_at)
                 VALUES ($1,$2,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, book_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`,
                [user.id, String(req.params.bookId).slice(0, 240)]
            );
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            await query("DELETE FROM reader_bookshelf WHERE user_id=$1 AND book_id=$2", [user.id, String(req.params.bookId).slice(0, 240)]);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/bookshelf/:telegramId", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const rows = await query(
                `SELECT rb.book_id, rb.created_at AS shelved_at,
                        m.title, m.author, m.cover, m.tags, m.platform, m.total_chapters, m.subscribed_chapters,
                        m.total_popularity, COALESCE(cc.cache_count, 0)::int cache_count
                 FROM reader_bookshelf rb
                 LEFT JOIN LATERAL (
                    SELECT * FROM book_metadata bm
                    WHERE bm.book_id=rb.book_id
                    ORDER BY COALESCE(bm.subscribed_chapters, 0) DESC, COALESCE(bm.updated_at, bm.created_at) DESC, bm.id DESC
                    LIMIT 1
                 ) m ON true
                 LEFT JOIN book_stats cc ON cc.book_id=rb.book_id
                 WHERE rb.user_id=$1
                 ORDER BY rb.updated_at DESC, rb.id DESC
                 LIMIT 50`,
                [user.id]
            );
            res.json({ rows: rows.rows });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/search-requests", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.body?.telegram_id || req.body?.telegramId);
            const queryText = String(req.body?.query || req.body?.keyword || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 200);
            const cleanQuery = String(req.body?.clean_query || req.body?.cleanQuery || queryText)
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 200);
            const searchType =
                String(req.body?.type || req.body?.search_type || req.body?.searchType || "search")
                    .trim()
                    .slice(0, 32) || "search";
            const platform = String(req.body?.platform || "")
                .trim()
                .toLowerCase()
                .slice(0, 40);
            const resultCount = Math.max(
                0,
                Math.min(1000000000, Math.trunc(Number(req.body?.result_count ?? req.body?.resultCount ?? 0) || 0))
            );
            const source =
                String(req.body?.source || "bot_search_no_result")
                    .trim()
                    .slice(0, 64) || "bot_search_no_result";
            const telegramUsername = String(req.body?.telegram_username || req.body?.telegramUsername || "")
                .replace(/^@/, "")
                .trim()
                .slice(0, 64);
            const nickname = String(req.body?.nickname || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);
            if (!telegramId || !queryText) return res.status(400).json({ error: "missing telegram_id/query" });
            const user = await findBotUserByTelegramId(telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const inserted = await query(
                `INSERT INTO reader_search_requests
                    (user_id, telegram_id, telegram_username, nickname, query, clean_query, search_type, platform, result_count, source, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id, query, platform, search_type) DO NOTHING
                 RETURNING *`,
                [
                    user.id,
                    user.telegram_id || telegramId,
                    telegramUsername,
                    nickname,
                    queryText,
                    cleanQuery,
                    searchType,
                    platform,
                    resultCount,
                    source
                ]
            );
            if (inserted.rows[0]) return res.json({ success: true, already_exists: false, request: inserted.rows[0] });
            const updated = await query(
                `UPDATE reader_search_requests
                 SET telegram_id=$2, telegram_username=$3, nickname=$4, clean_query=$5,
                     result_count=$6, source=$7, updated_at=CURRENT_TIMESTAMP
                 WHERE user_id=$1 AND query=$8 AND platform=$9 AND search_type=$10
                 RETURNING *`,
                [
                    user.id,
                    user.telegram_id || telegramId,
                    telegramUsername,
                    nickname,
                    cleanQuery,
                    resultCount,
                    source,
                    queryText,
                    platform,
                    searchType
                ]
            );
            res.json({ success: true, already_exists: true, request: updated.rows[0] || null });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            if (Array.isArray(req.body?.rows)) {
                if (req.body.rows.length > 500) return res.status(413).json({ error: "too many hot keyword rows; maximum is 500" });
                const previous = (await getHotKeywords(200)).length;
                for (const row of req.body.rows) {
                    await addHotKeyword(
                        row.keyword || row.query,
                        row.type || row.search_type,
                        row.result_count ?? row.total_results ?? 0,
                        row.count || 1,
                        row.last_searched_at || row.created_at
                    );
                }
                return res.json({ success: true, rows: await getHotKeywords(20), previous });
            }
            const row = await addHotKeyword(
                req.body?.keyword || req.body?.query,
                req.body?.type || req.body?.search_type,
                req.body?.result_count || req.body?.resultCount || 0
            );
            res.json({ success: true, row, rows: await getHotKeywords(20) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            res.json({ rows: await getHotKeywords(req.query.limit || 20) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/word-cloud", requireBotApi, async (req, res, next) => {
        try {
            if (typeof wordCloudPayload !== "function") return res.status(503).json({ error: "word cloud service is not configured" });
            res.json(
                await wordCloudPayload({
                    limit: req.query.limit,
                    hotLimit: req.query.hot_limit || req.query.hotLimit,
                    sourceLimit: req.query.source_limit || req.query.sourceLimit,
                    platform: req.query.platform || ""
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/books/:bookId/share", requireBotApi, async (req, res, next) => {
        try {
            const bookId = String(req.params.bookId || "")
                .trim()
                .slice(0, 240);
            const found = await query(
                `SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count
                 FROM book_metadata m
                 LEFT JOIN book_stats bs ON bs.book_id=m.book_id
                 WHERE m.book_id=$1
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
                details: { cachedChapters: Number(book.cache_count || 0), alreadyInLibrary: true }
            });
            res.json({ success: true, book, cached_chapters: Number(book.cache_count || 0) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createBotApiLibraryRoutes };
