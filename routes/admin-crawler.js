const express = require("express");

function actor(req) {
    return req?.session?.adminUser?.username || "admin";
}

function createAdminCrawlerRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const po18CrawlerService = options.po18CrawlerService;

    function serviceOrUnavailable(res) {
        if (po18CrawlerService) return po18CrawlerService;
        res.status(503).json({ error: "po18 crawler unavailable" });
        return null;
    }

    router.get("/admin-api/po18-crawler", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const config = await service.loadConfig();
            res.json({
                success: true,
                config: service.maskedConfig ? service.maskedConfig(config) : config,
                status: service.snapshot()
            });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin-api/po18-crawler/config", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const config = await service.saveConfig(req.body || {});
            res.json({
                success: true,
                config: service.maskedConfig ? service.maskedConfig(config) : config,
                status: service.snapshot()
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/po18-crawler/run", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const job = await service.runNow({ manual: true, ...(req.body || {}) }, actor(req));
            res.json({ success: true, job, status: service.snapshot() });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/po18-crawler/pause", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const changed = service.pause(req.body?.reason || `paused by ${actor(req)}`);
            res.json({ success: true, changed, status: service.snapshot() });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/po18-crawler/resume", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const changed = service.resume();
            res.json({ success: true, changed, status: service.snapshot() });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/po18-crawler/stop", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            const changed = service.stop();
            res.json({ success: true, changed, status: service.snapshot() });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/po18-crawler/test-cookie", requireAdmin, async (req, res, next) => {
        try {
            const service = serviceOrUnavailable(res);
            if (!service) return;
            res.json({ success: true, result: await service.testCookie(req.body || {}) });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    createAdminCrawlerRoutes
};
