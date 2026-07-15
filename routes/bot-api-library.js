/**
 * [INPUT]: 依赖 Express、Bot Token 鉴权、Bot 书库持久化服务、批量热词与词云查询
 * [OUTPUT]: 对外提供 Bot PO18 账户、书架、缺书请求、热词、词云和分享事实的 HTTP 路由工厂
 * [POS]: routes 的 Bot 书库协议适配层，只映射参数、状态码与响应；SQL、凭据和事实写入由 services 承担
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createBotApiLibraryRoutes(deps = {}) {
    const router = express.Router();
    const {
        requireBotApi,
        getPo18Account,
        savePo18Account,
        deletePo18Account,
        addBookshelfBook,
        removeBookshelfBook,
        listBookshelfBooks,
        upsertSearchRequest,
        recordBookShare,
        getHotKeywords,
        addHotKeyword,
        addHotKeywords,
        wordCloudPayload
    } = deps;

    router.get("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            res.json(await getPo18Account(req.params.telegramId));
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/users/:telegramId/po18/credentials", requireBotApi, async (req, res, next) => {
        try {
            res.json(await getPo18Account(req.params.telegramId, { includePassword: true }));
        } catch (error) {
            next(error);
        }
    });

    router.put("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            res.json({ success: true, ...(await savePo18Account(req.params.telegramId, req.body || {})) });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/bot-api/users/:telegramId/po18", requireBotApi, async (req, res, next) => {
        try {
            await deletePo18Account(req.params.telegramId);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            await addBookshelfBook(req.params.telegramId, req.params.bookId);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/bot-api/bookshelf/:telegramId/:bookId", requireBotApi, async (req, res, next) => {
        try {
            await removeBookshelfBook(req.params.telegramId, req.params.bookId);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/bookshelf/:telegramId", requireBotApi, async (req, res, next) => {
        try {
            res.json({ rows: await listBookshelfBooks(req.params.telegramId) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/search-requests", requireBotApi, async (req, res, next) => {
        try {
            res.json({ success: true, ...(await upsertSearchRequest(req.body || {})) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            if (Array.isArray(req.body?.rows)) {
                if (req.body.rows.length > 500) return res.status(413).json({ error: "too many hot keyword rows; maximum is 500" });
                if (typeof addHotKeywords !== "function") {
                    return res.status(503).json({ error: "hot keyword batch service is not configured" });
                }
                const result = await addHotKeywords(req.body.rows);
                return res.json({ success: true, rows: result.rows.slice(0, 20), previous: result.previous, writes: result.writes });
            }
            const row = await addHotKeyword(
                req.body?.keyword || req.body?.query,
                req.body?.type || req.body?.search_type,
                req.body?.result_count || req.body?.resultCount || 0
            );
            res.json({ success: true, row, rows: await getHotKeywords(20) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/hot-keywords", requireBotApi, async (req, res, next) => {
        try {
            res.json({ rows: await getHotKeywords(req.query.limit || 20) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/bot-api/word-cloud", requireBotApi, async (req, res, next) => {
        try {
            if (typeof wordCloudPayload !== "function") return res.status(503).json({ error: "word cloud service is not configured" });
            res.json(
                await wordCloudPayload({
                    limit: req.query.limit,
                    hotLimit: req.query.hot_limit || req.query.hotLimit,
                    sourceLimit: req.query.source_limit || req.query.sourceLimit,
                    platform: req.query.platform || ""
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.post("/bot-api/books/:bookId/share", requireBotApi, async (req, res, next) => {
        try {
            res.json({ success: true, ...(await recordBookShare(req.params.bookId, req.body || {})) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createBotApiLibraryRoutes };
