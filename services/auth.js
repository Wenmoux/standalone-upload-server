/**
 * [INPUT]: 依赖 Node crypto 及注入的 query、会话/凭证加密能力，处理 Reader/Admin/Telegram 身份与权限数据
 * [OUTPUT]: 对外提供认证服务工厂、Admin 角色判断、CDK 时长、日期键及 Reader/Telegram 身份辅助函数
 * [POS]: services 的统一认证授权内核，被 Reader、Admin 与内部 API 路由共享以维持一致权限语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const defaultCrypto = require("crypto");

function cdkDuration(type) {
    const map = {
        "7d": { type: "7d", days: 7, label: "7\u5929" },
        "30d": { type: "30d", days: 30, label: "30\u5929" },
        "365d": { type: "365d", days: 365, label: "\u4e00\u5e74" },
        permanent: { type: "permanent", days: 0, label: "\u6c38\u4e45" }
    };
    return map[String(type || "").toLowerCase()] || null;
}

function todayDateKey() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function valueOf(value) {
    return typeof value === "function" ? value() : value;
}

function normalizeAdminRole(value) {
    const role = String(value || "owner")
        .trim()
        .toLowerCase();
    return ["owner", "operator", "moderator", "viewer"].includes(role) ? role : "viewer";
}

function adminRoleAllows(roleValue, req) {
    const role = normalizeAdminRole(roleValue);
    if (role === "owner") return true;
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || req.url || "").split("?")[0];
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
        if (/\/admin-api\/auth\/admins(?:\/|$)/.test(path)) return false;
        if (/\/admin-api\/review-moderation(?:\/|$)/.test(path)) return role === "moderator";
        if (role === "viewer" && /\/admin-api\/(config|backup\/download|backup\/config|backup\/diagnostics|system\/api-tokens)/.test(path))
            return false;
        return true;
    }
    if (path === "/admin-api/auth/logout") return true;
    if (role === "operator") {
        if (/\/admin-api\/(books|chapters|po18-crawler|jobs)(?:\/|$)/.test(path)) return true;
        if (/\/admin-api\/backup(?:\/|$)/.test(path) && path !== "/admin-api/backup/restore") return true;
        return false;
    }
    if (role === "moderator") return /\/admin-api\/(?:corrections|review-moderation)(?:\/|$)/.test(path);
    return false;
}

function createAuthService(options = {}) {
    const crypto = options.crypto || defaultCrypto;
    const query = options.query;
    const configGet = options.configGet || (async () => "");
    const scholarProfile =
        options.scholarProfile ||
        ((exp = 0) => ({
            level: 1,
            name: "",
            exp: Math.max(0, Math.trunc(Number(exp || 0))),
            daily_free_exports: 1
        }));
    const normalizeTelegramId = options.normalizeTelegramId || ((value) => String(value || "").trim());
    const normalizeChatId = options.normalizeChatId || ((value) => String(value || "").trim());
    const botUsernameForTelegram =
        options.botUsernameForTelegram || ((telegramId) => `tg_${normalizeTelegramId(telegramId).replace(/[^0-9A-Za-z_-]/g, "_")}`);
    const uploadApiTokenProvider = options.uploadApiTokenProvider || (() => process.env.PO18_UPLOAD_API_TOKEN || "");
    const botApiTokenProvider = options.botApiTokenProvider || (() => process.env.PO18_BOT_API_TOKEN || "");
    const uploadTokenAuthenticator = options.uploadTokenAuthenticator;
    const botTokenAuthenticator = options.botTokenAuthenticator;

    function timingSafeEqualText(left, right) {
        const a = crypto
            .createHash("sha256")
            .update(String(left || ""))
            .digest();
        const b = crypto
            .createHash("sha256")
            .update(String(right || ""))
            .digest();
        return crypto.timingSafeEqual(a, b);
    }

    function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
        const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
        return { salt, hash };
    }

    function verifyPassword(password, user = {}) {
        if (!user.salt || !user.password_hash) return false;
        const { hash } = hashPassword(password, user.salt);
        const provided = Buffer.from(hash, "hex");
        const expected = Buffer.from(String(user.password_hash || ""), "hex");
        return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    }

    function publicReaderUser(user) {
        if (!user) return null;
        const scholar = scholarProfile(user.scholar_exp);
        return {
            id: user.id,
            username: user.username,
            nickname: user.nickname || user.username,
            avatar_url: user.avatar_url || "",
            membership_expires_at: user.membership_expires_at || null,
            membership_permanent: !!user.membership_permanent,
            library_access: user.library_access !== false,
            copper_coins: Number(user.copper_coins || 0),
            silver_coins: Number(user.silver_coins || 0),
            sign_cycle_day: Number(user.sign_cycle_day || 0),
            last_sign_date: user.last_sign_date || null,
            telegram_id: user.telegram_id || "",
            telegram_username: user.telegram_username || "",
            is_admin: !!user.is_admin,
            is_banned: !!user.is_banned,
            invite_count: Number(user.invite_count || 0),
            inviter_telegram_id: user.inviter_telegram_id || "",
            export_unlocked_at: user.export_unlocked_at || null,
            export_extra_quota: Number(user.export_extra_quota || 0),
            scholar_exp: scholar.exp,
            scholar,
            scholar_level: scholar.level,
            scholar_level_name: scholar.name,
            daily_free_exports: scholar.daily_free_exports
        };
    }

    function publicAdminReaderUser(user) {
        const u = publicReaderUser(user);
        return {
            ...u,
            created_at: user.created_at,
            last_login_at: user.last_login_at,
            free_exports_today: Number(user.free_exports_today || 0)
        };
    }

    function botPublicUser(user) {
        if (!user) return null;
        return { ...publicReaderUser(user), created_at: user.created_at, last_login_at: user.last_login_at };
    }

    function requireReader(req, res, next) {
        if (!req.session?.readerUser) return res.status(401).json({ error: "\u8bf7\u5148\u767b\u5f55" });
        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.session?.adminUser) return res.status(401).json({ error: "\u672a\u767b\u5f55" });
        if (!adminRoleAllows(req.session.adminUser.role, req)) return res.status(403).json({ error: "管理员权限不足" });
        next();
    }

    async function currentReaderUser(req) {
        if (!req.session?.readerUser?.id) return null;
        if (typeof query !== "function") throw new Error("auth query function is not configured");
        const found = await query(
            `SELECT id, username, nickname, avatar_url, membership_expires_at, membership_permanent, library_access,
                    copper_coins, silver_coins, sign_cycle_day, last_sign_date, telegram_id, telegram_username,
                    is_admin, is_banned, invite_count, inviter_telegram_id, export_unlocked_at, export_extra_quota, scholar_exp
             FROM reader_users WHERE id = $1`,
            [req.session.readerUser.id]
        );
        return found.rows[0] || null;
    }

    function hasActiveLibraryAccess(user = {}) {
        const active = user.membership_permanent || (user.membership_expires_at && new Date(user.membership_expires_at) > new Date());
        return user.library_access !== false && !!active;
    }

    async function requireLibraryAccess(req, res, next) {
        try {
            const user = await currentReaderUser(req);
            if (!user) return res.status(401).json({ error: "\u8bf7\u5148\u767b\u5f55" });
            if (!hasActiveLibraryAccess(user))
                return res.status(403).json({ error: "\u4e66\u5e93\u6743\u9650\u4e0d\u8db3\u6216\u4f1a\u5458\u5df2\u8fc7\u671f" });
            req.readerUser = user;
            next();
        } catch (err) {
            next(err);
        }
    }

    async function requireReaderContentAccess(req, res, next) {
        try {
            const user = await currentReaderUser(req);
            if (!user) return res.status(401).json({ error: "\u8bf7\u767b\u5f55" });
            if (!hasActiveLibraryAccess(user)) return res.status(403).json({ error: "\u5f00\u901a\u6743\u9650" });
            req.readerUser = user;
            next();
        } catch (err) {
            next(err);
        }
    }

    function generateCdkCode() {
        return `CDK-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    }

    function addMembershipPatch(user, durationType) {
        const duration = cdkDuration(durationType);
        if (!duration) throw new Error("\u65e0\u6548\u4f1a\u5458\u65f6\u957f");
        if (duration.type === "permanent") {
            return { permanent: true, expiresAt: user.membership_expires_at || null };
        }
        const now = new Date();
        const current = user.membership_expires_at ? new Date(user.membership_expires_at) : now;
        const base = current > now ? current : now;
        base.setDate(base.getDate() + duration.days);
        return { permanent: !!user.membership_permanent, expiresAt: base.toISOString() };
    }

    async function requireUploadApi(req, res, next) {
        if (req.session?.adminUser) return next();
        const provided = req.get("X-Upload-Token") || req.get("X-PO18-Upload-Token") || "";
        if (typeof uploadTokenAuthenticator === "function") {
            try {
                const result = await uploadTokenAuthenticator({ token: provided, req });
                if (!result?.ok) return res.status(result?.status || 401).json({ error: result?.error || "Upload API token invalid" });
                req.apiToken = result.token;
                return next();
            } catch (err) {
                return res.status(503).json({ error: err.message || "Upload API token validation unavailable" });
            }
        }
        const expected = valueOf(uploadApiTokenProvider);
        if (!expected) return res.status(503).json({ error: "Upload API token is not configured" });
        if (!timingSafeEqualText(provided, expected)) return res.status(401).json({ error: "Upload API token invalid" });
        next();
    }

    async function requireBotApi(req, res, next) {
        const provided = req.get("X-Bot-Token") || "";
        if (typeof botTokenAuthenticator === "function") {
            try {
                const result = await botTokenAuthenticator({ token: provided, req });
                if (!result?.ok) return res.status(result?.status || 401).json({ error: result?.error || "Bot API token invalid" });
                req.apiToken = result.token;
                return next();
            } catch (err) {
                return res.status(503).json({ error: err.message || "Bot API token validation unavailable" });
            }
        }
        const expected = valueOf(botApiTokenProvider);
        if (!expected) return res.status(503).json({ error: "Bot API token is not configured" });
        if (!timingSafeEqualText(provided, expected)) return res.status(401).json({ error: "Bot API token invalid" });
        next();
    }

    function botUserSelect() {
        return `id, username, nickname, avatar_url, membership_expires_at, membership_permanent, library_access,
                copper_coins, silver_coins, sign_cycle_day, last_sign_date, created_at, last_login_at,
                telegram_id, telegram_username, is_admin, is_banned, invite_count, inviter_telegram_id, export_unlocked_at, export_extra_quota, scholar_exp`;
    }

    async function findBotUserByTelegramId(telegramId) {
        if (typeof query !== "function") throw new Error("auth query function is not configured");
        const result = await query(`SELECT ${botUserSelect()} FROM reader_users WHERE telegram_id = $1`, [normalizeTelegramId(telegramId)]);
        return result.rows[0] || null;
    }

    function telegramLoginBotIdFromToken(token) {
        return String(token || "").match(/^(\d+):/)?.[1] || "";
    }

    async function telegramLoginBotToken() {
        const configured = await configGet("telegram_bot_token");
        return String(configured || process.env.PO18_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
    }

    function verifyTelegramLoginPayload(input, botToken) {
        const payload = {};
        for (const key of ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"]) {
            if (Object.prototype.hasOwnProperty.call(input || {}, key) && input[key] !== undefined && input[key] !== null) {
                payload[key] = String(input[key]);
            }
        }
        if (!payload.id || !payload.auth_date || !payload.hash) return { ok: false, status: 400, error: "TG login data incomplete" };
        const authDate = Number(payload.auth_date);
        if (!Number.isFinite(authDate)) return { ok: false, status: 400, error: "TG login time invalid" };
        const maxAge = Number(process.env.TELEGRAM_LOGIN_MAX_AGE_SECONDS || 86400);
        if (Number.isFinite(maxAge) && maxAge > 0 && Math.abs(Math.floor(Date.now() / 1000) - authDate) > maxAge) {
            return { ok: false, status: 401, error: "TG login expired" };
        }
        const dataCheckString = Object.keys(payload)
            .filter((key) => key !== "hash")
            .sort()
            .map((key) => `${key}=${payload[key]}`)
            .join("\n");
        const secretKey = crypto.createHash("sha256").update(botToken).digest();
        const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
        if (!timingSafeEqualText(expectedHash, payload.hash.toLowerCase()))
            return { ok: false, status: 401, error: "TG login signature invalid" };
        return { ok: true, payload };
    }

    function telegramLoginNickname(payload) {
        return (
            [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim().slice(0, 32) ||
            payload.username ||
            botUsernameForTelegram(payload.id)
        );
    }

    return {
        addMembershipPatch,
        botPublicUser,
        botUsernameForTelegram,
        botUserSelect,
        cdkDuration,
        currentReaderUser,
        findBotUserByTelegramId,
        generateCdkCode,
        hashPassword,
        normalizeChatId,
        normalizeTelegramId,
        publicAdminReaderUser,
        publicReaderUser,
        requireAdmin,
        requireBotApi,
        requireLibraryAccess,
        requireReader,
        requireReaderContentAccess,
        requireUploadApi,
        telegramLoginBotIdFromToken,
        telegramLoginBotToken,
        telegramLoginNickname,
        timingSafeEqualText,
        todayDateKey,
        verifyPassword,
        verifyTelegramLoginPayload
    };
}

module.exports = {
    adminRoleAllows,
    cdkDuration,
    createAuthService,
    normalizeAdminRole,
    todayDateKey
};
