const crypto = require("crypto");
const express = require("express");

function createReaderAuthRoutes(deps = {}) {
    const router = express.Router();
    const {
        query,
        currentReaderUser,
        publicReaderUser,
        hashPassword,
        verifyPassword,
        cdkDuration,
        botUserSelect,
        telegramLoginBotToken,
        telegramLoginBotIdFromToken,
        verifyTelegramLoginPayload,
        normalizeTelegramId,
        botUsernameForTelegram,
        telegramLoginNickname,
        requireReader,
        todayDateKey,
        signExpReward,
        scholarProfile,
        recordTransaction
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
            const cdkCode = String(req.body?.cdk || req.body?.code || "").trim().toUpperCase();
            if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{2,32}$/.test(username)) return res.status(400).json({ error: "用户名需 2-32 位，可用中文、字母、数字、下划线和短横线" });
            if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
            if (!cdkCode) return res.status(400).json({ error: "注册需要 CDK" });
            const found = await query("SELECT id FROM reader_users WHERE username = $1", [username]);
            if (found.rows.length) return res.status(409).json({ error: "用户名已存在" });
            const cdk = await query("SELECT * FROM reader_cdks WHERE upper(code) = $1", [cdkCode]);
            const cdkRow = cdk.rows[0];
            if (!cdkRow) return res.status(404).json({ error: "CDK 不存在" });
            if (cdkRow.used_by || cdkRow.used_at) return res.status(409).json({ error: "CDK 已被使用" });
            const { salt, hash } = hashPassword(password);
            const duration = cdkDuration(cdkRow.duration_type);
            if (!duration) return res.status(400).json({ error: "CDK 时长配置无效" });
            const expires = duration.type === "permanent" ? null : new Date(Date.now() + duration.days * 86400000).toISOString();
            const created = await query(
                `INSERT INTO reader_users(username, password_hash, salt, nickname, membership_expires_at, membership_permanent, library_access)
                 VALUES ($1,$2,$3,$4,$5,$6,TRUE)
                 RETURNING ${botUserSelect()}`,
                [username, hash, salt, nickname, expires, duration.type === "permanent"]
            );
            await query("UPDATE reader_cdks SET used_by = $1, used_at = CURRENT_TIMESTAMP WHERE id = $2", [created.rows[0].id, cdkRow.id]);
            req.session.readerUser = publicReaderUser(created.rows[0]);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/login", async (req, res, next) => {
        try {
            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const found = await query("SELECT * FROM reader_users WHERE username = $1", [username]);
            const user = found.rows[0];
            if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: "用户名或密码错误" });
            await query("UPDATE reader_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
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
            const telegramId = normalizeTelegramId(payload.id);
            const telegramUsername = String(payload.username || "").trim().replace(/^@/, "").slice(0, 64);
            const avatarUrl = String(payload.photo_url || "").trim().slice(0, 1000);
            let found = await query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1`, [telegramId]);
            let user = found.rows[0];

            if (user) {
                if (user.is_banned) return res.status(403).json({ error: "账号已被禁用" });
                const updated = await query(
                    `UPDATE reader_users
                     SET telegram_username = $1,
                         avatar_url = COALESCE(NULLIF($2, ''), avatar_url),
                         last_login_at = CURRENT_TIMESTAMP
                     WHERE id = $3
                     RETURNING ${botUserSelect()}`,
                    [telegramUsername, avatarUrl, user.id]
                );
                user = updated.rows[0];
            } else {
                const baseUsername = botUsernameForTelegram(telegramId).slice(0, 32);
                const sameUsername = await query("SELECT id FROM reader_users WHERE username = $1", [baseUsername]);
                const finalUsername = sameUsername.rows.length ? `${baseUsername}_${Date.now().toString(36).slice(-4)}`.slice(0, 32) : baseUsername;
                const { salt, hash } = hashPassword(crypto.randomBytes(18).toString("base64url"));
                const created = await query(
                    `INSERT INTO reader_users(username, password_hash, salt, nickname, avatar_url, library_access, membership_permanent,
                                              telegram_id, telegram_username, last_login_at)
                     VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,$6,$7,CURRENT_TIMESTAMP)
                     ON CONFLICT (telegram_id) DO UPDATE SET
                        telegram_username = EXCLUDED.telegram_username,
                        avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), reader_users.avatar_url),
                        last_login_at = CURRENT_TIMESTAMP
                     RETURNING ${botUserSelect()}`,
                    [finalUsername, hash, salt, telegramLoginNickname(payload), avatarUrl, telegramId, telegramUsername]
                );
                user = created.rows[0];
                if (user.is_banned) return res.status(403).json({ error: "账号已被禁用" });
            }

            req.session.readerUser = publicReaderUser(user);
            res.json({ success: true, user: req.session.readerUser });
        } catch (err) {
            next(err);
        }
    });

    router.post("/reader-auth/sign", requireReader, async (req, res, next) => {
        try {
            const user = await currentReaderUser(req);
            const today = todayDateKey();
            const last = user.last_sign_date ? String(user.last_sign_date).slice(0, 10) : "";
            if (last === today) return res.status(409).json({ error: "今天已经签到过了" });
            const prev = Number(user.sign_cycle_day || 0);
            const nextDay = prev >= 7 ? 1 : prev + 1;
            const copper = 100;
            const silver = nextDay === 7 ? 100 : 0;
            const exp = signExpReward(nextDay);
            const beforeScholar = scholarProfile(user.scholar_exp);
            const updated = await query(
                `UPDATE reader_users
                 SET copper_coins = COALESCE(copper_coins,0) + $1,
                      silver_coins = COALESCE(silver_coins,0) + $2,
                      scholar_exp = COALESCE(scholar_exp,0) + $3,
                      sign_cycle_day = $4,
                      last_sign_date = $5::date
                  WHERE id = $6
                    AND (last_sign_date IS NULL OR last_sign_date <> $5::date)
                  RETURNING ${botUserSelect()}`,
                [copper, silver, exp, nextDay, today, user.id]
            );
            if (!updated.rows.length) return res.status(409).json({ error: "今天已经签到过了" });
            const afterScholar = scholarProfile(updated.rows[0].scholar_exp);
            await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign",
                currency: "copper",
                amount: copper,
                balance: updated.rows[0].copper_coins,
                detail: `网页签到 day=${nextDay}`,
                source: "reader"
            });
            await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign_exp",
                currency: "exp",
                amount: exp,
                balance: updated.rows[0].scholar_exp,
                detail: `网页签到 day=${nextDay}`,
                source: "reader"
            });
            if (silver) await recordTransaction({
                userId: updated.rows[0].id,
                telegramId: updated.rows[0].telegram_id,
                type: "sign",
                currency: "silver",
                amount: silver,
                balance: updated.rows[0].silver_coins,
                detail: `网页签到 day=${nextDay}`,
                source: "reader"
            });
            req.session.readerUser = publicReaderUser(updated.rows[0]);
            res.json({ success: true, reward: { copper, silver, exp, day: nextDay, scholar: afterScholar, level_up: afterScholar.level > beforeScholar.level }, user: req.session.readerUser });
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
