const { query: defaultQuery } = require("../pg-store");

const STATUSES = new Set(["succeeded", "failed", "queued", "ignored"]);

function text(value, max = 500) {
    return String(value ?? "").trim().slice(0, max);
}

function safeInt(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function compactDetails(value = {}) {
    if (!value || typeof value !== "object") return {};
    const json = JSON.stringify(value);
    if (json.length <= 12000) return value;
    return {
        truncated: true,
        original_bytes: Buffer.byteLength(json),
        keys: Array.isArray(value) ? [] : Object.keys(value).slice(0, 40)
    };
}

function normalizeAuditPayload(payload = {}) {
    const status = text(payload.status || "succeeded", 32);
    return {
        telegram_id: text(payload.telegram_id ?? payload.telegramId, 80),
        telegram_username: text(payload.telegram_username ?? payload.telegramUsername, 80).replace(/^@+/, ""),
        chat_id: text(payload.chat_id ?? payload.chatId, 80),
        chat_type: text(payload.chat_type ?? payload.chatType, 32),
        command: text(payload.command, 80).toLowerCase(),
        action: text(payload.action, 120),
        status: STATUSES.has(status) ? status : "succeeded",
        error_code: text(payload.error_code ?? payload.errorCode, 120),
        error: text(payload.error, 2000),
        duration_ms: safeInt(payload.duration_ms ?? payload.durationMs, 0),
        details_json: compactDetails(payload.details_json ?? payload.details ?? {})
    };
}

function normalizeAuditRow(row = {}) {
    return {
        ...row,
        duration_ms: safeInt(row.duration_ms, 0),
        details_json: row.details_json || {}
    };
}

function createBotAuditService(options = {}) {
    const query = options.query || defaultQuery;

    async function recordBotAuditLog(payload = {}) {
        const row = normalizeAuditPayload(payload);
        const result = await query(
            `INSERT INTO bot_audit_logs (
                telegram_id, telegram_username, chat_id, chat_type,
                command, action, status, error_code, error, duration_ms, details_json
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
             RETURNING id, telegram_id, telegram_username, chat_id, chat_type,
                       command, action, status, error_code, error, duration_ms,
                       details_json, created_at`,
            [
                row.telegram_id,
                row.telegram_username,
                row.chat_id,
                row.chat_type,
                row.command,
                row.action,
                row.status,
                row.error_code,
                row.error,
                row.duration_ms,
                JSON.stringify(row.details_json)
            ]
        );
        return normalizeAuditRow(result.rows[0] || row);
    }

    async function listBotAuditLogs(filters = {}) {
        const limit = Math.min(200, Math.max(1, safeInt(filters.limit, 50)));
        const where = [];
        const params = [];
        if (filters.status) {
            params.push(text(filters.status, 32));
            where.push(`status = $${params.length}`);
        }
        if (filters.command) {
            params.push(text(filters.command, 80).toLowerCase());
            where.push(`command = $${params.length}`);
        }
        if (filters.telegramId || filters.telegram_id) {
            params.push(text(filters.telegramId ?? filters.telegram_id, 80));
            where.push(`telegram_id = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const result = await query(
            `SELECT id, telegram_id, telegram_username, chat_id, chat_type,
                    command, action, status, error_code, error, duration_ms,
                    details_json, created_at
             FROM bot_audit_logs
             ${whereSql}
             ORDER BY created_at DESC, id DESC
             LIMIT $${params.length + 1}`,
            [...params, limit]
        );
        return { rows: (result.rows || []).map(normalizeAuditRow), limit };
    }

    async function collectBotAuditSummary(options = {}) {
        const sinceDays = Math.min(30, Math.max(1, safeInt(options.sinceDays, 7)));
        const [totals, commands, failures] = await Promise.all([
            query(
                `SELECT
                    COUNT(*)::int total,
                    COUNT(*) FILTER (WHERE status = 'failed')::int failed,
                    COUNT(DISTINCT NULLIF(telegram_id, ''))::int users
                 FROM bot_audit_logs
                 WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')`,
                [sinceDays]
            ),
            query(
                `SELECT command, action, COUNT(*)::int count,
                        COUNT(*) FILTER (WHERE status = 'failed')::int failed
                 FROM bot_audit_logs
                 WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')
                 GROUP BY command, action
                 ORDER BY count DESC
                 LIMIT 12`,
                [sinceDays]
            ),
            query(
                `SELECT COALESCE(NULLIF(error_code, ''), NULLIF(error, ''), 'unknown') reason,
                        COUNT(*)::int count
                 FROM bot_audit_logs
                 WHERE status = 'failed'
                   AND created_at > NOW() - ($1::int * INTERVAL '1 day')
                 GROUP BY reason
                 ORDER BY count DESC
                 LIMIT 8`,
                [sinceDays]
            )
        ]);
        return {
            since_days: sinceDays,
            totals: totals.rows[0] || { total: 0, failed: 0, users: 0 },
            commands: commands.rows || [],
            failure_reasons: failures.rows || []
        };
    }

    return {
        recordBotAuditLog,
        listBotAuditLogs,
        collectBotAuditSummary
    };
}

module.exports = {
    createBotAuditService,
    normalizeAuditPayload
};
