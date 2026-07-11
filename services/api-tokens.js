const crypto = require("crypto");

const DEFAULT_BOT_SCOPES = ["bot:read", "bot:user", "bot:export", "bot:po18"];

function tokenHash(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function tokenPrefix(token) {
    const raw = String(token || "");
    return raw.length <= 8 ? raw.slice(0, 2) : `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function scopeList(value, fallback = []) {
    const rows = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
    const scopes = [...new Set(rows.map((item) => String(item || "").trim()).filter(Boolean))];
    return scopes.length ? scopes : fallback.slice();
}

function requestIp(req) {
    return String(req?.ip || req?.socket?.remoteAddress || "").replace(/^::ffff:/, "").trim().slice(0, 100);
}

function createApiTokenService(options = {}) {
    const query = options.query;
    const cacheTtlMs = Math.max(1000, Number(options.cacheTtlMs || 15000));
    const cache = new Map();
    const usageUpdates = new Map();
    if (typeof query !== "function") throw new Error("api token query function is required");

    async function syncToken({ name, kind, token, scopes, allowedIps = [] }) {
        const raw = String(token || "").trim();
        if (!raw) return null;
        const hash = tokenHash(raw);
        const result = await query(
            `INSERT INTO api_tokens(name, kind, token_hash, token_prefix, scopes_json, allowed_ips_json)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)
             ON CONFLICT (token_hash) DO UPDATE SET
                name=EXCLUDED.name, kind=EXCLUDED.kind, token_prefix=EXCLUDED.token_prefix,
                scopes_json=EXCLUDED.scopes_json, allowed_ips_json=EXCLUDED.allowed_ips_json,
                updated_at=CURRENT_TIMESTAMP
             RETURNING id, name, kind, token_prefix, scopes_json, allowed_ips_json, revoked_at, created_at, updated_at`,
            [
                String(name || kind || "token").slice(0, 120),
                String(kind || "bot").slice(0, 40),
                hash,
                tokenPrefix(raw),
                JSON.stringify(scopeList(scopes)),
                JSON.stringify(scopeList(allowedIps))
            ]
        );
        cache.delete(hash);
        return result.rows[0] || null;
    }

    async function syncConfiguredTokens(input = {}) {
        const rows = [];
        if (input.botToken) {
            rows.push(await syncToken({
                name: "telegram-bot-runtime",
                kind: "bot",
                token: input.botToken,
                scopes: scopeList(input.botScopes, DEFAULT_BOT_SCOPES),
                allowedIps: input.botAllowedIps
            }));
        }
        if (input.uploadToken) {
            rows.push(await syncToken({
                name: "upload-runtime",
                kind: "upload",
                token: input.uploadToken,
                scopes: ["crawler:write"],
                allowedIps: input.uploadAllowedIps
            }));
        }
        return rows.filter(Boolean);
    }

    async function tokenRecord(hash) {
        const cached = cache.get(hash);
        if (cached && Date.now() - cached.at < cacheTtlMs) return cached.row;
        const result = await query(
            `SELECT id, name, kind, token_prefix, scopes_json, allowed_ips_json, revoked_at
             FROM api_tokens WHERE token_hash=$1 LIMIT 1`,
            [hash]
        );
        const row = result.rows[0] || null;
        cache.set(hash, { at: Date.now(), row });
        return row;
    }

    async function authenticate({ token, kind, scope, req }) {
        const raw = String(token || "").trim();
        if (!raw) return { ok: false, status: 401, error: `${kind} API token missing` };
        const hash = tokenHash(raw);
        const row = await tokenRecord(hash);
        if (!row || row.kind !== kind || row.revoked_at) return { ok: false, status: 401, error: `${kind} API token invalid or revoked` };
        const scopes = scopeList(row.scopes_json);
        if (scope && !scopes.includes("*") && !scopes.includes(scope)) return { ok: false, status: 403, error: `API token scope required: ${scope}` };
        const ip = requestIp(req);
        const allowedIps = scopeList(row.allowed_ips_json);
        if (allowedIps.length && !allowedIps.includes(ip)) return { ok: false, status: 403, error: "API token source IP denied" };
        const lastUpdate = usageUpdates.get(row.id) || 0;
        if (Date.now() - lastUpdate > 60000) {
            usageUpdates.set(row.id, Date.now());
            Promise.resolve(query(
                "UPDATE api_tokens SET last_used_at=CURRENT_TIMESTAMP, last_used_ip=$2 WHERE id=$1",
                [row.id, ip]
            )).catch(() => {});
        }
        return { ok: true, token: { id: row.id, name: row.name, kind: row.kind, scopes, prefix: row.token_prefix } };
    }

    async function listTokens() {
        const result = await query(
            `SELECT id, name, kind, token_prefix, scopes_json, allowed_ips_json, revoked_at,
                    last_used_at, last_used_ip, created_at, updated_at
             FROM api_tokens ORDER BY id DESC`
        );
        return { rows: result.rows };
    }

    async function revokeToken(id) {
        const result = await query(
            `UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
             WHERE id=$1 RETURNING id, name, kind, token_prefix, scopes_json, revoked_at`,
            [id]
        );
        cache.clear();
        return result.rows[0] || null;
    }

    return { authenticate, listTokens, revokeToken, syncConfiguredTokens, syncToken };
}

function botScopeForRequest(req) {
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || req.url || "").split("?")[0];
    if (/\/po18(?:\/credentials)?$/.test(path) || /\/po18\//.test(path)) return "bot:po18";
    if (/\/jobs(?:\/|$)|export/.test(path)) return "bot:export";
    if (/\/users\/import/.test(path) && method !== "GET") return "bot:admin";
    if (/\/currency$/.test(path) && method !== "GET") {
        return String(req.body?.type || "") === "po18_bookshelf_share_reward" ? "bot:user" : "bot:admin";
    }
    if (method === "GET" || path === "/bot-api/health" || path === "/bot-api/commands") return "bot:read";
    return "bot:user";
}

module.exports = {
    DEFAULT_BOT_SCOPES,
    botScopeForRequest,
    createApiTokenService,
    requestIp,
    scopeList,
    tokenHash,
    tokenPrefix
};
