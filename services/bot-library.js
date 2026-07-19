/**
 * [INPUT]: 依赖 PostgreSQL query、Bot 用户查询、PO18 凭据加密、Telegram 身份规范化与领域事件记录
 * [OUTPUT]: 对外提供会在凭据变更时失效旧会话的 PO18 账户、Bot 书架、缺书请求与书籍分享事实持久化用例
 * [POS]: services 的 Bot 书库聚合边界，维持绑定账号/密码与 Cookie 主体一致，不持有 HTTP 响应
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function libraryError(status, message) {
    return Object.assign(new Error(message), { status });
}

function compactText(value, max, { lower = false, username = false } = {}) {
    let text = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    if (username) text = text.replace(/^@/, "");
    if (lower) text = text.toLowerCase();
    return text.slice(0, max);
}

function createBotLibraryService(options = {}) {
    const query = options.query;
    const findBotUserByTelegramId = options.findBotUserByTelegramId;
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const credentialCrypto = options.credentialCrypto;
    const recordEvent = options.recordEvent;
    if (typeof query !== "function") throw new Error("bot library query function is required");
    if (typeof findBotUserByTelegramId !== "function") throw new Error("bot library user lookup is required");

    async function requireUser(telegramId) {
        const normalized = normalizeTelegramId(telegramId);
        if (!normalized) throw libraryError(400, "missing telegram_id");
        const user = await findBotUserByTelegramId(normalized);
        if (!user) throw libraryError(404, "user not found");
        return user;
    }

    function decryptCookies(value) {
        const cookies = credentialCrypto?.decryptJson(value, []) ?? value;
        return Array.isArray(cookies) ? cookies : [];
    }

    async function getPo18Account(telegramId, { includePassword = false } = {}) {
        const user = await requireUser(telegramId);
        const found = await query(
            `SELECT account, password, cookies_json, updated_at, last_login_at, last_status
             FROM reader_po18_accounts
             WHERE user_id=$1`,
            [user.id]
        );
        const row = found.rows[0];
        return {
            account: row?.account || "",
            ...(includePassword ? { password: (credentialCrypto?.decryptString(row?.password || "") ?? row?.password) || "" } : {}),
            cookies: decryptCookies(row?.cookies_json),
            updated_at: row?.updated_at || null,
            last_login_at: row?.last_login_at || null,
            last_status: row?.last_status || ""
        };
    }

    async function savePo18Account(telegramId, payload = {}) {
        const user = await requireUser(telegramId);
        const account = compactText(payload.account, 240);
        const password = String(payload.password || "").slice(0, 1000);
        const cookies = Array.isArray(payload.cookies) ? payload.cookies.slice(0, 200) : undefined;
        const lastStatus = compactText(payload.last_status ?? payload.lastStatus, 120);
        const current = await query("SELECT account, password, cookies_json, last_status FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
        const currentRow = current.rows[0] || {};
        const currentAccount = currentRow.account || "";
        const nextAccount = account || currentAccount;
        const currentPassword = (credentialCrypto?.decryptString(currentRow.password || "") ?? currentRow.password) || "";
        const currentCookies = decryptCookies(currentRow.cookies_json);
        const accountChanged = Boolean(account && account !== currentAccount);
        const passwordChanged = Boolean(password && password !== currentPassword);
        const credentialsChanged = accountChanged || passwordChanged;
        const nextPassword = password || (accountChanged ? "" : currentPassword);
        const nextCookies = cookies === undefined ? (credentialsChanged ? [] : currentCookies) : cookies;
        const sessionCleared = credentialsChanged || (cookies !== undefined && nextCookies.length === 0);
        const loginSucceeded = cookies !== undefined && nextCookies.length > 0 && lastStatus === "login_ok";
        const nextLastStatus = lastStatus || currentRow.last_status || "";
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
                last_login_at=CASE WHEN $6 THEN CURRENT_TIMESTAMP WHEN $8 THEN NULL ELSE reader_po18_accounts.last_login_at END,
                last_status=EXCLUDED.last_status,
                updated_at=CURRENT_TIMESTAMP
             RETURNING account, updated_at`,
            [user.id, user.telegram_id, nextAccount, storedPassword, JSON.stringify(storedCookies), loginSucceeded, nextLastStatus, sessionCleared]
        );
        return {
            account: saved.rows[0]?.account || nextAccount,
            has_cookies: nextCookies.length > 0,
            updated_at: saved.rows[0]?.updated_at || null
        };
    }

    async function deletePo18Account(telegramId) {
        const user = await requireUser(telegramId);
        await query("DELETE FROM reader_po18_accounts WHERE user_id=$1", [user.id]);
        return true;
    }

    async function addBookshelfBook(telegramId, bookId) {
        const user = await requireUser(telegramId);
        const safeBookId = compactText(bookId, 240);
        if (!safeBookId) throw libraryError(400, "missing book_id");
        await query(
            `INSERT INTO reader_bookshelf(user_id, book_id, updated_at)
             VALUES ($1,$2,CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, book_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`,
            [user.id, safeBookId]
        );
        return true;
    }

    async function removeBookshelfBook(telegramId, bookId) {
        const user = await requireUser(telegramId);
        const safeBookId = compactText(bookId, 240);
        if (!safeBookId) throw libraryError(400, "missing book_id");
        await query("DELETE FROM reader_bookshelf WHERE user_id=$1 AND book_id=$2", [user.id, safeBookId]);
        return true;
    }

    async function listBookshelfBooks(telegramId) {
        const user = await requireUser(telegramId);
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
        return rows.rows;
    }

    async function upsertSearchRequest(payload = {}) {
        const telegramId = normalizeTelegramId(payload.telegram_id ?? payload.telegramId);
        const queryText = compactText(payload.query ?? payload.keyword, 200);
        const cleanQuery = compactText(payload.clean_query ?? payload.cleanQuery ?? queryText, 200);
        const searchType = compactText(payload.type ?? payload.search_type ?? payload.searchType ?? "search", 32) || "search";
        const platform = compactText(payload.platform, 40, { lower: true });
        const resultCount = Math.max(0, Math.min(1000000000, Math.trunc(Number(payload.result_count ?? payload.resultCount ?? 0) || 0)));
        const source = compactText(payload.source || "bot_search_no_result", 64) || "bot_search_no_result";
        const telegramUsername = compactText(payload.telegram_username ?? payload.telegramUsername, 64, { username: true });
        const nickname = compactText(payload.nickname, 80);
        if (!telegramId || !queryText) throw libraryError(400, "missing telegram_id/query");
        const user = await requireUser(telegramId);
        const values = [
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
        ];
        const inserted = await query(
            `INSERT INTO reader_search_requests
                (user_id, telegram_id, telegram_username, nickname, query, clean_query, search_type, platform, result_count, source, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, query, platform, search_type) DO NOTHING
             RETURNING *`,
            values
        );
        if (inserted.rows[0]) return { already_exists: false, request: inserted.rows[0] };
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
        return { already_exists: true, request: updated.rows[0] || null };
    }

    async function recordBookShare(bookId, payload = {}) {
        const safeBookId = compactText(bookId, 240);
        if (!safeBookId) throw libraryError(400, "missing book_id");
        const found = await query(
            `SELECT m.*, COALESCE(bs.cache_count, 0)::int cache_count
             FROM book_metadata m
             LEFT JOIN book_stats bs ON bs.book_id=m.book_id
             WHERE m.book_id=$1
             ORDER BY COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
             LIMIT 1`,
            [safeBookId]
        );
        const book = found.rows[0];
        if (!book) throw libraryError(404, "book not found");
        if (typeof recordEvent === "function") {
            await recordEvent({
                eventType: "bot_share",
                action: "share_book",
                bookId: safeBookId,
                title: book.title,
                platform: book.platform,
                source: "telegram_bot",
                uploader: payload.telegram_username || payload.telegram_id || "telegram",
                uploaderId: payload.telegram_id || "",
                details: { cachedChapters: Number(book.cache_count || 0), alreadyInLibrary: true }
            });
        }
        return { book, cached_chapters: Number(book.cache_count || 0) };
    }

    return {
        addBookshelfBook,
        deletePo18Account,
        getPo18Account,
        listBookshelfBooks,
        recordBookShare,
        removeBookshelfBook,
        savePo18Account,
        upsertSearchRequest
    };
}

module.exports = { compactText, createBotLibraryService };
