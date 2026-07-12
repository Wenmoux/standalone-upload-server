/**
 * [INPUT]: 依赖 Express、Reader/Bot/Admin 三类鉴权与 review-governance 领域服务
 * [OUTPUT]: 对外提供 书评举报、申诉、个人申诉列表和 Admin 审核决议路由
 * [POS]: routes 的书评治理协议边界，在同一状态机上隔离读者、Bot 和审核员权限
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createReviewGovernanceRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const requireReader = options.requireReader || ((req, res, next) => next());
    const requireBotApi = options.requireBotApi || ((req, res, next) => next());
    const currentReaderUser = options.currentReaderUser;
    const service = options.service;

    router.post("/reader-api/book-reviews/:reviewId/report", requireReader, async (req, res, next) => {
        try {
            const user = await currentReaderUser(req);
            res.json(await service.reportReview({ userId: user?.id, reviewId: req.params.reviewId, reason: req.body?.reason, details: req.body?.details }));
        } catch (error) {
            next(error);
        }
    });

    router.post("/reader-api/book-reviews/:reviewId/appeals", requireReader, async (req, res, next) => {
        try {
            const user = await currentReaderUser(req);
            res.json(await service.appealReview({ userId: user?.id, reviewId: req.params.reviewId, content: req.body?.content }));
        } catch (error) {
            next(error);
        }
    });

    router.get("/reader-api/book-review-appeals", requireReader, async (req, res, next) => {
        try {
            const user = await currentReaderUser(req);
            res.json(await service.listUserAppeals(user?.id));
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/book-reviews/:reviewId/report", requireBotApi, async (req, res, next) => {
        try {
            res.json(await service.reportReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                reviewId: req.params.reviewId,
                reason: req.body?.reason,
                details: req.body?.details
            }));
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/book-reviews/:reviewId/appeals", requireBotApi, async (req, res, next) => {
        try {
            res.json(await service.appealReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                reviewId: req.params.reviewId,
                content: req.body?.content
            }));
        } catch (error) {
            next(error);
        }
    });

    router.get("/admin-api/review-moderation", requireAdmin, async (req, res, next) => {
        try {
            res.json(await service.listModeration(req.query));
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin-api/review-moderation/reports/:reportId/resolve", requireAdmin, async (req, res, next) => {
        try {
            res.json(await service.resolveReport({
                reportId: req.params.reportId,
                adminId: req.session?.admin?.id,
                action: req.body?.action,
                note: req.body?.note || req.body?.reason
            }));
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin-api/review-moderation/appeals/:appealId/resolve", requireAdmin, async (req, res, next) => {
        try {
            res.json(await service.resolveAppeal({
                appealId: req.params.appealId,
                adminId: req.session?.admin?.id,
                action: req.body?.action,
                note: req.body?.note || req.body?.reason
            }));
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createReviewGovernanceRoutes };
