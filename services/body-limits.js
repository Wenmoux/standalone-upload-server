/**
 * [INPUT]: 依赖 Express json/raw 解析器、路由前缀与 PO18_BODY_LIMIT 系列环境配置
 * [OUTPUT]: 对外提供分级请求体预算、旧身份入口无类型 JSON 兼容及按路由安装 body parser 的函数
 * [POS]: services 的入口资源保护策略，在业务路由之前按风险分配请求体上限并隔离历史客户端兼容面
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const DEFAULT_BODY_LIMITS = Object.freeze({
    auth: "32kb",
    lookup: "256kb",
    tts: "64kb",
    metadata: "768kb",
    chapter: "12mb",
    manifest: "24mb",
    default: "2mb"
});

const ROUTE_BODY_LIMITS = Object.freeze([
    {
        name: "auth",
        acceptLegacyJson: true,
        paths: [
            "/admin-api/auth/login",
            "/reader-auth/login",
            "/reader-auth/register",
            "/reader-auth/telegram",
            "/signup/login",
            "/signup/register"
        ]
    },
    { name: "lookup", paths: ["/api/parse/check-cache"] },
    { name: "tts", paths: ["/reader-api/tts"] },
    { name: "metadata", paths: ["/api/metadata/batch"] },
    { name: "chapter", paths: ["/api/parse/chapter-content"] },
    { name: "manifest", paths: ["/admin-api/books/manifests/validate", "/admin-api/books/manifests/import"] }
]);

function normalizedLimit(value, fallback) {
    const input = String(value || "")
        .trim()
        .toLowerCase();
    return /^\d+(?:\.\d+)?(?:b|kb|mb)$/.test(input) ? input : fallback;
}

function bodyLimitConfig(env = process.env) {
    return {
        auth: normalizedLimit(env.PO18_BODY_LIMIT_AUTH, DEFAULT_BODY_LIMITS.auth),
        lookup: normalizedLimit(env.PO18_BODY_LIMIT_LOOKUP, DEFAULT_BODY_LIMITS.lookup),
        tts: normalizedLimit(env.PO18_BODY_LIMIT_TTS, DEFAULT_BODY_LIMITS.tts),
        metadata: normalizedLimit(env.PO18_BODY_LIMIT_METADATA, DEFAULT_BODY_LIMITS.metadata),
        chapter: normalizedLimit(env.PO18_BODY_LIMIT_CHAPTER, DEFAULT_BODY_LIMITS.chapter),
        manifest: normalizedLimit(env.PO18_BODY_LIMIT_MANIFEST, DEFAULT_BODY_LIMITS.manifest),
        default: normalizedLimit(env.PO18_BODY_LIMIT_DEFAULT, DEFAULT_BODY_LIMITS.default)
    };
}

function legacyAuthJsonType(req) {
    const contentType = String(req.headers?.["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
    return !contentType || contentType === "text/plain" || contentType === "application/json" || contentType.endsWith("+json");
}

function parsersForLimit(express, limit, policy = {}) {
    const jsonOptions = policy.acceptLegacyJson ? { limit, type: legacyAuthJsonType } : { limit };
    return [express.json(jsonOptions), express.urlencoded({ extended: true, limit })];
}

function installRouteBodyParsers(app, express, env = process.env) {
    const limits = bodyLimitConfig(env);
    for (const policy of ROUTE_BODY_LIMITS) {
        app.use(policy.paths, ...parsersForLimit(express, limits[policy.name], policy));
    }
    app.use(...parsersForLimit(express, limits.default));
    return limits;
}

module.exports = {
    DEFAULT_BODY_LIMITS,
    ROUTE_BODY_LIMITS,
    bodyLimitConfig,
    installRouteBodyParsers,
    legacyAuthJsonType,
    normalizedLimit,
    parsersForLimit
};
