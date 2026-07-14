/**
 * [INPUT]: 依赖 Express、Reader 账户/签到领域服务、session 与 Telegram 登录签名校验
 * [OUTPUT]: 对外提供 Reader 注册、密码/Telegram 登录、退出、当前用户、签到和资料路由
 * [POS]: routes 的 Reader 身份入口，保持 Reader session 与 Admin session 分离并强制注册 CDK
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");

function createReaderAuthRoutes(deps = {}) {
    const router = express.Router();
    const {
        query,
        currentReaderUser,
        publicReaderUser,
        botUserSelect,
        telegramLoginBotToken,
        telegramLoginBotIdFromToken,
        verifyTelegramLoginPayload,
        requireReader,
        registerReaderWithCdk,
        loginReaderWithPassword,
        loginReaderWithTelegram,
        checkInUser
    } = deps;

    router.get("/reader-auth/me", async (req, res, next) => {
        try {
            res.json({ user: publicReaderUser(await currentReaderUser(req)) });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/register", async (req, res, next) => {
        try {
            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const nickname = String(req.body?.nickname || username).trim();
            const cdkCode = String(req.body?.cdk || req.body?.code || "")
                .trim()
                .toUpperCase();
            if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{2,32}$/.test(username))
                return res.status(400).json({ error: "用户名需 2-32 位，可用中文、字母、数字、下划线和短横线" });
            if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
            if (!cdkCode) return res.status(400).json({ error: "注册需要 CDK" });
            const created = await registerReaderWithCdk({ username, password, nickname, cdkCode });
            req.session.readerUser = publicReaderUser(created);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/login", async (req, res, next) => {
        try {
            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const user = await loginReaderWithPassword({ username, password });
            req.session.readerUser = publicReaderUser(user);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.get("/reader-auth/telegram/config", async (req, res, next) => {
        try {
            const token = await telegramLoginBotToken();
            const botId = telegramLoginBotIdFromToken(token);
            res.json({ enabled: !!botId, botId });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/telegram", async (req, res, next) => {
        try {
            const token = await telegramLoginBotToken();
            if (!telegramLoginBotIdFromToken(token)) return res.status(400).json({ error: "TG 登录未配置 Bot Token" });
            const verified = verifyTelegramLoginPayload(req.body || {}, token);
            if (!verified.ok) return res.status(verified.status || 401).json({ error: verified.error });

            const payload = verified.payload;
            const result = await loginReaderWithTelegram(payload);
            req.session.readerUser = publicReaderUser(result.user);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/sign", requireReader, async (req, res, next) => {
        try {
            const result = await checkInUser({ userId: req.session.readerUser.id, source: "reader" });
            req.session.readerUser = publicReaderUser(result.user);
            res.json({ success: true, reward: result.reward, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/reader-auth/profile", requireReader, async (req, res, next) => {
        try {
            const nickname = String(req.body?.nickname || "").trim();
            const avatarUrl = String(req.body?.avatar_url || "").trim();
            if (!nickname || nickname.length > 32) return res.status(400).json({ error: "昵称需 1-32 位" });
            if (avatarUrl.length > 1000) return res.status(400).json({ error: "头像地址太长" });
            const updated = await query(
                `UPDATE reader_users SET nickname = $1, avatar_url = $2 WHERE id = $3 RETURNING ${botUserSelect()}`,
                [nickname, avatarUrl, req.session.readerUser.id]
            );
            req.session.readerUser = publicReaderUser(updated.rows[0]);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/logout", (req, res) => {
        delete req.session.readerUser;
        res.json({ success: true });
    });

    return router;
}

module.exports = {
    createReaderAuthRoutes
};
