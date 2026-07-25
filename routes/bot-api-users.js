/**
 * [INPUT]: 依赖 Express、Bot Scope、Reader 账户/签到、用户经济/认证服务与 Telegram/QQ 命名空间身份参数
 * [OUTPUT]: 对外提供 Bot 用户注册、签到、余额流水、转账、CDK、额度及 PO18 凭据内部路由
 * [POS]: routes 的 Bot 用户适配层，把跨渠道命名空间身份映射到事务服务，避免 Bot 进程持有数据库权限
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { bodyNumber, bodyString, enumValue, trimString } = require("../services/validation");

function internalIdempotency(body = {}) {
    const key = trimString(body.idempotency_key ?? body.idempotencyKey ?? "", 240);
    const scope = trimString(body.idempotency_scope ?? body.idempotencyScope ?? "", 120);
    const bookId = trimString(body.book_id ?? body.bookId ?? "", 240);
    const format = trimString(body.format ?? "", 16).toLowerCase();
    return {
        idempotencyKey: key,
        idempotencyScope: scope,
        idempotencyData: { ...(bookId ? { book_id: bookId } : {}), ...(format ? { format } : {}) }
    };
}

function createBotApiUserRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        query,
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
        claimExtraExportQuota,
        redeemExportQuotaCdk,
        spendUserCurrency,
        adjustUserCurrency,
        registerBotUser,
        importBotUsers,
        checkInUser
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
            const telegramId = normalizeTelegramId(
                bodyString(req.body, ["telegram_id", "telegramId"], { required: true, message: "missing telegram_id" })
            );
            if (!telegramId) return res.status(400).json({ error: "missing telegram_id" });
            const telegramUsername = trimString(req.body?.telegram_username ?? req.body?.telegramUsername ?? "", 64)
                .replace(/^@/, "")
                .slice(0, 64);
            const nickname = trimString(
                req.body?.nickname || req.body?.display_name || telegramUsername || botUsernameForTelegram(telegramId),
                32
            );
            const inviterTelegramId = normalizeTelegramId(req.body?.inviter_telegram_id || req.body?.inviterTelegramId);
            const result = await registerBotUser({ telegramId, telegramUsername, nickname, inviterTelegramId });
            res.json({ success: true, existed: result.existed, user: botPublicUser(result.user) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/bot-api/users/import", requireBotApi, async (req, res, next) => {
        try {
            const result = await importBotUsers(req.body?.users);
            res.json({ success: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/bot-api/users/:telegramId/currency", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.params.telegramId);
            const currencyName = enumValue(String(req.body?.currency || "copper").toLowerCase(), ["copper", "silver"], {
                defaultValue: "copper",
                name: "currency"
            });
            const delta = bodyNumber(req.body, "delta", {
                defaultValue: 0,
                integer: true,
                min: -1000000000,
                max: 1000000000,
                message: "delta must be a finite integer"
            });
            if (!delta) return res.status(400).json({ error: "delta must not be zero" });
            const type = trimString(req.body?.type || "admin_give", 64);
            const idempotency = internalIdempotency(req.body || {});
            if (type === "po18_bookshelf_share_reward" && (!idempotency.idempotencyKey || !idempotency.idempotencyData.book_id)) {
                return res.status(400).json({ error: "share reward requires idempotency_key and book_id" });
            }
            if (typeof adjustUserCurrency !== "function") return res.status(503).json({ error: "currency service is not configured" });
            const result = await adjustUserCurrency({
                telegramId,
                currency: currencyName,
                delta,
                type,
                detail: req.body?.detail || "管理员发币",
                source: "telegram_bot",
                ...idempotency
            });
            res.json({
                success: true,
                repeated: !!result.repeated,
                user: botPublicUser(result.user),
                transaction: result.transaction || null
            });
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
                free_export: await dailyFreeExportStatus(user, query, bookId),
                extra_export_quota: Number(user.export_extra_quota || 0)
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
                format: req.body?.format || "",
                ...internalIdempotency(req.body || {})
            });
            res.json({ success: true, user: botPublicUser(result.user), usage: result.usage });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message, quota: err.quota || null });
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/export-extra-claim", requireBotApi, async (req, res, next) => {
        try {
            if (typeof claimExtraExportQuota !== "function")
                return res.status(503).json({ error: "extra export quota service is not configured" });
            const result = await claimExtraExportQuota({
                telegramId: req.params.telegramId,
                bookId: req.body?.book_id || req.body?.bookId,
                format: req.body?.format || "",
                ...internalIdempotency(req.body || {})
            });
            res.json({ success: true, user: botPublicUser(result.user), usage: result.usage });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message, quota: err.quota || null });
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/redeem-cdk", requireBotApi, async (req, res, next) => {
        try {
            if (typeof redeemExportQuotaCdk !== "function") return res.status(503).json({ error: "CDK redeem service is not configured" });
            const result = await redeemExportQuotaCdk({
                telegramId: req.params.telegramId,
                code: req.body?.code || req.body?.cdk || ""
            });
            res.json({ success: true, user: botPublicUser(result.user), cdk: result.cdk });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
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
            if (current.export_unlocked_at || current.is_admin)
                return res.json({ success: true, unlocked: true, cost: 0, user: botPublicUser(current) });
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
            res.json({
                success: true,
                unlocked: true,
                cost: result.amount,
                user: botPublicUser(result.user),
                transaction: result.transaction
            });
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
                source: req.body?.source || "telegram_bot",
                ...internalIdempotency(req.body || {})
            });
            res.json({
                success: true,
                repeated: !!result.repeated,
                amount: result.amount,
                currency: result.currency,
                user: botPublicUser(result.user),
                transaction: result.transaction
            });
        } catch (err) {
            if (err.status) return res.status(err.status).json({ error: err.message });
            next(err);
        }
    });

    router.post("/bot-api/users/:telegramId/sign", requireBotApi, async (req, res, next) => {
        try {
            const source = enumValue(req.body?.source, ["telegram_bot", "qq_bot"], {
                defaultValue: "telegram_bot",
                name: "sign source"
            });
            const result = await checkInUser({ telegramId: req.params.telegramId, source });
            res.json({ success: true, reward: result.reward, user: botPublicUser(result.user) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/bot-api/top", requireBotApi, async (req, res, next) => {
        try {
            const currencyName = enumValue(String(req.query.currency || "copper").toLowerCase(), ["copper", "silver", "exp"], {
                defaultValue: "copper",
                name: "currency"
            });
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
            const amount = bodyNumber(req.body, "amount", { defaultValue: 0, integer: true, message: "invalid amount" });
            if (amount !== 0) return res.status(400).json({ error: "event transaction amount must be zero" });
            const tx = await recordTransaction({
                userId: user.id,
                telegramId: user.telegram_id,
                type: trimString(req.body?.type || "event", 64),
                currency: "copper",
                amount: 0,
                balance: user.copper_coins,
                detail: req.body?.detail || "",
                source: "telegram_bot"
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
            const username = String(req.params.username || "")
                .trim()
                .replace(/^@/, "")
                .toLowerCase();
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
