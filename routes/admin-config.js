const express = require("express");

function createAdminConfigRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});
    const telegramLoginBotIdFromToken = options.telegramLoginBotIdFromToken || (() => "");
    const telegramPushConfig = options.telegramPushConfig || (async () => ({ enabled: false, pushTypes: [] }));
    const dailyReportConfig = options.dailyReportConfig || (async () => ({ enabled: false, time: "22:00", adminIds: "", lastDate: "" }));
    const dailyReportRecipients = options.dailyReportRecipients || (async () => []);
    const channelDailyReportRecipients = options.channelDailyReportRecipients || (async () => []);
    const parseTelegramPushTypes = options.parseTelegramPushTypes || ((value) => Array.isArray(value) ? value : []);
    const parseDailyReportTime = options.parseDailyReportTime || ((value) => ({ value: String(value || "22:00") }));
    const platformConfigPayload = options.platformConfigPayload || (async () => ({ labels: {} }));
    const cleanPlatformKey = options.cleanPlatformKey || ((value) => String(value || "").trim());
    const exportPricingConfig = options.exportPricingConfig || (async () => ({}));
    const exportPricingPayload = options.exportPricingPayload || ((value) => value || {});
    const sendDailyReport = options.sendDailyReport || (async () => ({ skipped: "not_configured" }));
    const postJson = options.postJson || (async () => {});

    router.get("/admin-api/config/telegram", requireAdmin, async (req, res, next) => {
        try {
            const storedToken = await configGet("telegram_bot_token");
            const fallbackToken = process.env.PO18_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
            const effectiveToken = storedToken || fallbackToken;
            const loginBotId = telegramLoginBotIdFromToken(effectiveToken);
            const pushConfig = await telegramPushConfig();
            const reportConfig = await dailyReportConfig();
            const reportRecipients = [...new Set([
                ...(await dailyReportRecipients(reportConfig)),
                ...(await channelDailyReportRecipients())
            ])];
            res.json({
                enabled: pushConfig.enabled,
                pushTypes: pushConfig.pushTypes,
                botToken: storedToken,
                chatId: await configGet("telegram_chat_id"),
                dailyReportEnabled: reportConfig.enabled,
                dailyReportTime: reportConfig.time,
                dailyReportAdminIds: reportConfig.adminIds,
                dailyReportRecipients: reportRecipients.length,
                dailyReportLastDate: reportConfig.lastDate,
                loginEnabled: !!loginBotId,
                loginBotId,
                loginTokenSource: storedToken ? "admin_config" : (fallbackToken ? "env" : ""),
                loginMaxAgeSeconds: Number(process.env.TELEGRAM_LOGIN_MAX_AGE_SECONDS || 86400)
            });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/telegram", requireAdmin, async (req, res, next) => {
        try {
            const selectedPushTypes = Object.prototype.hasOwnProperty.call(req.body || {}, "pushTypes")
                ? parseTelegramPushTypes(req.body.pushTypes)
                : (await telegramPushConfig()).pushTypes;
            await configSet("telegram_enabled", req.body.enabled ? "1" : "0");
            await configSet("telegram_push_types", JSON.stringify(selectedPushTypes));
            await configSet("telegram_bot_token", req.body.botToken || "");
            await configSet("telegram_chat_id", req.body.chatId || "");
            if ("dailyReportEnabled" in (req.body || {})) await configSet("telegram_daily_report_enabled", req.body.dailyReportEnabled ? "1" : "0");
            if ("dailyReportTime" in (req.body || {})) await configSet("telegram_daily_report_time", parseDailyReportTime(req.body.dailyReportTime).value);
            if ("dailyReportAdminIds" in (req.body || {})) await configSet("telegram_daily_report_admin_ids", String(req.body.dailyReportAdminIds || "").trim());
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/config/platforms", requireAdmin, async (req, res, next) => {
        try {
            res.json(await platformConfigPayload());
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/platforms", requireAdmin, async (req, res, next) => {
        try {
            const input = req.body?.labels || {};
            if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ error: "labels must be an object" });
            const labels = {};
            for (const [key, label] of Object.entries(input)) {
                const cleanKey = cleanPlatformKey(key);
                const cleanLabel = String(label || "").trim();
                if (cleanKey && cleanLabel) labels[cleanKey] = cleanLabel;
            }
            await configSet("platform_labels", JSON.stringify(labels));
            res.json({ success: true, ...(await platformConfigPayload()) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/config/telegram/daily-report/test", requireAdmin, async (req, res, next) => {
        try {
            const result = await sendDailyReport({ force: true });
            if (result.skipped) return res.status(400).json({ error: result.skipped });
            res.json({ success: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/config/export", requireAdmin, async (req, res, next) => {
        try {
            res.json(await exportPricingConfig());
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/export", requireAdmin, async (req, res, next) => {
        try {
            const current = await exportPricingConfig();
            const nextConfig = exportPricingPayload({
                unlockCost: req.body?.unlockCost ?? req.body?.unlock_cost ?? current.unlockCost,
                freeCopperCost: req.body?.freeCopperCost ?? req.body?.free_copper_cost ?? current.freeCopperCost,
                paidChapterSilverCost: req.body?.paidChapterSilverCost ?? req.body?.paid_chapter_silver_cost ?? current.paidChapterSilverCost
            });
            await Promise.all([
                configSet("bot_export_unlock_cost", String(nextConfig.unlockCost)),
                configSet("bot_export_free_copper_cost", String(nextConfig.freeCopperCost)),
                configSet("bot_export_paid_chapter_silver_cost", String(nextConfig.paidChapterSilverCost))
            ]);
            res.json({ success: true, ...nextConfig });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/config/telegram/test", requireAdmin, async (req, res, next) => {
        try {
            const token = await configGet("telegram_bot_token");
            const chatId = await configGet("telegram_chat_id");
            if (!token || !chatId) return res.status(400).json({ error: "请先保存 Bot Token 和 Chat ID" });
            await postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: "PO18 上传管理服务测试消息" });
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    createAdminConfigRoutes
};
