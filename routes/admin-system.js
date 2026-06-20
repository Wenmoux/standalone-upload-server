const express = require("express");

function createAdminSystemRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const healthService = options.healthService || {};
    const versionPayload = options.versionPayload || ((service) => ({ service }));
    const collectCachedSystemStatus = options.collectCachedSystemStatus || (async () => ({}));
    const collectDiagnostics = options.collectDiagnostics || (async () => ({}));
    const collectAdminSystemOverview = options.collectAdminSystemOverview || (async () => ({}));
    const collectDataQuality = options.collectDataQuality || (async () => ({}));
    const collectBotAdminOverview = options.collectBotAdminOverview || (async () => ({}));
    const botCommandSettings = options.botCommandSettings || (async () => ({ commands: [] }));
    const saveBotCommandSettings = options.saveBotCommandSettings || (async () => ({ commands: [] }));
    const listBotAuditLogs = options.listBotAuditLogs || (async () => ({ rows: [] }));
    const listSystemJobs = options.listSystemJobs || (async () => ({ rows: [] }));
    const getSystemJob = options.getSystemJob || (async () => null);
    const retrySystemJob = options.retrySystemJob;
    const cancelSystemJob = options.cancelSystemJob;
    const readLogTail = options.readLogTail || (() => "");
    const filterLogText = options.filterLogText || ((text) => String(text || ""));
    const configFile = options.configFile || process.env.PO18_CONFIG_FILE || "/config/app.env";
    const runtimeLogFile = options.runtimeLogFile || process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
    const serviceName = options.serviceName || "server-pg";
    const restartProcess = options.restartProcess || (() => process.exit(0));
    const restartDelayMsProvider = options.restartDelayMsProvider || (() => Number(process.env.PO18_ADMIN_RESTART_DELAY_MS || 1200));

    router.get("/admin-api/system/status", requireAdmin, async (req, res, next) => {
        try {
            const status = await collectCachedSystemStatus();
            const deep = await healthService.collectDeepHealth();
            res.json({
                ok: deep.ok,
                configFile,
                setupUrl: "/setup",
                version: versionPayload(serviceName),
                deep,
                status
            });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/system/diagnostics", requireAdmin, async (req, res, next) => {
        try {
            res.json(await collectDiagnostics(configFile, await collectCachedSystemStatus()));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/system/overview", requireAdmin, async (req, res, next) => {
        try {
            res.json(await collectAdminSystemOverview());
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/jobs", requireAdmin, async (req, res, next) => {
        try {
            res.json(await listSystemJobs({
                page: req.query.page,
                limit: req.query.limit,
                status: req.query.status,
                type: req.query.type
            }));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/jobs/:id", requireAdmin, async (req, res, next) => {
        try {
            const job = await getSystemJob(req.params.id);
            if (!job) return res.status(404).json({ error: "job not found" });
            res.json({ job });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/jobs/:id/retry", requireAdmin, async (req, res, next) => {
        try {
            if (typeof retrySystemJob !== "function") return res.status(503).json({ error: "job retry unavailable" });
            const payload = await retrySystemJob(req, req.params.id);
            if (!payload) return res.status(404).json({ error: "job not found" });
            res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/jobs/:id/cancel", requireAdmin, async (req, res, next) => {
        try {
            if (typeof cancelSystemJob !== "function") return res.status(503).json({ error: "job cancel unavailable" });
            const job = await cancelSystemJob(req.params.id, { actor: req.session?.adminUser?.username || "admin" });
            if (!job) return res.status(404).json({ error: "job not found" });
            res.json({ success: true, job });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/data-quality", requireAdmin, async (req, res, next) => {
        try {
            res.json(await collectDataQuality());
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/bot/overview", requireAdmin, async (req, res, next) => {
        try {
            res.json(await collectBotAdminOverview());
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/bot/commands", requireAdmin, async (req, res, next) => {
        try {
            res.json(await botCommandSettings());
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/bot/commands", requireAdmin, async (req, res, next) => {
        try {
            res.json(await saveBotCommandSettings(req.body || {}));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/bot/audit", requireAdmin, async (req, res, next) => {
        try {
            res.json(await listBotAuditLogs({
                limit: req.query.limit,
                status: req.query.status,
                command: req.query.command,
                telegramId: req.query.telegram_id || req.query.telegramId
            }));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/system/logs", requireAdmin, (req, res, next) => {
        try {
            const allowed = new Set(["all", "error", "database", "bot", "reader", "server", "setup"]);
            const filter = allowed.has(String(req.query.filter || "").toLowerCase())
                ? String(req.query.filter).toLowerCase()
                : "all";
            res.json({
                filter,
                file: runtimeLogFile,
                text: filterLogText(readLogTail(runtimeLogFile), filter)
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/system/restart", requireAdmin, (req, res) => {
        res.json({ success: true, restarting: true });
        setTimeout(restartProcess, Number(restartDelayMsProvider() || 1200)).unref?.();
    });

    return router;
}

module.exports = {
    createAdminSystemRoutes
};
