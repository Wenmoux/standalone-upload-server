/**
 * [INPUT]: 依赖注入的 PostgreSQL query/事务、用户身份及签到/任务/转账/兑换/导出配额规则
 * [OUTPUT]: 对外提供用户余额、流水、签到、任务奖励、转账、兑换与配额操作的领域服务工厂
 * [POS]: services 的用户经济聚合根，以事务和幂等约束维持余额、奖励与流水的一致性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createUserCurrencyService(options = {}) {
    const query = options.query;
    const pool = options.pool;
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const botUserSelect = options.botUserSelect || (() => "*");
    const todayDateKey = options.todayDateKey || (() => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const scholarProfile = options.scholarProfile || (() => ({ level: 1, name: "L1", daily_free_exports: 1 }));
    const exportPricingConfig = options.exportPricingConfig || (async () => ({}));
    const nonNegativeInt = options.nonNegativeInt || ((value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : Math.max(0, Math.trunc(Number(fallback) || 0));
    });
    const currencyLabel = options.currencyLabel || ((currency) => (currency === "silver" ? "silver" : "copper"));

    function normalizeOperationKey(value) {
        return String(value || "").trim().slice(0, 240);
    }

    function normalizeOperationScope(value, fallback = "currency") {
        return String(value || fallback || "currency").trim().slice(0, 120) || "currency";
    }

    function operationResult(row = {}) {
        if (row.result_json && typeof row.result_json === "object") return row.result_json;
        try {
            return JSON.parse(row.result_json || "{}");
        } catch {
            return {};
        }
    }

    function operationConflict(message = "idempotency key already used for another operation") {
        return Object.assign(new Error(message), { status: 409, code: "IDEMPOTENCY_CONFLICT" });
    }

    async function replayOperation(db, {
        operationKey = "",
        operationScope = "",
        user,
        telegramId = "",
        bookId = "",
        format = ""
    } = {}) {
        const key = normalizeOperationKey(operationKey);
        if (!key) return null;
        const found = await db.query(
            `SELECT id, idempotency_key, operation_scope, operation_type, user_id, telegram_id, result_json, created_at
             FROM reader_operation_ledger
             WHERE idempotency_key = $1
             LIMIT 1`,
            [key]
        );
        const row = found.rows[0];
        if (!row) return null;
        const scope = normalizeOperationScope(operationScope);
        const result = operationResult(row);
        if (String(row.operation_scope || "") !== scope) throw operationConflict();
        if (row.user_id && user?.id && String(row.user_id) !== String(user.id)) throw operationConflict();
        if (row.telegram_id && telegramId && normalizeTelegramId(row.telegram_id) !== normalizeTelegramId(telegramId)) throw operationConflict();
        if (bookId && result.book_id && String(result.book_id) !== String(bookId)) throw operationConflict();
        if (format && result.format && String(result.format) !== String(format)) throw operationConflict();
        return { ...row, result };
    }

    async function recordOperation(db, {
        operationKey = "",
        operationScope = "",
        operationType = "",
        user,
        telegramId = "",
        result = {}
    } = {}) {
        const key = normalizeOperationKey(operationKey);
        if (!key) return null;
        const inserted = await db.query(
            `INSERT INTO reader_operation_ledger
                (idempotency_key, operation_scope, operation_type, user_id, telegram_id, result_json)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)
             RETURNING id, idempotency_key, operation_scope, operation_type, user_id, telegram_id, result_json, created_at`,
            [
                key,
                normalizeOperationScope(operationScope),
                String(operationType || "").trim().slice(0, 120),
                user?.id || null,
                normalizeTelegramId(telegramId),
                JSON.stringify(result || {})
            ]
        );
        return inserted.rows[0] || null;
    }

    function normalizeScholarFreeExportLimit(rawScholar = {}) {
        const level = Math.max(1, Math.trunc(Number(rawScholar.level || 1)));
        return level <= 2 ? 1 : 2;
    }

    function effectiveDailyLimit(level = 1, configured = {}) {
        const safeLevel = Math.max(1, Math.trunc(Number(level || 1)));
        const keys = Object.keys(configured || {})
            .map((key) => Math.max(1, Math.trunc(Number(key || 0))))
            .filter((key) => Number.isFinite(key))
            .sort((a, b) => a - b);
        let matched = null;
        for (const key of keys) {
            if (key <= safeLevel) matched = key;
            else break;
        }
        if (matched !== null) return nonNegativeInt(configured[String(matched)], normalizeScholarFreeExportLimit({ level: safeLevel }));
        return safeLevel <= 2 ? 1 : 2;
    }

    async function scholarWithEffectiveFreeExportLimit(expValue) {
        const rawScholar = scholarProfile(expValue) || {};
        let quotaByLevel = {};
        try {
            quotaByLevel = (await exportPricingConfig()).dailyQuotaByLevel || {};
        } catch {
            quotaByLevel = {};
        }
        const limit = Object.keys(quotaByLevel).length
            ? effectiveDailyLimit(rawScholar.level, quotaByLevel)
            : normalizeScholarFreeExportLimit(rawScholar);
        return { ...rawScholar, daily_free_exports: limit };
    }

    async function recordTransaction({
        userId,
        telegramId = "",
        type,
        currency = "copper",
        amount = 0,
        balance = 0,
        detail = "",
        source = "",
        operationKey = ""
    }) {
        if (!userId && !telegramId) return null;
        const normalizedCurrency = String(currency || "copper").toLowerCase();
        const result = await query(
            `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source, operation_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                userId || null,
                normalizeTelegramId(telegramId),
                String(type || "").slice(0, 64),
                ["silver", "exp"].includes(normalizedCurrency) ? normalizedCurrency : "copper",
                Math.trunc(Number(amount || 0)),
                Math.trunc(Number(balance || 0)),
                String(detail || "").slice(0, 500),
                String(source || "").slice(0, 64),
                normalizeOperationKey(operationKey)
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
        allowZero = false,
        idempotencyKey = "",
        idempotencyScope = "",
        idempotencyData = {}
    }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const currencyName = String(currency || "copper").toLowerCase() === "silver" ? "silver" : "copper";
        const column = currencyName === "silver" ? "silver_coins" : "copper_coins";
        const cost = nonNegativeInt(amount, 0);
        const operationKey = normalizeOperationKey(idempotencyKey);
        const operationScope = normalizeOperationScope(idempotencyScope, String(type || "spend"));
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!allowZero && cost <= 0) throw Object.assign(new Error("amount must be greater than zero"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const locked = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const currentUser = locked.rows[0];
            if (!currentUser) throw Object.assign(new Error("user not found"), { status: 404 });
            const replayed = await replayOperation(db, {
                operationKey,
                operationScope,
                user: currentUser,
                telegramId: safeTelegramId,
                bookId: idempotencyData?.book_id,
                format: idempotencyData?.format
            });
            if (replayed) {
                const effect = replayed.result;
                if (effect.kind !== "currency" || Number(effect.amount) !== cost || effect.currency !== currencyName) {
                    throw operationConflict();
                }
                let transaction = null;
                if (effect.transaction_id) {
                    const tx = await db.query("SELECT * FROM reader_transactions WHERE id = $1", [effect.transaction_id]);
                    transaction = tx.rows[0] || null;
                }
                await db.query("COMMIT");
                return {
                    user: currentUser,
                    transaction,
                    amount: nonNegativeInt(effect.amount, 0),
                    currency: effect.currency || currencyName,
                    repeated: true,
                    settlement: effect
                };
            }
            const updated = await db.query(
                `UPDATE reader_users
                 SET ${column} = COALESCE(${column}, 0) - $1,
                     export_unlocked_at = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE export_unlocked_at END
                 WHERE id = $2
                   AND COALESCE(${column}, 0) >= $1
                   AND ($3::boolean = FALSE OR export_unlocked_at IS NULL)
                 RETURNING ${botUserSelect()}`,
                [cost, currentUser.id, !!setExportUnlocked]
            );
            if (!updated.rows.length) {
                if (setExportUnlocked && (currentUser.export_unlocked_at || currentUser.is_admin)) {
                    await db.query("COMMIT");
                    return { user: currentUser, transaction: null, amount: 0, currency: currencyName };
                }
                throw Object.assign(new Error(`${currencyLabel(currencyName)} insufficient, need ${cost}`), { status: 409 });
            }

            let transaction = null;
            if (cost > 0) {
                const tx = await db.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source, operation_key)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     RETURNING *`,
                    [
                        updated.rows[0].id,
                        safeTelegramId,
                        String(type || "spend").slice(0, 64),
                        currencyName,
                        -cost,
                        updated.rows[0][column],
                        String(detail || "").slice(0, 500),
                        String(source || "telegram_bot").slice(0, 64),
                        operationKey
                    ]
                );
                transaction = tx.rows[0] || null;
            }
            const settlement = {
                kind: "currency",
                amount: cost,
                currency: currencyName,
                transaction_id: transaction?.id || null,
                operation_key: operationKey,
                ...(idempotencyData?.book_id ? { book_id: String(idempotencyData.book_id).slice(0, 240) } : {}),
                ...(idempotencyData?.format ? { format: String(idempotencyData.format).slice(0, 16) } : {})
            };
            await recordOperation(db, {
                operationKey,
                operationScope,
                operationType: "currency_spend",
                user: updated.rows[0],
                telegramId: safeTelegramId,
                result: settlement
            });
            await db.query("COMMIT");
            return { user: updated.rows[0], transaction, amount: cost, currency: currencyName, repeated: false, settlement };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            if (err?.code === "23505" && operationKey) throw operationConflict();
            throw err;
        } finally {
            db.release();
        }
    }

    async function adjustUserCurrency({
        telegramId,
        currency = "copper",
        delta = 0,
        type = "admin_give",
        detail = "",
        source = "telegram_bot",
        idempotencyKey = "",
        idempotencyScope = "",
        idempotencyData = {}
    }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const currencyName = String(currency || "copper").toLowerCase() === "silver" ? "silver" : "copper";
        const column = currencyName === "silver" ? "silver_coins" : "copper_coins";
        const amount = Math.trunc(Number(delta || 0));
        const operationKey = normalizeOperationKey(idempotencyKey);
        const operationScope = normalizeOperationScope(idempotencyScope, String(type || "admin_give"));
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!Number.isFinite(Number(delta)) || amount === 0) throw Object.assign(new Error("delta must not be zero"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const locked = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const currentUser = locked.rows[0];
            if (!currentUser) throw Object.assign(new Error("user not found"), { status: 404 });
            const replayed = await replayOperation(db, {
                operationKey,
                operationScope,
                user: currentUser,
                telegramId: safeTelegramId,
                bookId: idempotencyData?.book_id
            });
            if (replayed) {
                const effect = replayed.result;
                if (effect.kind !== "currency_adjustment" || Number(effect.amount) !== amount || effect.currency !== currencyName) {
                    throw operationConflict();
                }
                let transaction = null;
                if (effect.transaction_id) {
                    const tx = await db.query("SELECT * FROM reader_transactions WHERE id = $1", [effect.transaction_id]);
                    transaction = tx.rows[0] || null;
                }
                await db.query("COMMIT");
                return { user: currentUser, transaction, amount, currency: currencyName, repeated: true, settlement: effect };
            }

            const updated = await db.query(
                `UPDATE reader_users
                 SET ${column} = GREATEST(0, COALESCE(${column}, 0) + $1)
                 WHERE id = $2
                 RETURNING ${botUserSelect()}`,
                [amount, currentUser.id]
            );
            const tx = await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source, operation_key)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING *`,
                [
                    currentUser.id,
                    safeTelegramId,
                    String(type || "admin_give").slice(0, 64),
                    currencyName,
                    amount,
                    updated.rows[0][column],
                    String(detail || "").slice(0, 500),
                    String(source || "telegram_bot").slice(0, 64),
                    operationKey
                ]
            );
            const transaction = tx.rows[0] || null;
            const settlement = {
                kind: "currency_adjustment",
                amount,
                currency: currencyName,
                transaction_id: transaction?.id || null,
                operation_key: operationKey,
                ...(idempotencyData?.book_id ? { book_id: String(idempotencyData.book_id).slice(0, 240) } : {})
            };
            await recordOperation(db, {
                operationKey,
                operationScope,
                operationType: "currency_adjustment",
                user: updated.rows[0],
                telegramId: safeTelegramId,
                result: settlement
            });
            await db.query("COMMIT");
            return { user: updated.rows[0], transaction, amount, currency: currencyName, repeated: false, settlement };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            if (err?.code === "23505" && operationKey) throw operationConflict();
            throw err;
        } finally {
            db.release();
        }
    }

    function dbQuery(db, sql, params = []) {
        return typeof db === "function" ? db(sql, params) : db.query(sql, params);
    }

    async function dailyFreeExportStatus(user, db = query, bookId = "") {
        const scholar = await scholarWithEffectiveFreeExportLimit(user?.scholar_exp);
        const limit = scholar.daily_free_exports;
        const today = todayDateKey();
        const userId = user?.id;
        const extraRemaining = nonNegativeInt(user?.export_extra_quota, 0);
        if (!userId) {
            return {
                date: today,
                limit,
                used: 0,
                remaining: limit,
                available: limit > 0,
                extra_remaining: extraRemaining,
                any_available: limit > 0 || extraRemaining > 0,
                book_already_used: false,
                extra_book_already_used: false,
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
        const extraBookResult = bookId
            ? await dbQuery(
                  db,
                  `SELECT 1
                   FROM reader_export_usage
                   WHERE user_id = $1 AND export_date = $2::date AND book_id = $3 AND charge_type = 'extra_quota'
                   LIMIT 1`,
                  [userId, today, String(bookId)]
              )
            : { rows: [] };
        const used = Number(usedResult.rows[0]?.count || 0);
        const already = !!bookResult.rows.length;
        const extraAlready = !!extraBookResult.rows.length;
        return {
            date: today,
            limit,
            used,
            remaining: Math.max(0, limit - used),
            available: already || used < limit,
            extra_remaining: extraRemaining,
            any_available: already || extraAlready || used < limit || extraRemaining > 0,
            book_already_used: already,
            extra_book_already_used: extraAlready,
            level: scholar.level,
            level_name: scholar.name,
            scholar
        };
    }

    async function claimDailyFreeExport({
        telegramId,
        bookId,
        format = "",
        idempotencyKey = "",
        idempotencyScope = ""
    }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "").trim();
        const safeFormat = String(format || "").trim().toLowerCase().slice(0, 16);
        const operationKey = normalizeOperationKey(idempotencyKey);
        const operationScope = normalizeOperationScope(idempotencyScope, "export_free_quota");
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!safeBookId) throw Object.assign(new Error("missing book_id"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const user = found.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });

            const replayed = await replayOperation(db, {
                operationKey,
                operationScope,
                user,
                telegramId: safeTelegramId,
                bookId: safeBookId,
                format: safeFormat
            });
            if (replayed) {
                const current = await dailyFreeExportStatus(user, db, safeBookId);
                await db.query("COMMIT");
                return {
                    user,
                    usage: {
                        ...current,
                        ...replayed.result,
                        book_id: replayed.result.book_id || safeBookId,
                        format: replayed.result.format || safeFormat,
                        repeated: true,
                        settlement_replayed: true
                    }
                };
            }

            const before = await dailyFreeExportStatus(user, db, safeBookId);
            if (!before.available) {
                throw Object.assign(new Error(`daily free export quota used: ${before.used}/${before.limit}`), { status: 409, quota: before });
            }

            let repeated = before.book_already_used;
            if (!repeated) {
                await db.query(
                    `INSERT INTO reader_export_usage(user_id, telegram_id, book_id, format, charge_type, export_date, operation_key)
                     VALUES ($1,$2,$3,$4,'free_quota',$5::date,$6)
                     ON CONFLICT (user_id, export_date, book_id, charge_type) DO UPDATE SET
                        format = EXCLUDED.format,
                        telegram_id = EXCLUDED.telegram_id,
                        operation_key = CASE
                            WHEN reader_export_usage.operation_key = '' THEN EXCLUDED.operation_key
                            ELSE reader_export_usage.operation_key
                        END,
                        updated_at = CURRENT_TIMESTAMP
                     RETURNING id`,
                    [user.id, safeTelegramId, safeBookId, safeFormat, before.date, operationKey]
                );
                repeated = false;
            }
            const after = await dailyFreeExportStatus(user, db, safeBookId);
            const usageRow = await db.query(
                `SELECT id FROM reader_export_usage
                 WHERE user_id=$1 AND export_date=$2::date AND book_id=$3 AND charge_type='free_quota'
                 LIMIT 1`,
                [user.id, before.date, safeBookId]
            );
            const settlement = {
                kind: "free_quota",
                amount: 0,
                currency: "",
                book_id: safeBookId,
                format: safeFormat,
                charge_type: "free_quota",
                export_date: before.date,
                usage_id: usageRow.rows[0]?.id || null,
                operation_key: operationKey
            };
            await recordOperation(db, {
                operationKey,
                operationScope,
                operationType: "export_free_quota",
                user,
                telegramId: safeTelegramId,
                result: settlement
            });
            await db.query("COMMIT");
            return { user, usage: { ...after, ...settlement, book_id: safeBookId, format: safeFormat, repeated } };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            if (err?.code === "23505" && operationKey) throw operationConflict();
            throw err;
        } finally {
            db.release();
        }
    }

    async function claimExtraExportQuota({
        telegramId,
        bookId,
        format = "",
        idempotencyKey = "",
        idempotencyScope = ""
    }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const safeBookId = String(bookId || "").trim();
        const safeFormat = String(format || "").trim().toLowerCase().slice(0, 16);
        const operationKey = normalizeOperationKey(idempotencyKey);
        const operationScope = normalizeOperationScope(idempotencyScope, "export_extra_quota");
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!safeBookId) throw Object.assign(new Error("missing book_id"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const user = found.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const replayed = await replayOperation(db, {
                operationKey,
                operationScope,
                user,
                telegramId: safeTelegramId,
                bookId: safeBookId,
                format: safeFormat
            });
            if (replayed) {
                const current = await dailyFreeExportStatus(user, db, safeBookId);
                await db.query("COMMIT");
                return {
                    user,
                    usage: {
                        ...current,
                        ...replayed.result,
                        book_id: replayed.result.book_id || safeBookId,
                        format: replayed.result.format || safeFormat,
                        repeated: true,
                        settlement_replayed: true
                    }
                };
            }
            const today = todayDateKey();
            const existed = await db.query(
                `SELECT id
                 FROM reader_export_usage
                 WHERE user_id = $1 AND export_date = $2::date AND book_id = $3 AND charge_type = 'extra_quota'
                 LIMIT 1`,
                [user.id, today, safeBookId]
            );
            let updatedUser = user;
            let repeated = !!existed.rows.length;
            if (!repeated) {
                if (nonNegativeInt(user.export_extra_quota, 0) <= 0) {
                    throw Object.assign(new Error("extra export quota used"), { status: 409, quota: await dailyFreeExportStatus(user, db, safeBookId) });
                }
                const updated = await db.query(
                    `UPDATE reader_users
                     SET export_extra_quota = GREATEST(0, COALESCE(export_extra_quota, 0) - 1)
                     WHERE id = $1 AND COALESCE(export_extra_quota, 0) > 0
                     RETURNING ${botUserSelect()}`,
                    [user.id]
                );
                if (!updated.rows.length) {
                    throw Object.assign(new Error("extra export quota used"), { status: 409, quota: await dailyFreeExportStatus(user, db, safeBookId) });
                }
                updatedUser = updated.rows[0];
                await db.query(
                    `INSERT INTO reader_export_usage(user_id, telegram_id, book_id, format, charge_type, export_date, operation_key)
                     VALUES ($1,$2,$3,$4,'extra_quota',$5::date,$6)
                     ON CONFLICT (user_id, export_date, book_id, charge_type) DO UPDATE SET
                        format = EXCLUDED.format,
                        telegram_id = EXCLUDED.telegram_id,
                        operation_key = CASE
                            WHEN reader_export_usage.operation_key = '' THEN EXCLUDED.operation_key
                            ELSE reader_export_usage.operation_key
                        END,
                        updated_at = CURRENT_TIMESTAMP`,
                    [user.id, safeTelegramId, safeBookId, safeFormat, today, operationKey]
                );
                await db.query(
                    `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source, operation_key)
                     VALUES ($1,$2,$3,'copper',0,$4,$5,$6,$7)`,
                    [user.id, safeTelegramId, "export_extra_quota", nonNegativeInt(updatedUser.export_extra_quota, 0), `${safeBookId} ${safeFormat}`, "telegram_bot", operationKey]
                );
            }
            const after = await dailyFreeExportStatus(updatedUser, db, safeBookId);
            const usageRow = await db.query(
                `SELECT id FROM reader_export_usage
                 WHERE user_id=$1 AND export_date=$2::date AND book_id=$3 AND charge_type='extra_quota'
                 LIMIT 1`,
                [user.id, today, safeBookId]
            );
            const settlement = {
                kind: "extra_quota",
                amount: 0,
                currency: "",
                book_id: safeBookId,
                format: safeFormat,
                charge_type: "extra_quota",
                export_date: today,
                usage_id: usageRow.rows[0]?.id || null,
                operation_key: operationKey
            };
            await recordOperation(db, {
                operationKey,
                operationScope,
                operationType: "export_extra_quota",
                user: updatedUser,
                telegramId: safeTelegramId,
                result: settlement
            });
            await db.query("COMMIT");
            return { user: updatedUser, usage: { ...after, ...settlement, book_id: safeBookId, format: safeFormat, repeated, charge_type: "extra_quota" } };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            if (err?.code === "23505" && operationKey) throw operationConflict();
            throw err;
        } finally {
            db.release();
        }
    }

    async function redeemExportQuotaCdk({ telegramId, code }) {
        const safeTelegramId = normalizeTelegramId(telegramId);
        const cdkCode = String(code || "").trim().toUpperCase();
        if (!safeTelegramId) throw Object.assign(new Error("missing telegram_id"), { status: 400 });
        if (!cdkCode) throw Object.assign(new Error("missing cdk"), { status: 400 });

        const db = await pool.connect();
        try {
            await db.query("BEGIN");
            const found = await db.query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1 FOR UPDATE`, [safeTelegramId]);
            const user = found.rows[0];
            if (!user) throw Object.assign(new Error("user not found"), { status: 404 });
            if (user.is_banned) throw Object.assign(new Error("user banned"), { status: 403 });
            const cdkResult = await db.query("SELECT * FROM reader_cdks WHERE upper(code) = $1 FOR UPDATE", [cdkCode]);
            const cdk = cdkResult.rows[0];
            if (!cdk) throw Object.assign(new Error("CDK 不存在"), { status: 404 });
            if (cdk.used_by || cdk.used_at) throw Object.assign(new Error("CDK 已被使用"), { status: 409 });
            if (String(cdk.cdk_type || "membership") !== "export_quota") {
                throw Object.assign(new Error("这不是下载次数 CDK"), { status: 400 });
            }
            const count = nonNegativeInt(cdk.export_quota, 0);
            if (count <= 0) throw Object.assign(new Error("下载次数 CDK 配置无效"), { status: 400 });
            const updated = await db.query(
                `UPDATE reader_users
                 SET export_extra_quota = COALESCE(export_extra_quota, 0) + $1
                 WHERE id = $2
                 RETURNING ${botUserSelect()}`,
                [count, user.id]
            );
            await db.query("UPDATE reader_cdks SET used_by = $1, used_at = CURRENT_TIMESTAMP WHERE id = $2", [user.id, cdk.id]);
            await db.query(
                `INSERT INTO reader_transactions(user_id, telegram_id, type, currency, amount, balance, detail, source)
                 VALUES ($1,$2,'export_quota_cdk','copper',0,$3,$4,'telegram_bot')`,
                [user.id, safeTelegramId, nonNegativeInt(updated.rows[0].export_extra_quota, 0), `${cdk.code} +${count}`]
            );
            await db.query("COMMIT");
            return { user: updated.rows[0], cdk: { id: cdk.id, code: cdk.code, export_quota: count } };
        } catch (err) {
            await db.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            db.release();
        }
    }

    return {
        adjustUserCurrency,
        claimExtraExportQuota,
        claimDailyFreeExport,
        dailyFreeExportStatus,
        dbQuery,
        listTransactions,
        recordTransaction,
        redeemExportQuotaCdk,
        spendUserCurrency
    };
}

module.exports = { createUserCurrencyService };
