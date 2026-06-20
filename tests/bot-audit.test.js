const assert = require("assert/strict");
const test = require("node:test");
const { createBotAuditService, normalizeAuditPayload } = require("../services/bot-audit");

test("bot audit service normalizes payload and writes compact json", async () => {
    const calls = [];
    const service = createBotAuditService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return {
                rows: [{
                    id: 1,
                    telegram_id: params[0],
                    command: params[4],
                    status: params[6],
                    details_json: JSON.parse(params[10]),
                    duration_ms: params[9],
                    created_at: "2026-06-05T00:00:00.000Z"
                }]
            };
        }
    });

    const payload = normalizeAuditPayload({
        telegramId: 42,
        telegramUsername: "@reader",
        command: "/Search",
        status: "bad",
        durationMs: "12",
        details: { a: 1 }
    });
    assert.equal(payload.status, "succeeded");
    assert.equal(payload.telegram_username, "reader");
    assert.equal(payload.command, "/search");

    const row = await service.recordBotAuditLog(payload);
    assert.equal(row.id, 1);
    assert.equal(row.command, "/search");
    assert.deepEqual(row.details_json, { a: 1 });
    assert.match(calls[0].sql, /INSERT INTO bot_audit_logs/);
});

test("bot audit service lists with filters and builds summary", async () => {
    const calls = [];
    const service = createBotAuditService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/SELECT id, telegram_id/.test(sql)) return { rows: [{ id: 2, command: "/search", duration_ms: 3, details_json: {} }] };
            if (/COUNT\(\*\)::int total/.test(sql)) return { rows: [{ total: 5, failed: 1, users: 2 }] };
            if (/GROUP BY command, action/.test(sql)) return { rows: [{ command: "/search", action: "search", count: 4, failed: 0 }] };
            return { rows: [{ reason: "EXPORT_NO_CONTENT", count: 1 }] };
        }
    });

    const list = await service.listBotAuditLogs({ limit: 500, status: "failed", command: "/search", telegramId: 42 });
    assert.equal(list.limit, 200);
    assert.equal(list.rows[0].id, 2);
    assert.deepEqual(calls[0].params, ["failed", "/search", "42", 200]);

    const summary = await service.collectBotAuditSummary({ sinceDays: 9 });
    assert.equal(summary.since_days, 9);
    assert.equal(summary.totals.total, 5);
    assert.equal(summary.commands[0].command, "/search");
    assert.equal(summary.failure_reasons[0].reason, "EXPORT_NO_CONTENT");
});
