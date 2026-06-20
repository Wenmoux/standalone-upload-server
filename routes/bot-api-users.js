const crypto = require("crypto");
const express = require("express");
const { bodyNumber, bodyString, enumValue, trimString } = require("../services/validation");

function createBotApiUserRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        query,
        hashPassword,
        botUserSelect,
        botPublicUser,
        normalizeTelegramId,
        botUsernameForTelegram,
        findBotUserByTelegramId,
        recordTransaction,
        listTransactions,
        exportPricingConfig,
        dailyFreeExportStatus,
        claimDailyFreeExport,
        spendUserCurrency,
        todayDateKey,
        positiveNumber,
        signExpReward,
        scholarProfile
    } = deps;

    router.get("/bot-api/users/:telegramId", requireBotApi, async (req, res, next) => {
        try {
            res.json({ user: botPublicUser(await findBotUserByTelegramId(req.params.telegramId)) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/register", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(bodyString(req.body, ["telegram_id", "telegramId"], { required: true, message: "missing telegram_id" }));
            if (!telegramId) return res.status(400).json({ error: "missing telegram_id" });
            const telegramUsername = trimString(req.body?.telegram_username ?? req.body?.telegramUsername ?? "", 64).replace(/^@/, "").slice(0, 64);
            const username = trimString(req.body?.username || botUsernameForTelegram(telegramId), 32);
            const nickname = trimString(req.body?.nickname || req.body?.display_name || telegramUsername || username, 32);
            const inviterTelegramId = normalizeTelegramId(req.body?.inviter_telegram_id || req.body?.inviterTelegramId);
            const copper = bodyNumber(req.body, ["copper_coins", "copper"], { defaultValue: 100, message: "invalid copper" });
            const silver = bodyNumber(req.body, ["silver_coins", "silver"], { defaultValue: 0, message: "invalid silver" });
            const signCycleDay = bodyNumber(req.body, ["sign_cycle_day", "signStreak"], { defaultValue: 0, integer: true, min: 0, message: "invalid sign_cycle_day" });
            const lastSignDate = trimString(req.body?.last_sign_date ?? req.body?.sign_date ?? "") || null;
            const isAdmin = !!req.body?.is_admin;
            const isBanned = !!req.body?.is_banned;
            const existing = await findBotUserByTelegramId(telegramId);
            if (existing) return res.json({ success: true, existed: true, user: botPublicUser(existing) });
            const found = await query("SELECT id FROM reader_users WHERE username = $1", [username]);
            const finalUsername = found.rows.length ? `${botUsernameForTelegram(telegramId)}_${Date.now().toString(36).slice(-4)}`.slice(0, 32) : username;
            const { salt, hash } = hashPassword(crypto.randomBytes(18).toString("base64url"));
            const created = await query(
                `INSERT INTO reader_users(username, password_hash, salt, nickname, library_access, membership_permanent,
                                          copper_coins, silver_coins, sign_cycle_day, last_sign_date,
                                          telegram_id, telegram_username, is_admin, is_banned, inviter_telegram_id)
                 VALUES ($1,$2,$3,$4,TRUE,TRUE,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                 RETURNING ${botUserSelect()}`,
                [finalUsername, hash, salt, nickname || finalUsername, copper, silver, signCycleDay, lastSignDate, telegramId, telegramUsername, isAdmin, isBanned, inviterTelegramId]
            );
            if (copper) await recordTransaction({ userId: created.rows[0].id, telegramId, type: "register", currency: "copper", amount: copper, balance: created.rows[0].copper_coins, detail: "注册赠送", source: "telegram_bot" });
            if (silver) await recordTransaction({ userId: created.rows[0].id, telegramId, type: "register", currency: "silver", amount: silver, balance: created.rows[0].silver_coins, detail: "注册赠送", source: "telegram_bot" });
            if (inviterTelegramId && inviterTelegramId !== telegramId) {
                await query("UPDATE reader_users SET invite_count = COALESCE(invite_count, 0) + 1 WHERE telegram_id = $1", [inviterTelegramId]);
            }
            res.json({ success: true, existed: false, user: botPublicUser(created.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/import", requireBotApi, async (req, res, next) => {
        try {
            const rows = Array.isArray(req.body?.users) ? req.body.users : [];
            const result = { imported: 0, updated: 0, skipped: 0 };
            for (const row of rows) {
                const telegramId = normalizeTelegramId(row.telegram_id || row.telegramId || row.user_id || row.userId);
                if (!telegramId) {
                    result.skipped += 1;
                    continue;
                }
                const username = String(row.username || botUsernameForTelegram(telegramId)).trim().replace(/^@/, "").slice(0, 32) || botUsernameForTelegram(telegramId);
                const telegramUsername = String(row.telegram_username || row.telegramUsername || row.username || "").trim().replace(/^@/, "").slice(0, 64);
                const nickname = String(row.nickname || row.display_name || row.displayName || username).trim().slice(0, 32) || username;
                let finalUsername = botUsernameForTelegram(telegramId);
                const usernameConflict = await query("SELECT id FROM reader_users WHERE username = $1 AND COALESCE(telegram_id, '') <> $2", [finalUsername, telegramId]);
                if (usernameConflict.rows.length) finalUsername = `${finalUsername}_${Date.now().toString(36).slice(-4)}`.slice(0, 32);
                const copper = Number(row.copper_coins ?? row.copper ?? 0);
                const silver = Number(row.silver_coins ?? row.silver ?? 0);
                const signCycleDay = Number(row.sign_cycle_day ?? row.signStreak ?? row.sign_streak ?? 0);
                const lastSignDate = String(row.last_sign_date || row.sign_date || "").trim() || null;
                const isAdmin = !!Number(row.is_admin || 0);
                const isBanned = !!Number(row.is_banned || 0);
                const inviteCount = Number(row.invite_count || 0);
                const inviterTelegramId = normalizeTelegramId(row.inviter_telegram_id || row.inviter_id || "");
                const exportUnlockedAt = String(row.export_unlocked_at || row.unlocked_at || "").trim() || null;
                const createdAt = String(row.created_at || "").trim() || null;
                const { salt, hash } = hashPassword(crypto.randomBytes(18).toString("base64url"));
                const inserted = await query(
                    `INSERT INTO reader_users(username, password_hash, salt, nickname, created_at, library_access, membership_permanent,
                                              copper_coins, silver_coins, sign_cycle_day, last_sign_date,
                                              telegram_id, telegram_username, is_admin, is_banned, invite_count, inviter_telegram_id, export_unlocked_at)
                     VALUES ($1,$2,$3,$4,COALESCE($5::timestamp, CURRENT_TIMESTAMP),$6,TRUE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                     ON CONFLICT (telegram_id) DO UPDATE SET
                        nickname = EXCLUDED.nickname,
                        telegram_username = EXCLUDED.telegram_username,
                        copper_coins = EXCLUDED.copper_coins,
                        silver_coins = EXCLUDED.silver_coins,
                        sign_cycle_day = EXCLUDED.sign_cycle_day,
                        last_sign_date = EXCLUDED.last_sign_date,
                        is_admin = EXCLUDED.is_admin,
                        is_banned = EXCLUDED.is_banned,
                        invite_count = EXCLUDED.invite_count,
                        inviter_telegram_id = EXCLUDED.inviter_telegram_id,
                        export_unlocked_at = COALESCE(EXCLUDED.export_unlocked_at, reader_users.export_unlocked_at)
                     RETURNING xmax = 0 AS inserted`,
                    [finalUsername, hash, salt, nickname, createdAt, !isBanned, copper, silver, signCycleDay, lastSignDate, telegramId, telegramUsername, isAdmin, isBanned, inviteCount, inviterTelegramId, exportUnlockedAt]
                );
                if (inserted.rows[0]?.inserted) result.imported += 1;
                else result.updated += 1;
            }
            res.json({ success: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/bot-api/users/:telegramId/currency", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.params.telegramId);
            const currencyName = enumValue(String(req.body?.currency || "copper").toLowerCase(), ["copper", "silver"], { defaultValue: "copper", name: "currency" });
            const currency = currencyName === "silver" ? "silver_coins" : "copper_coins";
            const delta = bodyNumber(req.body, "delta", { defaultValue: 0, integer: true, message: "delta must be a finite integer" });
            if (!delta) return res.status(400).json({ error: "delta must not be zero" });
            const updated = await query(
                `UPDATE reader_users SET ${currency} = GREATEST(0, COALESCE(${currency}, 0) + $1)
                 WHERE telegram_id = $2
                 RETURNING ${botUserSelect()}`,
                [delta, telegramId]
            );
            if (!updated.rows.length) return res.status(404).json({ error: "user not found" });
            await recordTransaction({
                userId: updated.rows[0].id,
                telegramId,
                type: req.body?.type || "admin_give",
                currency: currencyName,
                amount: delta,
                balance: updated.rows[0][currency],
                detail: req.body?.detail || "管理员发币",
                source: "telegram_bot"
            });
            res.json({ success: true, user: botPublicUser(updated.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/users/:telegramId/export-permission", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const bookId = String(req.query.book_id || req.query.bookId || "").trim();
            res.json({
                unlocked: !!user.export_unlocked_at || !!user.is_admin,
                user: botPublicUser(user),
                pricing: await exportPricingConfig(),
                free_export: await dailyFreeExportStatus(user, query, bookId)
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/export-free-claim", requireBotApi, async (req, res, next) => {
        try {
            const result = await claimDailyFreeExport({
                telegramId: req.params.telegramId,
                bookId: req.body?.book_id || req.body?.bookId,
                format: req.body?.format || ""
            });
            res.json({ success: true, user: botPublicUser(result.user), usage: result.usage });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message, quota: err.quota || null });
            next(err);
        }
    });

    router.get("/bot-api/export-pricing", requireBotApi, async (req, res, next) => {
        try {
            res.json({ pricing: await exportPricingConfig() });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/export-unlock", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.params.telegramId);
            const cost = (await exportPricingConfig()).unlockCost;
            const current = await findBotUserByTelegramId(telegramId);
            if (!current) return res.status(404).json({ error: "user not found" });
            if (current.export_unlocked_at || current.is_admin) return res.json({ success: true, unlocked: true, cost: 0, user: botPublicUser(current) });
            const result = await spendUserCurrency({
                telegramId,
                currency: "silver",
                amount: cost,
                type: "export_unlock",
                detail: "开通导出授权",
                source: "telegram_bot",
                setExportUnlocked: true,
                allowZero: true
            });
            res.json({ success: true, unlocked: true, cost: result.amount, user: botPublicUser(result.user), transaction: result.transaction });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/spend", requireBotApi, async (req, res, next) => {
        try {
            const result = await spendUserCurrency({
                telegramId: req.params.telegramId,
                currency: req.body?.currency || "copper",
                amount: req.body?.amount || 0,
                type: req.body?.type || "spend",
                detail: req.body?.detail || "",
                source: req.body?.source || "telegram_bot"
            });
            res.json({ success: true, amount: result.amount, currency: result.currency, user: botPublicUser(result.user), transaction: result.transaction });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/sign", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.params.telegramId);
            const user = await findBotUserByTelegramId(telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            if (user.is_banned) return res.status(403).json({ error: "user banned" });
            const today = todayDateKey();
            const last = user.last_sign_date instanceof Date
                ? new Date(user.last_sign_date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
                : String(user.last_sign_date || "").slice(0, 10);
            if (last === today) return res.status(409).json({ error: "今天已经签到过了" });
            const nextDay = Number(user.sign_cycle_day || 0) >= 7 ? 1 : Number(user.sign_cycle_day || 0) + 1;
            const copper = Number(req.body?.copper || 100);
            const silver = nextDay === 7 ? Number(req.body?.silver || 100) : 0;
            const exp = Math.trunc(positiveNumber(req.body?.exp, signExpReward(nextDay), 1));
            const beforeScholar = scholarProfile(user.scholar_exp);
            const updated = await query(
                `UPDATE reader_users
                 SET copper_coins = COALESCE(copper_coins,0) + $1,
                      silver_coins = COALESCE(silver_coins,0) + $2,
                      scholar_exp = COALESCE(scholar_exp,0) + $3,
                      sign_cycle_day = $4,
                      last_sign_date = $5::date
                  WHERE telegram_id = $6
                    AND (last_sign_date IS NULL OR last_sign_date <> $5::date)
                  RETURNING ${botUserSelect()}`,
                [copper, silver, exp, nextDay, today, telegramId]
            );
            if (!updated.rows.length) return res.status(409).json({ error: "今天已经签到过了" });
            const afterScholar = scholarProfile(updated.rows[0].scholar_exp);
            await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign",
                currency: "copper",
                amount: copper,
                balance: updated.rows[0].copper_coins,
                detail: `每日签到 day=${nextDay}`,
                source: "telegram_bot"
            });
            await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign_exp",
                currency: "exp",
                amount: exp,
                balance: updated.rows[0].scholar_exp,
                detail: `每日签到 day=${nextDay}`,
                source: "telegram_bot"
            });
            if (silver) await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign",
                currency: "silver",
                amount: silver,
                balance: updated.rows[0].silver_coins,
                detail: `每日签到 day=${nextDay}`,
                source: "telegram_bot"
            });
            res.json({ success: true, reward: { copper, silver, exp, day: nextDay, scholar: afterScholar, level_up: afterScholar.level > beforeScholar.level }, user: botPublicUser(updated.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/top", requireBotApi, async (req, res, next) => {
        try {
            const currencyName = enumValue(String(req.query.currency || "copper").toLowerCase(), ["copper", "silver", "exp"], { defaultValue: "copper", name: "currency" });
            const column = currencyName === "silver" ? "silver_coins" : currencyName === "exp" ? "scholar_exp" : "copper_coins";
            const secondaryColumn = currencyName === "silver" ? "copper_coins" : "silver_coins";
            const limit = bodyNumber(req.query, "limit", { defaultValue: 10, integer: true, min: 1, max: 50, message: "invalid limit" });
            const rows = await query(
                `SELECT ${botUserSelect()}
                 FROM reader_users
                 WHERE COALESCE(is_banned, FALSE) = FALSE
                 ORDER BY COALESCE(${column}, 0) DESC, COALESCE(${secondaryColumn}, 0) DESC, id ASC
                 LIMIT $1`,
                [limit]
            );
            res.json({ currency: currencyName, rows: rows.rows.map(botPublicUser) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/users/:telegramId/transactions", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const result = await listTransactions({
                telegramId: user.telegram_id,
                limit: bodyNumber(req.query, "limit", { defaultValue: 20, integer: true, min: 1, max: 200, message: "invalid limit" }),
                offset: bodyNumber(req.query, "offset", { defaultValue: 0, integer: true, min: 0, message: "invalid offset" }),
                type: req.query.type || "",
                currency: req.query.currency || ""
            });
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/transactions", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const currency = enumValue(String(req.body?.currency || "copper").toLowerCase(), ["copper", "silver", "exp"], { defaultValue: "copper", name: "currency" });
            const amount = bodyNumber(req.body, "amount", { defaultValue: 0, integer: true, message: "invalid amount" });
            const balance = currency === "silver" ? user.silver_coins : currency === "exp" ? user.scholar_exp : user.copper_coins;
            const tx = await recordTransaction({
                userId: user.id,
                telegramId: user.telegram_id,
                type: req.body?.type || "event",
                currency,
                amount,
                balance,
                detail: req.body?.detail || "",
                source: req.body?.source || "telegram_bot"
            });
            res.json({ success: true, transaction: tx });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/users/:telegramId/me", requireBotApi, async (req, res, next) => {
        try {
            const user = await findBotUserByTelegramId(req.params.telegramId);
            if (!user) return res.status(404).json({ error: "user not found" });
            const [bookshelf, downloads, shares, freeExport] = await Promise.all([
                query("SELECT COUNT(*)::int count FROM reader_bookshelf WHERE user_id = $1", [user.id]),
                query(
                    `SELECT COUNT(*)::int count
                     FROM reader_transactions
                     WHERE user_id = $1
                       AND source = 'telegram_bot'
                       AND type IN ('export_txt', 'export_epub', 'export_download', 'export')`,
                    [user.id]
                ),
                query(
                    `SELECT COUNT(*)::int count
                     FROM upload_events
                     WHERE source = 'telegram_bot'
                       AND (
                            uploader_id = $1
                            OR details->>'uploaderId' = $1
                            OR details->>'telegram_id' = $1
                        )`,
                    [String(user.telegram_id || req.params.telegramId)]
                ),
                dailyFreeExportStatus(user)
            ]);
            res.json({
                user: botPublicUser(user),
                stats: {
                    bookshelf_count: bookshelf.rows[0]?.count || 0,
                    download_count: downloads.rows[0]?.count || 0,
                    share_count: shares.rows[0]?.count || 0,
                    export_unlocked: !!user.export_unlocked_at || !!user.is_admin,
                    free_export: freeExport
                }
            });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/users/by-telegram-username/:username", requireBotApi, async (req, res, next) => {
        try {
            const username = String(req.params.username || "").trim().replace(/^@/, "").toLowerCase();
            if (!username) return res.status(400).json({ error: "missing username" });
            const found = await query(
                `SELECT ${botUserSelect()} FROM reader_users WHERE lower(COALESCE(telegram_username, '')) = $1 LIMIT 1`,
                [username]
            );
            res.json({ user: botPublicUser(found.rows[0]) });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = { createBotApiUserRoutes };
