const SECRET_KEY = /(token|password|passwd|pwd|secret|cookie|authorization|pg_?url|database_?url|config)/i;

function sanitizeAuditValue(value, key = "", depth = 0) {
    if (SECRET_KEY.test(String(key || ""))) return "<redacted>";
    if (value === null || value === undefined) return value ?? null;
    if (depth >= 4) return "<max-depth>";
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeAuditValue(item, "", depth + 1));
    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 60)
                .map(([childKey, childValue]) => [childKey, sanitizeAuditValue(childValue, childKey, depth + 1)])
        );
    }
    return String(value).slice(0, 500);
}

function auditAction(req) {
    const method = String(req.method || "").toUpperCase();
    const path = String(req.path || req.url || "").split("?")[0];
    const normalized = path
        .replace(/^\/admin-api\/?/, "")
        .replace(/\d+/g, ":id")
        .replace(/[^a-zA-Z0-9:_/-]+/g, "_")
        .replace(/\//g, ".");
    return `${method.toLowerCase()}.${normalized || "admin"}`.slice(0, 160);
}

function auditReason(body = {}) {
    return String(body.reason || body.audit_reason || body.auditReason || "").trim().slice(0, 500);
}

function requestIp(req) {
    return String(req.ip || req.socket?.remoteAddress || "").trim().slice(0, 100);
}

function positiveInt(value, fallback, max) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number) || number < 1) return fallback;
    return Math.min(number, max);
}

async function listAdminAuditLogs(query, input = {}) {
    const page = positiveInt(input.page, 1, 1000000);
    const limit = positiveInt(input.limit, 50, 200);
    const offset = (page - 1) * limit;
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replace("?", `$${params.length}`));
    };
    const actor = String(input.actor || input.username || "").trim();
    const action = String(input.action || "").trim();
    const method = String(input.method || "").trim().toUpperCase();
    const requestId = String(input.request_id || input.requestId || "").trim();
    const status = Math.trunc(Number(input.status || input.status_code || 0));
    if (actor) add("actor_username ILIKE '%' || ? || '%'", actor.slice(0, 120));
    if (action) add("action ILIKE '%' || ? || '%'", action.slice(0, 160));
    if (method) add("method = ?", method.slice(0, 12));
    if (requestId) add("request_id = ?", requestId.slice(0, 100));
    if (Number.isFinite(status) && status >= 100 && status <= 599) add("status_code = ?", status);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await query(`SELECT COUNT(*)::int total FROM admin_audit_logs ${whereSql}`, params);
    const rows = await query(
        `SELECT id, actor_id, actor_username, method, path, action, status_code, reason,
                request_id, ip_address, user_agent, details_json, created_at
         FROM admin_audit_logs
         ${whereSql}
         ORDER BY id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
    );
    return { rows: rows.rows, total: Number(count.rows[0]?.total || 0), page, limit };
}

function createAdminAuditMiddleware(options = {}) {
    const query = options.query;
    const logEvent = options.logEvent || (() => {});
    if (typeof query !== "function") throw new Error("admin audit query function is required");

    return function adminAudit(req, res, next) {
        const path = String(req.path || req.url || "").split("?")[0];
        const method = String(req.method || "GET").toUpperCase();
        if (!path.startsWith("/admin-api/") || ["GET", "HEAD", "OPTIONS"].includes(method)) return next();

        const initialActor = req.session?.adminUser ? { ...req.session.adminUser } : null;
        const startedAt = Date.now();
        res.on("finish", () => {
            const actor = initialActor || req.session?.adminUser || {};
            const actorUsername = String(actor.username || (path === "/admin-api/auth/login" ? req.body?.username || "" : "")).slice(0, 120);
            const details = sanitizeAuditValue({
                body: req.body || {},
                query: req.query || {},
                duration_ms: Date.now() - startedAt
            });
            Promise.resolve(query(
                `INSERT INTO admin_audit_logs(
                    actor_id, actor_username, method, path, action, status_code, reason,
                    request_id, ip_address, user_agent, details_json
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
                [
                    Number.isSafeInteger(Number(actor.id)) ? Number(actor.id) : null,
                    actorUsername,
                    method,
                    path.slice(0, 500),
                    auditAction(req),
                    Number(res.statusCode || 0),
                    auditReason(req.body || {}),
                    String(req.requestId || "").slice(0, 100),
                    requestIp(req),
                    String(req.headers?.["user-agent"] || "").slice(0, 500),
                    JSON.stringify(details)
                ]
            )).catch((err) => {
                logEvent("warn", "server-pg", "admin-audit-write-failed", {
                    request_id: String(req.requestId || ""),
                    method,
                    path,
                    error: err.message || String(err)
                });
            });
        });
        next();
    };
}

module.exports = {
    auditAction,
    auditReason,
    createAdminAuditMiddleware,
    listAdminAuditLogs,
    sanitizeAuditValue
};
