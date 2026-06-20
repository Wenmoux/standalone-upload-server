function createUserCurrencyService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const botUserSelect = options.botUserSelect || (() => "*");
    const todayDateKey = options.todayDateKey || (() => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const scholarProfile = options.scholarProfile || (() => ({ level: 1, name: "L1", daily_free_exports: 1 }));
    const nonNegativeInt = options.nonNegativeInt || ((value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : Math.max(0, Math.trunc(Number(fallback) || 0));
    });
    const currencyLabel = options.currencyLabel || ((currency) => (currency === "silver" ? "silver" : "copper"));

    function normalizeScholarFreeExportLimit(rawScholar = {}) {
        const level = Math.max(1, Math.trunc(Number(rawScholar.level || 1)));
        const configured = nonNegativeInt(rawScholar.daily_free_exports, level);
        return level <= 2 ? 1 : configured;
    }

    function scholarWithEffectiveFreeExportLimit(expValue) {
        const rawScholar = scholarProfile(expValue) || {};
        const limit = normalizeScholarFreeExportLimit(rawScholar);
        return { ...rawScholar, daily_free_exports: limit };
    }

    async function recordTransaction({ userId, telegramId = "", type, currency = "copper", amount = 0, balance = 0, detail = "", source = "" }) {
        if (!userId && !telegramId) return null;
        const normalizedCurrency = String(currency || "copper").toLowerCase();
        const result = await query(
            `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
                userId || null,
                normalizeTelegramId(telegramId),
                String(type || "").slice(0, 64),
                ["silver", "exp"].includes(normalizedCurrency) ? normalizedCurrency : "copper",
                Math.trunc(Number(amount || 0)),
                Math.trunc(Number(balance || 0)),
                String(detail || "").slice(0, 500),
                String(source || "").slice(0, 64)
            ]
        );
        return result.rows[0] || null;
    }

    async function listTransactions({ telegramId = "", userId = "", limit = 50, offset = 0, type = "", currency = "" } = {}) {
        const where = [];
        const params = [];
        if (telegramId) {
            params.push(normalizeTelegramId(telegramId));
            where.push(`t.telegram_id = $${params.length}`);
        }
        if (userId) {
            params.push(userId);
            where.push(`t.user_id = $${params.length}`);
        }
        if (type) {
            params.push(String(type));
            where.push(`t.type = $${params.length}`);
        }
        if (currency) {
            const normalizedCurrency = String(currency).toLowerCase();
            params.push(["silver", "exp"].includes(normalizedCurrency) ? normalizedCurrency : "copper");
            where.push(`t.currency = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const safeLimit = Math.max(1, Math.min(500, Number(limit || 50)));
        const safeOffset = Math.max(0, Number(offset || 0));
        const [total, rows] = await Promise.all([
            query(`SELECT COUNT(*)::int count FROM reader_transactions t ${whereSql}`, params),
            query(
                `SELECT t.*, u.username, u.nickname, u.telegram_username
                 FROM reader_transactions t
                 LEFT JOIN reader_users u ON u.id = t.user_id
                 ${whereSql}
                 ORDER BY t.created_at DESC, t.id DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, safeLimit, safeOffset]
            )
        ]);
        return { rows: rows.rows, total: Number(total.rows[0]?.count || 0), limit: safeLimit, offset: safeOffset };
    }

    async function spendUserCurrency({
        telegramId,
        currency = "copper",
        amount = 0,
        type = "spend",
        detail = "",
        source = "telegram_bot",
        setExportUnlocked = false,
        allowZero = false
    }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const currencyName = String(currency || "copper").toLowerCase() === "silver" ? "silver" : "copper";
        const column = currencyName === "silver" ? "silver_coins" : "copper_coins";
        const cost = nonNegativeInt(amount, 0);
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!allowZero && cost <= 0) throw Object.assign(new Error("amount must be greater than zero"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const updated = await db.query(
                `UPDATE reader_users
                 SET ${column} = COALESCE(${column}, 0) - $1,
                     export_unlocked_at = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE export_unlocked_at END
                 WHERE telegram_id = $2
                   AND COALESCE(${column}, 0) >= $1
                   AND ($3::boolean = FALSE OR export_unlocked_at IS NULL)
                 RETURNING ${botUserSelect()}`,
                [cost, safeTelegramId, !!setExportUnlocked]
            );
            if (!updated.rows.length) {
                const found = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1`, [safeTelegramId]);
                if (!found.rows.length) throw Object.assign(new Error("user not found"), { status: 404 });
                if (setExportUnlocked && (found.rows[0].export_unlocked_at || found.rows[0].is_admin)) {
                    await db.query("COMMIT");
                    return { user: found.rows[0], transaction: null, amount: 0, currency: currencyName };
                }
                throw Object.assign(new Error(`${currencyLabel(currencyName)} insufficient, need ${cost}`), { status: 409 });
            }

            let transaction = null;
            if (cost > 0) {
                const tx = await db.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                     RETURNING *`,
                    [
                        updated.rows[0].id,
                        safeTelegramId,
                        String(type || "spend").slice(0, 64),
                        currencyName,
                        -cost,
                        updated.rows[0][column],
                        String(detail || "").slice(0, 500),
                        String(source || "telegram_bot").slice(0, 64)
                    ]
                );
                transaction = tx.rows[0] || null;
            }
            await db.query("COMMIT");
            return { user: updated.rows[0], transaction, amount: cost, currency: currencyName };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            db.release();
        }
    }

    function dbQuery(db, sql, params = []) {
        return typeof db === "function" ? db(sql, params) : db.query(sql, params);
    }

    async function dailyFreeExportStatus(user, db = query, bookId = "") {
        const scholar = scholarWithEffectiveFreeExportLimit(user?.scholar_exp);
        const limit = scholar.daily_free_exports;
        const today = todayDateKey();
        const userId = user?.id;
        if (!userId) {
            return {
                date: today,
                limit,
                used: 0,
                remaining: limit,
                available: limit > 0,
                book_already_used: false,
                level: scholar.level,
                level_name: scholar.name,
                scholar
            };
        }
        const usedResult = await dbQuery(
            db,
            `SELECT COUNT(DISTINCT book_id)::int count
             FROM reader_export_usage
             WHERE user_id = $1 AND export_date = $2::date AND charge_type = 'free_quota'`,
            [userId, today]
        );
        const bookResult = bookId
            ? await dbQuery(
                  db,
                  `SELECT 1
                   FROM reader_export_usage
                   WHERE user_id = $1 AND export_date = $2::date AND book_id = $3 AND charge_type = 'free_quota'
                   LIMIT 1`,
                  [userId, today, String(bookId)]
              )
            : { rows: [] };
        const used = Number(usedResult.rows[0]?.count || 0);
        const already = !!bookResult.rows.length;
        return {
            date: today,
            limit,
            used,
            remaining: Math.max(0, limit - used),
            available: already || used < limit,
            book_already_used: already,
            level: scholar.level,
            level_name: scholar.name,
            scholar
        };
    }

    async function claimDailyFreeExport({ telegramId, bookId, format = "" }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "").trim();
        const safeFormat = String(format || "").trim().toLowerCase().slice(0, 16);
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!safeBookId) throw Object.assign(new Error("missing book_id"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const user = found.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });

            const before = await dailyFreeExportStatus(user, db, safeBookId);
            if (!before.available) {
                throw Object.assign(new Error(`daily free export quota used: ${before.used}/${before.limit}`), { status: 409, quota: before });
            }

            let repeated = before.book_already_used;
            if (!repeated) {
                await db.query(
                    `INSERT INTO reader_export_usage(user_id, telegram_id, book_id, format, charge_type, export_date)
                     VALUES ($1,$2,$3,$4,'free_quota',$5::date)
                     ON CONFLICT (user_id, export_date, book_id, charge_type) DO UPDATE SET
                        format = EXCLUDED.format,
                        telegram_id = EXCLUDED.telegram_id,
                        updated_at = CURRENT_TIMESTAMP`,
                    [user.id, safeTelegramId, safeBookId, safeFormat, before.date]
                );
                repeated = false;
            }
            const after = await dailyFreeExportStatus(user, db, safeBookId);
            await db.query("COMMIT");
            return { user, usage: { ...after, book_id: safeBookId, format: safeFormat, repeated } };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            db.release();
        }
    }

    return {
        claimDailyFreeExport,
        dailyFreeExportStatus,
        dbQuery,
        listTransactions,
        recordTransaction,
        spendUserCurrency
    };
}

module.exports = { createUserCurrencyService };
