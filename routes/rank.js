/**
 * [INPUT]: 依赖 Express、rank 服务、Admin 鉴权与可选 system_jobs 追踪器
 * [OUTPUT]: 对外提供 公共榜单、榜单状态和 Admin 显式刷新路由
 * [POS]: routes 的排行协议边界，把缓存读取与受控刷新映射为不同权限的 HTTP 接口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
