/**
 * [INPUT]: 依赖 Express 应用、静态产物、数据库初始化、管理员凭据、启动闸门和可选调度器
 * [OUTPUT]: 对外提供静态/错误路由安装、默认管理员初始化及可重试应用启动生命周期
 * [POS]: services 的应用生命周期边界，使 server-pg 组合根只声明依赖而不承载启动状态机与静态路由细节
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");

function requestHostWithoutPort(req) {
    const raw = String(req.headers["x-forwarded-host"] || req.get("host") || "")
        .split(",")[0]
        .trim();
    if (!raw) return "localhost";
    if (raw.startsWith("[")) return raw.replace(/:\d+$/, "");
    return raw.split(":")[0] || "localhost";
}

function readerRedirectUrl(req, configuredUrl = "") {
    const configured = String(configuredUrl || "").trim();
    if (configured) return configured;
    const protocol =
        String(req.headers["x-forwarded-proto"] || req.protocol || "http")
            .split(",")[0]
            .trim() || "http";
    return `${protocol}://${requestHostWithoutPort(req)}:3200/`;
}

function installStaticAndErrorRoutes(options = {}) {
    const app = options.app;
    const express = options.express;
    const publicDir = options.publicDir || path.join(options.projectDir, "public");
    const readerPublicUrlProvider = options.readerPublicUrlProvider || (() => "");
    const isDatabaseError = options.isDatabaseError || (() => false);
    const databaseErrorMessage = options.databaseErrorMessage || ((err) => err.message || "Database unavailable");
    const logger = options.logger || console;

    app.get("/favicon.ico", (req, res) => res.status(204).end());
    app.get("/reader", (req, res) => res.redirect(302, readerRedirectUrl(req, readerPublicUrlProvider())));
    app.use((req, res, next) => {
        const blockedPrefixes = ["/cirno", "/cirno-app", "/cirno-root"];
        if (blockedPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
            res.status(404).json({ error: "Not Found" });
            return;
        }
        next();
    });
    app.get("/rank", (req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(publicDir, "rank.html"));
    });
    app.get(["/admin", "/admin/*"], (req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(publicDir, "index.html"));
    });
    app.use(
        "/",
        express.static(publicDir, {
            etag: true,
            lastModified: true,
            maxAge: "1h",
            setHeaders(res, filePath) {
                if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
            }
        })
    );
    app.use((err, req, res, _next) => {
        if (isDatabaseError(err)) {
            logger.warn(`[request-db] ${req.method} ${req.originalUrl}: ${err.message}`);
            return res.status(503).json({ error: databaseErrorMessage(err), code: err.code || "" });
        }
        logger.error(err);
        const body = { error: err.message || "Internal Server Error" };
        if (err.expectedConfirm) body.expectedConfirm = err.expectedConfirm;
        res.status(err.status || 500).json(body);
    });
}

function createApplicationRuntime(options = {}) {
    const query = options.query;
    const initPg = options.initPg;
    const syncConfiguredTokens = options.syncConfiguredTokens;
    const configuredTokensProvider = options.configuredTokensProvider || (() => ({}));
    const encryptStoredCredentials = options.encryptStoredCredentials || (async () => ({ updated: 0, scanned: 0 }));
    const credentialCrypto = options.credentialCrypto;
    const defaultAdmin = options.defaultAdmin;
    const defaultPassword = options.defaultPassword;
    const hashPassword = options.hashPassword;
    const startupGate = options.startupGate;
    const schedulers = options.schedulers || [];
    const isDatabaseError = options.isDatabaseError || (() => false);
    const startupDbRetryMs = Number(options.startupDbRetryMs || 5000);
    const startupFailureRetryMs = Number(options.startupFailureRetryMs || Math.max(60000, startupDbRetryMs));
    const logger = options.logger || console;
    const schedule = options.schedule || setTimeout;

    async function initAdmin() {
        const found = await query("SELECT id FROM admin_users WHERE username = $1", [defaultAdmin]);
        if (found.rows.length) return;
        const { salt, hash } = hashPassword(defaultPassword);
        await query("INSERT INTO admin_users(username, password_hash, salt, role) VALUES ($1,$2,$3,'owner')", [defaultAdmin, hash, salt]);
    }

    async function bootApplication() {
        await initPg();
        await syncConfiguredTokens(configuredTokensProvider());
        const encryptedCredentials = await encryptStoredCredentials(query, credentialCrypto);
        if (encryptedCredentials.updated) {
            logger.log(`[startup] encrypted ${encryptedCredentials.updated}/${encryptedCredentials.scanned} PO18 credential rows`);
        }
        await initAdmin();
    }

    function startBackgroundSchedulers() {
        for (const [name, start] of schedulers) {
            Promise.resolve()
                .then(start)
                .catch((err) => logger.warn(`[startup] optional ${name} scheduler disabled: ${err.message || String(err)}`));
        }
    }

    function scheduleRetry(attempt, delayMs) {
        const timer = schedule(() => bootApplicationWithRetry(attempt), delayMs);
        if (timer && typeof timer.unref === "function") timer.unref();
    }

    function bootApplicationWithRetry(attempt = 1) {
        startupGate.markWaiting(
            attempt > 1 ? `Database initialization retry ${attempt}` : "Database migrations and startup initialization are in progress"
        );
        return bootApplication()
            .then(() => {
                startupGate.markReady();
                logger.log("[startup] database initialized");
                startBackgroundSchedulers();
            })
            .catch((err) => {
                const message = err.message || String(err);
                if (isDatabaseError(err)) {
                    startupGate.markWaiting("Database unavailable; startup will retry");
                    logger.warn(`[startup] database unavailable (${message}); retrying in ${startupDbRetryMs}ms`);
                    scheduleRetry(attempt + 1, startupDbRetryMs);
                    return;
                }
                startupGate.markFailed("Application startup failed; inspect server logs");
                logger.error(`[startup] ${message}; retrying in ${startupFailureRetryMs}ms`);
                scheduleRetry(attempt + 1, startupFailureRetryMs);
            });
    }

    return {
        bootApplication,
        bootApplicationWithRetry,
        initAdmin,
        startBackgroundSchedulers
    };
}

module.exports = {
    createApplicationRuntime,
    installStaticAndErrorRoutes,
    readerRedirectUrl,
    requestHostWithoutPort
};
