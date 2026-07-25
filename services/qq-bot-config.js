/**
 * [INPUT]: 依赖 admin_config 读写、凭据加密器、平台别名规范化和书籍元信息查询能力
 * [OUTPUT]: 对外提供 QQ Bot 配置读写、公开/运行时配置投影及平台/标签访问策略
 * [POS]: services 的 QQ Bot 配置与内容范围事实源，确保搜索展示和下载授权使用同一套规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { canonicalPlatformKey, normalizePlatformKey } = require("./platforms");

const LIST_SEPARATOR = /[,，、|;；\n\r]+/;
const TAG_SEPARATOR = new RegExp("[,，、|/\\\\s:：;；#＃·•・]+");
const QQ_CONFIG_KEYS = Object.freeze({
    enabled: "qq_bot_enabled",
    appId: "qq_bot_app_id",
    appSecret: "qq_bot_app_secret",
    blockedPlatforms: "qq_bot_blocked_platforms",
    blockedTags: "qq_bot_blocked_tags",
    allowedPlatforms: "qq_bot_allowed_platforms",
    defaultEpubStyle: "qq_bot_default_epub_style"
});

function normalizeList(value, options = {}) {
    let rows = [];
    if (Array.isArray(value)) rows = value;
    else if (typeof value === "string") {
        const text = value.trim();
        if (!text) return [];
        try {
            const parsed = JSON.parse(text);
            rows = Array.isArray(parsed) ? parsed : text.split(options.separator || LIST_SEPARATOR);
        } catch {
            rows = text.split(options.separator || LIST_SEPARATOR);
        }
    }
    const max = Math.max(1, Number(options.max || 100));
    return [...new Set(rows.map((item) => String(item || "").trim()).filter(Boolean).map((item) => (options.lower === false ? item : item.toLowerCase())))].slice(0, max);
}

function normalizePlatformList(value) {
    return [...new Set(normalizeList(value).map((item) => normalizePlatformKey(canonicalPlatformKey(item))).filter(Boolean))];
}

function normalizeTagList(value) {
    return normalizeList(value, { separator: TAG_SEPARATOR, max: 200 });
}

function bookTagTokens(book = {}) {
    return normalizeTagList([book.category, book.tags].filter(Boolean).join("\n"));
}

function normalizeQqPolicy(input = {}) {
    return {
        allowedPlatforms: normalizePlatformList(input.allowedPlatforms ?? input.allowed_platforms),
        blockedPlatforms: normalizePlatformList(input.blockedPlatforms ?? input.blocked_platforms),
        blockedTags: normalizeTagList(input.blockedTags ?? input.blocked_tags)
    };
}

function qqBookAccess(book = {}, policy = {}) {
    const normalized = normalizeQqPolicy(policy);
    const platform = normalizePlatformKey(canonicalPlatformKey(book.platform || ""));
    if (normalized.allowedPlatforms.length && !normalized.allowedPlatforms.includes(platform)) {
        return { allowed: false, reason: "platform_not_allowed", platform };
    }
    if (normalized.blockedPlatforms.includes(platform)) {
        return { allowed: false, reason: "platform_blocked", platform };
    }
    const tags = bookTagTokens(book);
    const blockedTag = tags.find((tag) => normalized.blockedTags.includes(tag));
    if (blockedTag) return { allowed: false, reason: "tag_blocked", platform, blockedTag, tags };
    return { allowed: true, platform, tags };
}

function filterQqBooks(books = [], policy = {}) {
    return (Array.isArray(books) ? books : []).filter((book) => qqBookAccess(book, policy).allowed);
}

function createQqBotConfigService(options = {}) {
    const configGet = options.configGet;
    const configSet = options.configSet;
    const credentialCrypto = options.credentialCrypto;
    const query = options.query;
    if (typeof configGet !== "function" || typeof configSet !== "function") throw new Error("QQ Bot config storage is required");

    async function runtimeConfig() {
        const [enabled, storedAppId, storedSecret, allowedPlatforms, blockedPlatforms, blockedTags, defaultEpubStyle] = await Promise.all([
            configGet(QQ_CONFIG_KEYS.enabled),
            configGet(QQ_CONFIG_KEYS.appId),
            configGet(QQ_CONFIG_KEYS.appSecret),
            configGet(QQ_CONFIG_KEYS.allowedPlatforms),
            configGet(QQ_CONFIG_KEYS.blockedPlatforms),
            configGet(QQ_CONFIG_KEYS.blockedTags),
            configGet(QQ_CONFIG_KEYS.defaultEpubStyle)
        ]);
        const appId = String(storedAppId || process.env.QQ_BOT_APP_ID || "").trim();
        const encryptedSecret = String(storedSecret || "");
        const appSecret = encryptedSecret
            ? credentialCrypto?.decryptString(encryptedSecret) || encryptedSecret
            : String(process.env.QQ_BOT_APP_SECRET || "").trim();
        return {
            enabled: String(enabled || process.env.QQ_BOT_ENABLED || "0") === "1",
            appId,
            appSecret,
            appSecretConfigured: !!appSecret,
            appSecretSource: encryptedSecret ? "admin_config" : appSecret ? "env" : "",
            ...normalizeQqPolicy({ allowedPlatforms, blockedPlatforms, blockedTags }),
            defaultEpubStyle: String(defaultEpubStyle || "style1").trim() || "style1"
        };
    }

    async function publicConfig() {
        const config = await runtimeConfig();
        const safe = { ...config };
        delete safe.appSecret;
        return safe;
    }

    async function updateConfig(input = {}) {
        const current = await runtimeConfig();
        const policy = normalizeQqPolicy({
            allowedPlatforms: input.allowedPlatforms ?? current.allowedPlatforms,
            blockedPlatforms: input.blockedPlatforms ?? current.blockedPlatforms,
            blockedTags: input.blockedTags ?? current.blockedTags
        });
        const writes = [
            configSet(QQ_CONFIG_KEYS.enabled, input.enabled ? "1" : "0"),
            configSet(QQ_CONFIG_KEYS.appId, String(input.appId ?? current.appId ?? "").trim()),
            configSet(QQ_CONFIG_KEYS.allowedPlatforms, JSON.stringify(policy.allowedPlatforms)),
            configSet(QQ_CONFIG_KEYS.blockedPlatforms, JSON.stringify(policy.blockedPlatforms)),
            configSet(QQ_CONFIG_KEYS.blockedTags, JSON.stringify(policy.blockedTags)),
            configSet(QQ_CONFIG_KEYS.defaultEpubStyle, String(input.defaultEpubStyle || current.defaultEpubStyle || "style1").trim())
        ];
        if (input.clearAppSecret === true) writes.push(configSet(QQ_CONFIG_KEYS.appSecret, ""));
        else if (Object.prototype.hasOwnProperty.call(input, "appSecret") && String(input.appSecret || "").trim()) {
            const secret = String(input.appSecret).trim();
            writes.push(configSet(QQ_CONFIG_KEYS.appSecret, credentialCrypto?.encryptString(secret) || secret));
        }
        await Promise.all(writes);
        return publicConfig();
    }

    async function bookAccessById(bookId) {
        if (typeof query !== "function") throw new Error("QQ Bot book access query is not configured");
        const result = await query(
            `SELECT * FROM book_metadata
             WHERE book_id=$1
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT 1`,
            [String(bookId || "").trim()]
        );
        const book = result.rows[0] || null;
        if (!book) return { allowed: false, reason: "book_not_found", book: null };
        return { ...qqBookAccess(book, await runtimeConfig()), book };
    }

    return {
        bookAccessById,
        publicConfig,
        qqBookAccessById: bookAccessById,
        qqBotConfig: publicConfig,
        qqBotRuntimeConfig: runtimeConfig,
        runtimeConfig,
        updateConfig,
        updateQqBotConfig: updateConfig
    };
}

module.exports = {
    QQ_CONFIG_KEYS,
    bookTagTokens,
    createQqBotConfigService,
    filterQqBooks,
    normalizeList,
    normalizePlatformList,
    normalizeQqPolicy,
    normalizeTagList,
    qqBookAccess
};
