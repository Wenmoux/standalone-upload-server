const { allowedCorsOrigins } = require("./http-security");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOrigin(value) {
    try {
        return new URL(String(value || "").trim()).origin.toLowerCase();
    } catch {
        return "";
    }
}

function forwardedValue(value) {
    return String(value || "").split(",")[0].trim();
}

function requestOrigin(req) {
    const origin = String(req.headers?.origin || "").trim();
    if (origin) return origin === "null" ? "" : normalizeOrigin(origin);
    const referer = String(req.headers?.referer || "").trim();
    return referer ? normalizeOrigin(referer) : "";
}

function expectedOrigin(req) {
    const protocol = forwardedValue(req.headers?.["x-forwarded-proto"]) || req.protocol || "http";
    const host = forwardedValue(req.headers?.["x-forwarded-host"] || req.headers?.host);
    return host ? normalizeOrigin(`${protocol}://${host}`) : "";
}

function trustedOrigins(req, env = process.env) {
    const origins = new Set(allowedCorsOrigins(env).map(normalizeOrigin).filter(Boolean));
    const expected = expectedOrigin(req);
    if (expected) origins.add(expected);
    for (const value of [env.PO18_READER_PUBLIC_URL, env.READER_PUBLIC_URL]) {
        const origin = normalizeOrigin(value);
        if (origin) origins.add(origin);
    }
    try {
        const expectedUrl = new URL(expected);
        const readerPort = String(env.PO18_READER_PORT || "3200").trim();
        if (readerPort) origins.add(`${expectedUrl.protocol}//${expectedUrl.hostname}:${readerPort}`.toLowerCase());
    } catch {
        // A missing Host header is rejected when a browser Origin is present.
    }
    return origins;
}

function hasSessionCookie(req, cookieName = "po18_upload_admin_pg") {
    return String(req.headers?.cookie || "")
        .split(";")
        .some((item) => item.trim().startsWith(`${cookieName}=`));
}

function needsCsrfProtection(req, cookieName) {
    if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) return false;
    const path = String(req.path || req.url || "").split("?")[0];
    if (path.startsWith("/admin-api/") || path.startsWith("/reader-api/") || path.startsWith("/reader-auth/")) return true;
    return !!req.session?.adminUser || !!req.session?.readerUser || hasSessionCookie(req, cookieName);
}

function createCsrfProtection(options = {}) {
    const env = options.env || process.env;
    const cookieName = options.cookieName || "po18_upload_admin_pg";
    return function csrfProtection(req, res, next) {
        if (!needsCsrfProtection(req, cookieName)) return next();
        const origin = requestOrigin(req);
        const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
        if (origin) {
            if (trustedOrigins(req, env).has(origin)) return next();
            return res.status(403).json({ error: "跨站写请求已拒绝" });
        }
        if (fetchSite === "cross-site") return res.status(403).json({ error: "跨站写请求已拒绝" });
        if (hasSessionCookie(req, cookieName) && env.PO18_CSRF_ALLOW_MISSING_ORIGIN !== "1") {
            return res.status(403).json({ error: "缺少写请求来源信息" });
        }
        next();
    };
}

module.exports = {
    createCsrfProtection,
    expectedOrigin,
    hasSessionCookie,
    needsCsrfProtection,
    normalizeOrigin,
    requestOrigin,
    trustedOrigins
};
