const assert = require("assert/strict");
const test = require("node:test");
const {
    collectReaderAssetBudget,
    createMetricsSummary,
    createPrometheusMetricsText,
    createRequireMetrics,
    metricLine,
    readerPerformanceSummary
} = require("../routes/health");

test("metricLine escapes label values", () => {
    assert.equal(
        metricLine("po18_test", { path: '/a"b', line: "x\ny", slash: "a\\b" }, 3),
        'po18_test{path="/a\\"b",line="x\\ny",slash="a\\\\b"} 3'
    );
});

test("prometheus metrics text aggregates request, event and bot queue data", async () => {
    const metricsText = createPrometheusMetricsText({
        serviceName: "test-pg",
        requestLogFile: "requests",
        slowLogFile: "slow",
        eventLogFile: "events",
        pool: { totalCount: 4, idleCount: 2, waitingCount: 1 },
        botTokenProvider: () => "bot-token",
        botHealthUrlProvider: () => "http://bot/health",
        healthService: {
            httpHealthCheck: async () => ({
                body: { background_tasks: { running: 1, queued: 2, locks: 3, concurrency: 4 } }
            })
        },
        readJsonLinesTail: (file) => {
            if (file === "requests") {
                return [
                    { service: "server", method: "GET", path: "/reader-api/search", status: 200, duration_ms: 10 },
                    { service: "server", method: "GET", path: "/reader-api/search", status: 200, duration_ms: 20 },
                    { service: "server", method: "POST", path: "/bot-api/x", status: 503, duration_ms: 5 }
                ];
            }
            if (file === "slow") return [{ duration_ms: 900 }];
            if (file === "events") return [{ event: "backup-created", level: "info" }, { event: "other", level: "info" }];
            return [];
        }
    });

    const text = await metricsText();

    assert.match(text, /po18_db_pool_connections\{state="total"\} 4/);
    assert.match(text, /po18_http_requests_total\{service="server",method="GET",path="\/reader-api\/search",status="200"\} 2/);
    assert.match(text, /po18_reader_api_duration_ms_sum 30/);
    assert.match(text, /po18_reader_endpoint_p95_ms\{endpoint="search"\} 20/);
    assert.match(text, /po18_bot_api_errors_total 1/);
    assert.match(text, /po18_backup_events_total\{event="backup-created",level="info"\} 1/);
    assert.match(text, /po18_bot_queue_jobs\{state="queued"\} 2/);
});

test("reader performance summary groups core reader endpoints and budgets", () => {
    const summary = readerPerformanceSummary([
        { path: "/reader-api/search", duration_ms: 100 },
        { path: "/reader-api/search", duration_ms: 250 },
        { path: "/reader-api/books/b1", duration_ms: 120 },
        { path: "/reader-api/books/b1/chapters", duration_ms: 700 },
        { path: "/reader-api/books/b1/chapters/c1", duration_ms: 800 },
        { path: "/reader-api/books/b1/chapters/c1/html", duration_ms: 1300 },
        { path: "/reader-api/other", duration_ms: "bad" }
    ], {
        search_p95_ms: 200,
        detail_p95_ms: 300,
        catalog_p95_ms: 900,
        chapter_p95_ms: 1200
    });

    const byName = Object.fromEntries(summary.endpoints.map((item) => [item.name, item]));
    assert.equal(byName.search.count, 2);
    assert.equal(byName.search.p95_ms, 250);
    assert.equal(byName.search.ok, false);
    assert.equal(byName.detail.p95_ms, 120);
    assert.equal(byName.catalog.ok, true);
    assert.equal(byName.chapter.p95_ms, 1300);
    assert.deepEqual(summary.breached, ["search", "chapter"]);
    assert.equal(summary.ok, false);
});

test("metrics summary returns reader p95, endpoint budgets and asset checks", async (t) => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "po18-reader-assets-"));
    t.after(() => fs.rmSync(distDir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(distDir, "reader.js"), "x".repeat(12));
    fs.writeFileSync(path.join(distDir, "reader.css"), "x".repeat(6));

    const metricsSummary = createMetricsSummary({
        readerDistDir: distDir,
        requestLogFile: "requests",
        slowLogFile: "slow",
        eventLogFile: "events",
        readerPerformanceBudgets: {
            search_p95_ms: 200,
            detail_p95_ms: 200,
            catalog_p95_ms: 200,
            chapter_p95_ms: 200,
            reader_entry_js_bytes: 10,
            reader_entry_css_bytes: 10
        },
        readJsonLinesTail: (file) => {
            if (file === "requests") {
                return [
                    { path: "/reader-api/search", status: 200, duration_ms: 50 },
                    { path: "/reader-api/search", status: 200, duration_ms: 250 },
                    { path: "/reader-api/books/b1", status: 200, duration_ms: 120 },
                    { path: "/bot-api/jobs/1", status: 200, duration_ms: 10 }
                ];
            }
            return [];
        }
    });

    const payload = await metricsSummary();

    assert.equal(payload.reader_api.total, 3);
    assert.equal(payload.reader_api.p95_duration_ms, 250);
    assert.equal(payload.reader_performance.breached[0], "search");
    assert.equal(payload.reader_assets.available, true);
    assert.equal(payload.reader_assets.checks.find((item) => item.name === "reader largest js").ok, false);
    assert.equal(collectReaderAssetBudget(distDir, { reader_entry_js_bytes: 20, reader_entry_css_bytes: 20 }).checks.every((item) => item.ok), true);
});

test("metrics middleware allows empty token, bearer token and rejects bad token", () => {
    let passed = 0;
    const next = () => { passed += 1; };
    const emptyToken = createRequireMetrics({ metricsTokenProvider: () => "" });
    emptyToken({ get: () => "", query: {} }, {}, next);
    assert.equal(passed, 1);

    const bearerToken = createRequireMetrics({ metricsTokenProvider: () => "secret-token" });
    bearerToken({ get: () => "Bearer secret-token", query: {} }, {}, next);
    assert.equal(passed, 2);

    let statusCode = 0;
    let body = "";
    bearerToken(
        { get: () => "", query: { token: "bad-token" } },
        {
            status(code) {
                statusCode = code;
                return this;
            },
            send(text) {
                body = text;
            }
        },
        next
    );
    assert.equal(statusCode, 401);
    assert.equal(body, "metrics token invalid\n");
    assert.equal(passed, 2);
});
