/**
 * [INPUT]: 依赖 Express 应用、PostgreSQL Session 池、启动闸门、安全配置和结构化日志
 * [OUTPUT]: 对外提供按固定顺序安装日志/CORS/限流/解析/Session/CSRF/审计的 HTTP 管线
 * [POS]: services 的服务端协议管线，锁定业务路由之前的安全中间件顺序并让组合根只挂载领域路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const compression = require("compression");
const cors = require("cors");
const session = require("express-session");
const PgSessionStore = require("connect-pg-simple")(session);
const { attachExpressPanel } = require("../docker/control-panel");
const { createRequestLogger } = require("../docker/structured-log");
const { createAdminAuditMiddleware } = require("./admin-audit");
const { installRouteBodyParsers } = require("./body-limits");
const { createCsrfProtection } = require("./csrf");
const { createErrorResponseNormalizer } = require("./error-response");
const { corsOriginCallback } = require("./http-security");
const { createRateLimiter } = require("./rate-limit");
const { createRequestSchemaValidation } = require("./schema-validation");

function finiteNumber(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function installHttpPipeline(options = {}) {
    const app = options.app;
    const express = options.express;
    const pool = options.pool;
    const startupGate = options.startupGate;
    const configFile = options.configFile;
    const sessionSecret = options.sessionSecret;
    const query = options.query;
    const logEvent = options.logEvent;
    const requestSlowMs = finiteNumber(options.requestSlowMs, 800);
    const env = options.env || process.env;
    const logger = options.logger || console;
    const sessionStore =
        options.sessionStore ||
        new PgSessionStore({
            pool,
            tableName: "web_sessions",
            createTableIfMissing: true,
            errorLog: (err) => logger.warn(`[session-store] ${err.message || err}`)
        });
    const authRateLimiter = createRateLimiter({
        windowMs: finiteNumber(env.PO18_AUTH_RATE_WINDOW_MS, 15 * 60 * 1000),
        max: finiteNumber(env.PO18_AUTH_RATE_MAX, 20)
    });
    const publicLookupRateLimiter = createRateLimiter({
        windowMs: finiteNumber(env.PO18_PUBLIC_LOOKUP_RATE_WINDOW_MS, 60 * 1000),
        max: finiteNumber(env.PO18_PUBLIC_LOOKUP_RATE_MAX, 120)
    });
    const ttsRateLimiter = createRateLimiter({
        windowMs: finiteNumber(env.PO18_TTS_RATE_WINDOW_MS, 60 * 1000),
        max: finiteNumber(env.PO18_TTS_RATE_MAX, 30)
    });
    const uploadRateLimiter = createRateLimiter({
        windowMs: finiteNumber(env.PO18_UPLOAD_RATE_WINDOW_MS, 60 * 1000),
        max: finiteNumber(env.PO18_UPLOAD_RATE_MAX, 600)
    });

    app.use(createRequestLogger({ service: "server-pg", slowMs: requestSlowMs, skip: (req) => req.path === "/favicon.ico" }));
    app.use(createErrorResponseNormalizer());
    app.use(cors({ origin: corsOriginCallback(), credentials: true }));
    attachExpressPanel(app, { configFile });
    app.use(compression());
    app.use(
        [
            "/admin-api/auth/login",
            "/reader-auth/login",
            "/reader-auth/register",
            "/reader-auth/telegram",
            "/signup/login",
            "/signup/register"
        ],
        authRateLimiter
    );
    app.use("/api/parse/check-cache", publicLookupRateLimiter);
    app.use("/reader-api/tts", ttsRateLimiter);
    app.use(["/api/parse/chapter-content", "/api/metadata/batch"], uploadRateLimiter);
    installRouteBodyParsers(app, express);
    app.use(createRequestSchemaValidation());
    app.use(startupGate.middleware);
    app.use(["/reader-api", "/reader-auth"], (req, res, next) => {
        delete req.headers["if-none-match"];
        delete req.headers["if-modified-since"];
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        next();
    });
    app.use(
        session({
            name: "po18_upload_admin_pg",
            secret: sessionSecret,
            store: sessionStore,
            resave: false,
            saveUninitialized: false,
            cookie: {
                httpOnly: true,
                sameSite: "lax",
                secure: env.NODE_ENV === "production" ? "auto" : false,
                maxAge: 1000 * 60 * 60 * 24 * 30
            }
        })
    );
    app.use(createCsrfProtection({ cookieName: "po18_upload_admin_pg" }));
    app.use(createAdminAuditMiddleware({ query, logEvent }));
}

module.exports = {
    finiteNumber,
    installHttpPipeline
};
