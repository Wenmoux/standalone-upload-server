const express = require("express");

function createRankRoutes(options = {}) {
    const router = express.Router();
    const rankService = options.rankService;
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const runTrackedJob = options.runTrackedJob;

    router.get("/reader-api/rank", async (req, res, next) => {
        try {
            res.json(await rankService.readerPayload(req.query));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/rank/status", requireAdmin, async (req, res, next) => {
        try {
            if (!rankService.cache.payload && !rankService.cache.loading) {
                await rankService.getPayload({ limit: req.query?.limit });
            }
            res.json(rankService.statusPayload());
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/rank/refresh", requireAdmin, async (req, res, next) => {
        try {
            const limit = req.body?.limit ?? req.query?.limit;
            const worker = async () => {
                await rankService.getPayload({ refresh: true, limit });
                const status = rankService.statusPayload();
                return {
                    success: true,
                    ...status,
                    jobResult: {
                        success: true,
                        ready: !!status.ready,
                        sourceLimit: status.sourceLimit || 0,
                        bookCount: status.bookCount || status.total || 0,
                        refreshedAt: status.at || status.updatedAt || null
                    }
                };
            };
            const payload = runTrackedJob
                ? await runTrackedJob(req, "rank_refresh", { limit: limit || null }, worker)
                : await worker();
            res.json(payload);
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    createRankRoutes
};
