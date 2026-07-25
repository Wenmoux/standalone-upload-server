/**
 * [INPUT]: 依赖 Express、根级 Telegram 推送标记、Admin 权限、QQ/Telegram 配置、system-jobs/bot-settings/EPUB Style2 服务与输入校验
 * [OUTPUT]: 对外提供 平台、QQ/Telegram Bot、全员通知、导出计价、Bot 命令和 EPUB 模板/资源配置路由
 * [POS]: routes 的 Admin 配置边界，把持久配置、机器人凭据与高风险全员通知能力分组为受 owner 保护的 HTTP 契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const { markTelegramSystemPush } = require("../telegram-push-contract");
const { DEFAULT_STYLE2_CONFIG, STYLE2_BASE_CSS } = require("../services/epub-style2-template");

function createAdminConfigRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const requireOwner =
        options.requireOwner ||
        ((req, res, next) => {
            const role = String(req.session?.adminUser?.role || "owner")
                .trim()
                .toLowerCase();
            if (role !== "owner") return res.status(403).json({ error: "仅 owner 可以修改 Bot 凭据" });
            next();
        });
    const configGet = options.configGet || (async () => "");
    const configSet = options.configSet || (async () => {});
    const telegramLoginBotIdFromToken = options.telegramLoginBotIdFromToken || (() => "");
    const telegramPushConfig = options.telegramPushConfig || (async () => ({ enabled: false, pushTypes: [] }));
    const dailyReportConfig = options.dailyReportConfig || (async () => ({ enabled: false, time: "22:00", adminIds: "", lastDate: "" }));
    const dailyReportRecipients = options.dailyReportRecipients || (async () => []);
    const channelDailyReportRecipients = options.channelDailyReportRecipients || (async () => []);
    const parseTelegramPushTypes = options.parseTelegramPushTypes || ((value) => (Array.isArray(value) ? value : []));
    const parseDailyReportTime = options.parseDailyReportTime || ((value) => ({ value: String(value || "22:00") }));
    const platformConfigPayload = options.platformConfigPayload || (async () => ({ labels: {} }));
    const cleanPlatformKey = options.cleanPlatformKey || ((value) => String(value || "").trim());
    const exportPricingConfig = options.exportPricingConfig || (async () => ({}));
    const exportPricingPayload = options.exportPricingPayload || ((value) => value || {});
    const epubStyle2Assets = options.epubStyle2Assets;
    const sendDailyReport = options.sendDailyReport || (async () => ({ skipped: "not_configured" }));
    const postJson = options.postJson || (async () => {});
    const createSystemJob = options.createSystemJob;
    const countRegisteredUserRecipients = options.countRegisteredUserRecipients || (async () => 0);
    const qqBotConfig = options.qqBotConfig || (async () => ({ enabled: false, appSecretConfigured: false }));
    const updateQqBotConfig = options.updateQqBotConfig || (async () => ({}));
    const testQqBotConfig = options.testQqBotConfig || (async () => ({ ok: false }));

    router.get("/admin-api/config/qq-bot", requireAdmin, async (req, res, next) => {
        try {
            const [config, platforms, pricing] = await Promise.all([qqBotConfig(), platformConfigPayload(), exportPricingConfig()]);
            res.json({ ...config, platforms: platforms.platforms || [], epubStyles: pricing.epubStyles || [] });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/qq-bot", requireAdmin, requireOwner, async (req, res, next) => {
        try {
            res.json({ success: true, ...(await updateQqBotConfig(req.body || {})) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/config/qq-bot/test", requireAdmin, requireOwner, async (req, res, next) => {
        try {
            res.json({ success: true, ...(await testQqBotConfig()) });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/config/telegram", requireAdmin, async (req, res, next) => {
        try {
            const storedToken = await configGet("telegram_bot_token");
            const fallbackToken = process.env.PO18_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
            const effectiveToken = storedToken || fallbackToken;
            const loginBotId = telegramLoginBotIdFromToken(effectiveToken);
            const pushConfig = await telegramPushConfig();
            const reportConfig = await dailyReportConfig();
            const reportRecipients = [
                ...new Set([...(await dailyReportRecipients(reportConfig)), ...(await channelDailyReportRecipients())])
            ];
            res.json({
                enabled: pushConfig.enabled,
                pushTypes: pushConfig.pushTypes,
                botTokenConfigured: !!effectiveToken,
                botTokenLast4: effectiveToken ? String(effectiveToken).slice(-4) : "",
                chatId: await configGet("telegram_chat_id"),
                dailyReportEnabled: reportConfig.enabled,
                dailyReportTime: reportConfig.time,
                dailyReportAdminIds: reportConfig.adminIds,
                dailyReportRecipients: reportRecipients.length,
                dailyReportLastDate: reportConfig.lastDate,
                broadcastRecipients: await countRegisteredUserRecipients(),
                loginEnabled: !!loginBotId,
                loginBotId,
                loginTokenSource: storedToken ? "admin_config" : fallbackToken ? "env" : "",
                loginMaxAgeSeconds: Number(process.env.TELEGRAM_LOGIN_MAX_AGE_SECONDS || 86400)
            });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/telegram", requireAdmin, requireOwner, async (req, res, next) => {
        try {
            const selectedPushTypes = Object.prototype.hasOwnProperty.call(req.body || {}, "pushTypes")
                ? parseTelegramPushTypes(req.body.pushTypes)
                : (await telegramPushConfig()).pushTypes;
            await configSet("telegram_enabled", req.body.enabled ? "1" : "0");
            await configSet("telegram_push_types", JSON.stringify(selectedPushTypes));
            if (req.body?.clearBotToken === true) {
                await configSet("telegram_bot_token", "");
            } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "botToken")) {
                const nextToken = String(req.body.botToken || "").trim();
                if (nextToken) await configSet("telegram_bot_token", nextToken);
            }
            await configSet("telegram_chat_id", req.body.chatId || "");
            if ("dailyReportEnabled" in (req.body || {}))
                await configSet("telegram_daily_report_enabled", req.body.dailyReportEnabled ? "1" : "0");
            if ("dailyReportTime" in (req.body || {}))
                await configSet("telegram_daily_report_time", parseDailyReportTime(req.body.dailyReportTime).value);
            if ("dailyReportAdminIds" in (req.body || {}))
                await configSet("telegram_daily_report_admin_ids", String(req.body.dailyReportAdminIds || "").trim());
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
            if (!input || typeof input !== "object" || Array.isArray(input))
                return res.status(400).json({ error: "labels must be an object" });
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

    router.post("/admin-api/config/telegram/broadcast", requireAdmin, async (req, res, next) => {
        try {
            if (typeof createSystemJob !== "function") return res.status(503).json({ error: "全员通知任务服务未启用" });
            const message = String(req.body?.message || "").trim();
            if (String(req.body?.confirm || "").trim() !== "PUSH") return res.status(400).json({ error: "确认短语不匹配", expectedConfirm: "PUSH" });
            if (!message) return res.status(400).json({ error: "通知内容不能为空" });
            if (Array.from(message).length > 3000) return res.status(400).json({ error: "通知内容最多 3000 字" });
            const actor = req.session?.adminUser?.username || "admin";
            const job = await createSystemJob({
                type: "bot_registered_user_broadcast",
                input: { message, source: "admin", requested_by: actor },
                createdBy: `admin:${actor}`,
                maxAttempts: 1
            });
            res.json({ success: true, job, recipients: await countRegisteredUserRecipients() });
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
                paidChapterSilverCost:
                    req.body?.paidChapterSilverCost ?? req.body?.paid_chapter_silver_cost ?? current.paidChapterSilverCost,
                dailyQuotaByLevel: req.body?.dailyQuotaByLevel ?? req.body?.daily_quota_by_level ?? current.dailyQuotaByLevel,
                epub: req.body?.epub ?? req.body?.epub_config ?? current.epub
            });
            const writes = [
                configSet("bot_export_unlock_cost", String(nextConfig.unlockCost)),
                configSet("bot_export_free_copper_cost", String(nextConfig.freeCopperCost)),
                configSet("bot_export_paid_chapter_silver_cost", String(nextConfig.paidChapterSilverCost)),
                configSet("bot_export_daily_quota_by_level", JSON.stringify(nextConfig.dailyQuotaByLevel || {}))
            ];
            if (nextConfig.epub) writes.push(configSet("bot_epub_style_config", JSON.stringify(nextConfig.epub)));
            await Promise.all(writes);
            res.json({ success: true, ...nextConfig });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/config/export/style2-assets", requireAdmin, async (req, res, next) => {
        try {
            if (!epubStyle2Assets) return res.status(503).json({ error: "EPUB 样式图片服务未启用" });
            res.json({ rows: await epubStyle2Assets.listAssets() });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/config/export/style2-template", requireAdmin, async (req, res) => {
        res.json({ baseCss: STYLE2_BASE_CSS, defaults: DEFAULT_STYLE2_CONFIG });
    });

    router.get("/admin-api/config/export/style2-assets/:slot", requireAdmin, async (req, res, next) => {
        try {
            if (!epubStyle2Assets) return res.status(503).json({ error: "EPUB 样式图片服务未启用" });
            await epubStyle2Assets.sendAsset(req.params.slot, res);
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/config/export/style2-assets/:slot", requireAdmin, async (req, res, next) => {
        try {
            if (!epubStyle2Assets) return res.status(503).json({ error: "EPUB 样式图片服务未启用" });
            const asset = await epubStyle2Assets.uploadAsset(req.params.slot, req);
            res.json({ success: true, asset });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin-api/config/export/style2-assets/:slot", requireAdmin, async (req, res, next) => {
        try {
            if (!epubStyle2Assets) return res.status(503).json({ error: "EPUB 样式图片服务未启用" });
            const asset = await epubStyle2Assets.restoreAsset(req.params.slot);
            res.json({ success: true, asset });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/config/telegram/test", requireAdmin, async (req, res, next) => {
        try {
            const token = await configGet("telegram_bot_token");
            const chatId = await configGet("telegram_chat_id");
            if (!token || !chatId) return res.status(400).json({ error: "请先保存 Bot Token 和 Chat ID" });
            await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: markTelegramSystemPush("PO18 上传管理服务测试消息")
            });
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
