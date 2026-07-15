/**
 * [INPUT]: 依赖 Express、Bot Token 鉴权、书籍反馈/众筹/书评领域服务与 Bot 用户公开投影
 * [OUTPUT]: 对外提供 Bot 书籍反馈、众筹榜单/支持、书评列表/发布/投票路由工厂
 * [POS]: routes 的 Bot 社交协议适配层，只处理兼容字段和响应映射，余额与互动状态机由 services 承担
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function crowdPayload(result) {
    return {
        leaderboard: result.rows,
        stats: {
            total_books: result.total_books,
            total_votes: result.total_votes,
            total_silver: result.total_silver
        }
    };
}

function createBotApiSocialRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        botPublicUser,
        normalizeTelegramId,
        findBotUserByTelegramId,
        createBookFeedback,
        bookCrowdSummary,
        crowdLeaderboard,
        createCrowdVote,
        bookReviewById,
        createBookReview,
        listBookReviews,
        reviewMaxLength,
        reviewMinLength,
        reviewMinLevel,
        reviewPublishCost,
        voteBookReview,
        pushBookReviewToChannel
    } = deps;

    router.post("/bot-api/books/:bookId/feedback", requireBotApi, async (req, res, next) => {
        try {
            const result = await createBookFeedback({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                bookId: req.params.bookId,
                feedback: req.body?.feedback,
                source: req.body?.source || "info"
            });
            res.json({
                success: true,
                already_exists: result.already_exists,
                feedback: result.feedback,
                counts: result.counts
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    });

    router.get("/bot-api/books/:bookId/crowd", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            const summary = await bookCrowdSummary(req.params.bookId, telegramId);
            if (!summary) return res.status(404).json({ error: "book not found" });
            const leaderboard = await crowdLeaderboard(req.query.limit || 5, telegramId);
            res.json({ success: true, book: summary, ...crowdPayload(leaderboard) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/book-crowd", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            res.json({ success: true, ...crowdPayload(await crowdLeaderboard(req.query.limit || 10, telegramId)) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/books/:bookId/crowd", requireBotApi, async (req, res, next) => {
        try {
            const result = await createCrowdVote({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                bookId: req.params.bookId
            });
            res.json({
                success: true,
                already_exists: result.already_exists,
                vote_cost: result.vote_cost,
                user: botPublicUser(result.user),
                book: result.book,
                ...crowdPayload(result.leaderboard)
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    });

    router.get("/bot-api/books/:bookId/reviews", requireBotApi, async (req, res, next) => {
        try {
            const telegramId = normalizeTelegramId(req.query.telegram_id || req.query.telegramId || "");
            const viewer = telegramId ? await findBotUserByTelegramId(telegramId) : null;
            const result = await listBookReviews(req.params.bookId, {
                limit: req.query.limit || 10,
                offset: req.query.offset || 0,
                viewerUserId: viewer?.id || null
            });
            res.json({
                success: true,
                ...result,
                rules: {
                    min_level: reviewMinLevel,
                    cost_copper: reviewPublishCost,
                    min_length: reviewMinLength,
                    max_length: reviewMaxLength
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/books/:bookId/reviews", requireBotApi, async (req, res, next) => {
        try {
            if (typeof createBookReview !== "function") return res.status(503).json({ error: "book review service is not configured" });
            const result = await createBookReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                bookId: req.params.bookId,
                content: req.body?.content || req.body?.text || "",
                source: "telegram_bot"
            });
            let channel = { skipped: "not_configured" };
            if (typeof pushBookReviewToChannel === "function") {
                try {
                    channel = await pushBookReviewToChannel(result);
                } catch (error) {
                    channel = { ok: false, error: error.message || String(error) };
                }
            }
            const review =
                typeof bookReviewById === "function" ? await bookReviewById(result.review.id).catch(() => result.review) : result.review;
            res.json({
                success: true,
                cost: result.cost,
                review,
                book: result.book,
                user: botPublicUser(result.user),
                transaction: result.transaction,
                channel,
                rules: {
                    min_level: reviewMinLevel,
                    cost_copper: reviewPublishCost,
                    min_length: reviewMinLength,
                    max_length: reviewMaxLength
                }
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message, scholar: error.scholar || null });
            next(error);
        }
    });

    router.post("/bot-api/book-reviews/:reviewId/vote", requireBotApi, async (req, res, next) => {
        try {
            if (typeof voteBookReview !== "function") return res.status(503).json({ error: "book review service is not configured" });
            const result = await voteBookReview({
                telegramId: req.body?.telegram_id || req.body?.telegramId,
                reviewId: req.params.reviewId,
                vote: req.body?.vote || req.body?.feedback,
                source: "telegram_bot"
            });
            res.json({
                success: true,
                already_exists: result.already_exists,
                vote: result.vote,
                previous_vote: result.previous_vote || "",
                reward_delta: result.reward_delta,
                review: result.review,
                author: botPublicUser(result.author),
                voter: botPublicUser(result.voter),
                transaction: result.transaction || null
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            next(error);
        }
    });

    return router;
}

module.exports = { createBotApiSocialRoutes, crowdPayload };
