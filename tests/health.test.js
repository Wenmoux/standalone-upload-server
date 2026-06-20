const assert = require("assert/strict");
const test = require("node:test");
const { checkResult, createHealthService, databaseErrorDetail, maskedTelegramUrl } = require("../services/health");

test("health checkResult keeps optional and skipped metadata", () => {
    const result = checkResult("bot", true, { required: false, skipped: true, detail: "not configured" });
    assert.equal(result.name, "bot");
    assert.equal(result.ok, true);
    assert.equal(result.required, false);
    assert.equal(result.skipped, true);
    assert.equal(result.detail, "not configured");
});

test("health schema check reports missing required tables", async () => {
    const health = createHealthService({
        requiredTables: ["book_metadata", "chapter_cache"],
        query: async () => ({ rows: [{ table_name: "book_metadata" }] })
    });
    const result = await health.schemaHealthCheck();
    assert.equal(result.ok, false);
    assert.deepEqual(result.body.missing_tables, ["chapter_cache"]);
});

test("health ready payload includes database, schema and pool state", async () => {
    const health = createHealthService({
        serviceName: "test-server",
        startedAt: Date.UTC(2026, 0, 1),
        requiredTables: ["book_metadata"],
        pool: { totalCount: 2, idleCount: 1, waitingCount: 0 },
        query: async (sql) => {
            if (/information_schema\.tables/.test(sql)) return { rows: [{ table_name: "book_metadata" }] };
            return { rows: [{ ok: 1 }] };
        }
    });
    const ready = await health.collectReadyHealth();
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.payload.service, "test-server");
    assert.equal(ready.payload.db.ok, true);
    assert.equal(ready.payload.schema.ok, true);
    assert.deepEqual(ready.payload.pool, { total: 2, idle: 1, waiting: 0 });
});

test("health masks telegram bot token in diagnostic URL", () => {
    assert.equal(maskedTelegramUrl("https://api.telegram.org/"), "https://api.telegram.org/bot<TOKEN>/getMe");
});

test("health collapses postgres recovery errors into a friendly detail", () => {
    assert.equal(databaseErrorDetail({ code: "57P03", message: "the database system is in recovery mode" }), "PostgreSQL is starting or recovering");
    assert.equal(databaseErrorDetail({ message: "the database system is not yet accepting connections" }), "PostgreSQL is starting or recovering");
});
