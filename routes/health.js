const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");

const DEFAULT_READER_PERFORMANCE_BUDGETS = {
    search_p95_ms: 900,
    detail_p95_ms: 700,
    catalog_p95_ms: 900,
    chapter_p95_ms: 1200,
    reader_entry_js_bytes: 900 * 1024,
    reader_entry_css_bytes: 220 * 1024
};

function timingSafeEqualText(actual, expected) {
    const left = Buffer.from(String(actual || ""));
    const right = Buffer.from(String(expected || ""));
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function metricLabelValue(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function metricLine(name, labels, value) {
    const labelText = Object.entries(labels || {})
        .filter(([, val]) => val !== undefined && val !== null && val !== "")
        .map(([key, val]) => `${key}="${metricLabelValue(val)}"`)
        .join(",");
    return `${name}${labelText ? `{${labelText}}` : ""} ${Number(value || 0)}`;
}

function groupedMetrics(rows, keyFn) {
    const map = new Map();
    for (const row of rows || []) {
        const key = keyFn(row);
        map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
}

function numericDuration(row) {
    const value = Number(row?.duration_ms);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function percentile(values, percent = 95) {
    const sorted = (values || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1));
    return Math.round(sorted[index]);
}

function readerMetricName(requestPath = "") {
    const clean = String(requestPath || "").split("?")[0];
    if (/^\/reader-api\/search(?:\/suggest)?$/i.test(clean)) return "search";
    if (/^\/reader-api\/books\/[^/]+$/i.test(clean)) return "detail";
    if (/^\/reader-api\/books\/[^/]+\/chapters$/i.test(clean)) return "catalog";
    if (/^\/reader-api\/books\/[^/]+\/chapters\/[^/]+(?:\/html)?$/i.test(clean)) return "chapter";
    if (/^\/reader-auth\//i.test(clean)) return "auth";
    return clean.startsWith("/reader-api") ? "other" : "";
}

function normalizeBudgetOptions(options = {}) {
    const source = options.readerPerformanceBudgets || {};
    const result = {};
    for (const [key, fallback] of Object.entries(DEFAULT_READER_PERFORMANCE_BUDGETS)) {
        const envKey = `PO18_${key.toUpperCase()}`;
        const value = source[key] ?? process.env[envKey];
        const parsed = Number(value);
        result[key] = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
    }
    return result;
}

function assetKind(file) {
    if (/\.js$/i.test(file)) return "js";
    if (/\.css$/i.test(file)) return "css";
    return "";
}

function collectReaderAssetBudget(distDir, budgets = {}) {
    const payload = {
        dist_dir: distDir || "",
        available: false,
        total_bytes: 0,
        js_bytes: 0,
        css_bytes: 0,
        largest: [],
        budgets: {
            reader_entry_js_bytes: budgets.reader_entry_js_bytes,
            reader_entry_css_bytes: budgets.reader_entry_css_bytes
        },
        checks: []
    };
    if (!distDir) return payload;
    try {
        if (!fs.existsSync(distDir)) return { ...payload, error: "reader dist not found" };
        const rows = [];
        const stack = [distDir];
        while (stack.length) {
            const dir = stack.pop();
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(full);
                    continue;
                }
                const stat = fs.statSync(full);
                const rel = path.relative(distDir, full).replace(/\\/g, "/");
                const kind = assetKind(rel);
                payload.total_bytes += stat.size;
                if (kind === "js") payload.js_bytes += stat.size;
                if (kind === "css") payload.css_bytes += stat.size;
                if (kind) rows.push({ file: rel, kind, bytes: stat.size });
            }
        }
        payload.available = true;
        payload.largest = rows.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
        const largestJs = payload.largest.find((item) => item.kind === "js") || rows.filter((item) => item.kind === "js").sort((a, b) => b.bytes - a.bytes)[0] || { bytes: 0 };
        const largestCss = payload.largest.find((item) => item.kind === "css") || rows.filter((item) => item.kind === "css").sort((a, b) => b.bytes - a.bytes)[0] || { bytes: 0 };
        payload.checks = [
            {
                name: "reader largest js",
                value: largestJs.bytes || 0,
                budget: budgets.reader_entry_js_bytes,
                ok: !budgets.reader_entry_js_bytes || (largestJs.bytes || 0) <= budgets.reader_entry_js_bytes
            },
            {
                name: "reader largest css",
                value: largestCss.bytes || 0,
                budget: budgets.reader_entry_css_bytes,
                ok: !budgets.reader_entry_css_bytes || (largestCss.bytes || 0) <= budgets.reader_entry_css_bytes
            }
        ];
    } catch (err) {
        payload.error = err.message || String(err);
    }
    return payload;
}

function readerPerformanceSummary(requests = [], budgets = {}) {
    const groups = {
        search: [],
        detail: [],
        catalog: [],
        chapter: [],
        auth: [],
        other: []
    };
    for (const row of requests || []) {
        const name = readerMetricName(row.path || "");
        const duration = numericDuration(row);
        if (!name || duration === null) continue;
        if (!groups[name]) groups[name] = [];
        groups[name].push(duration);
    }
    const budgetMap = {
        search: budgets.search_p95_ms,
        detail: budgets.detail_p95_ms,
        catalog: budgets.catalog_p95_ms,
        chapter: budgets.chapter_p95_ms
    };
    const endpoints = Object.entries(groups).map(([name, values]) => {
        const p95 = percentile(values, 95);
        const budget = budgetMap[name] || 0;
        return {
            name,
            count: values.length,
            avg_ms: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
            p95_ms: p95,
            max_ms: values.length ? Math.max(...values) : 0,
            budget_ms: budget,
            ok: !budget || !values.length || p95 <= budget
        };
    });
    const budgeted = endpoints.filter((item) => item.budget_ms);
    return {
        budgets,
        endpoints,
        breached: budgeted.filter((item) => item.count && !item.ok).map((item) => item.name),
        ok: budgeted.every((item) => !item.count || item.ok)
    };
}

function createRequireMetrics(options = {}) {
    const metricsTokenProvider = options.metricsTokenProvider || (() => process.env.PO18_METRICS_TOKEN || "");
    const compare = options.timingSafeEqualText || timingSafeEqualText;
    return function requireMetrics(req, res, next) {
        const expected = String(metricsTokenProvider() || "");
        if (!expected) return next();
        const auth = String(req.get?.("Authorization") || "").replace(/^Bearer\s+/i, "");
        const provided = auth || String(req.query?.token || "");
        if (!compare(provided, expected)) return res.status(401).send("metrics token invalid\n");
        next();
    };
}

function createPrometheusMetricsText(options = {}) {
    const readJsonLinesTail = options.readJsonLinesTail || (() => []);
    const healthService = options.healthService || {};
    const pool = options.pool || { totalCount: 0, idleCount: 0, waitingCount: 0 };
    const requestLogFile = options.requestLogFile || "";
    const slowLogFile = options.slowLogFile || "";
    const eventLogFile = options.eventLogFile || "";
    const serviceName = options.serviceName || "server-pg";
    const botTokenProvider = options.botTokenProvider || (() => process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "");
    const botHealthUrlProvider = options.botHealthUrlProvider || (() => process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready");
    const readerPerformanceBudgets = normalizeBudgetOptions(options);

    return async function prometheusMetricsText() {
        const requests = readJsonLinesTail(requestLogFile, { limit: 5000, maxBytes: 2 * 1024 * 1024 });
        const slow = readJsonLinesTail(slowLogFile, { limit: 5000, maxBytes: 2 * 1024 * 1024 });
        const events = readJsonLinesTail(eventLogFile, { limit: 3000, maxBytes: 1024 * 1024 });
        const lines = [
            "# HELP po18_uptime_seconds Process uptime in seconds.",
            "# TYPE po18_uptime_seconds gauge",
            metricLine("po18_uptime_seconds", { service: serviceName }, Math.round(process.uptime())),
            "# HELP po18_db_pool_connections PostgreSQL pool connection state.",
            "# TYPE po18_db_pool_connections gauge",
            metricLine("po18_db_pool_connections", { state: "total" }, pool.totalCount),
            metricLine("po18_db_pool_connections", { state: "idle" }, pool.idleCount),
            metricLine("po18_db_pool_connections", { state: "waiting" }, pool.waitingCount)
        ];

        const requestGroups = groupedMetrics(requests, (row) => JSON.stringify({
            service: row.service || "app",
            method: row.method || "",
            path: row.path || "",
            status: row.status || 0
        }));
        lines.push("# HELP po18_http_requests_total Recent HTTP request count from JSONL tail.");
        lines.push("# TYPE po18_http_requests_total counter");
        for (const [key, count] of requestGroups) lines.push(metricLine("po18_http_requests_total", JSON.parse(key), count));

        const durationGroups = new Map();
        for (const row of requests) {
            const key = JSON.stringify({ service: row.service || "app", method: row.method || "" });
            const prev = durationGroups.get(key) || { count: 0, sum: 0 };
            prev.count += 1;
            prev.sum += Number(row.duration_ms || 0);
            durationGroups.set(key, prev);
        }
        lines.push("# HELP po18_http_request_duration_ms_sum Recent HTTP request duration sum in milliseconds.");
        lines.push("# TYPE po18_http_request_duration_ms_sum counter");
        for (const [key, value] of durationGroups) {
            const labels = JSON.parse(key);
            lines.push(metricLine("po18_http_request_duration_ms_sum", labels, value.sum));
            lines.push(metricLine("po18_http_request_duration_ms_count", labels, value.count));
        }

        lines.push("# HELP po18_slow_requests_total Recent slow request count from JSONL tail.");
        lines.push("# TYPE po18_slow_requests_total counter");
        lines.push(metricLine("po18_slow_requests_total", {}, slow.length));

        const readerApi = requests.filter((row) => String(row.path || "").startsWith("/reader-api"));
        const readerDuration = readerApi.reduce((sum, row) => sum + Number(row.duration_ms || 0), 0);
        lines.push("# HELP po18_reader_api_duration_ms Recent reader API duration.");
        lines.push("# TYPE po18_reader_api_duration_ms counter");
        lines.push(metricLine("po18_reader_api_duration_ms_sum", {}, readerDuration));
        lines.push(metricLine("po18_reader_api_duration_ms_count", {}, readerApi.length));
        const readerPerf = readerPerformanceSummary(requests, readerPerformanceBudgets);
        lines.push("# HELP po18_reader_endpoint_p95_ms Recent reader endpoint p95 latency in milliseconds.");
        lines.push("# TYPE po18_reader_endpoint_p95_ms gauge");
        for (const endpoint of readerPerf.endpoints) {
            if (!endpoint.budget_ms) continue;
            lines.push(metricLine("po18_reader_endpoint_p95_ms", { endpoint: endpoint.name }, endpoint.p95_ms));
            lines.push(metricLine("po18_reader_endpoint_budget_ms", { endpoint: endpoint.name }, endpoint.budget_ms));
        }

        const botApiErrors = requests.filter((row) => String(row.path || "").startsWith("/bot-api") && Number(row.status || 0) >= 400).length;
        lines.push("# HELP po18_bot_api_errors_total Recent bot API HTTP errors from JSONL tail.");
        lines.push("# TYPE po18_bot_api_errors_total counter");
        lines.push(metricLine("po18_bot_api_errors_total", {}, botApiErrors));

        const backupGroups = groupedMetrics(events.filter((row) => /^backup-/.test(String(row.event || ""))), (row) => JSON.stringify({
            event: row.event || "backup",
            level: row.level || "info"
        }));
        lines.push("# HELP po18_backup_events_total Recent backup and restore event count.");
        lines.push("# TYPE po18_backup_events_total counter");
        for (const [key, count] of backupGroups) lines.push(metricLine("po18_backup_events_total", JSON.parse(key), count));

        const botEnabled = !!String(botTokenProvider() || "");
        const botHealth = botEnabled && typeof healthService.httpHealthCheck === "function"
            ? await healthService.httpHealthCheck("bot", botHealthUrlProvider(), { required: false, includeBody: true })
            : { body: { background_tasks: {} } };
        const tasks = botHealth.body?.background_tasks || {};
        lines.push("# HELP po18_bot_queue_jobs Bot background job queue state.");
        lines.push("# TYPE po18_bot_queue_jobs gauge");
        lines.push(metricLine("po18_bot_queue_jobs", { state: "running" }, tasks.running || 0));
        lines.push(metricLine("po18_bot_queue_jobs", { state: "queued" }, tasks.queued || 0));
        lines.push(metricLine("po18_bot_queue_jobs", { state: "locks" }, tasks.locks || 0));
        lines.push(metricLine("po18_bot_queue_jobs", { state: "concurrency" }, tasks.concurrency || 0));

        return `${lines.join("\n")}\n`;
    };
}

function createMetricsSummary(options = {}) {
    const readJsonLinesTail = options.readJsonLinesTail || (() => []);
    const pool = options.pool || { totalCount: 0, idleCount: 0, waitingCount: 0 };
    const requestLogFile = options.requestLogFile || "";
    const slowLogFile = options.slowLogFile || "";
    const eventLogFile = options.eventLogFile || "";
    const healthService = options.healthService || {};
    const botTokenProvider = options.botTokenProvider || (() => process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "");
    const botHealthUrlProvider = options.botHealthUrlProvider || (() => process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready");
    const readerPerformanceBudgets = normalizeBudgetOptions(options);
    const readerDistDir = options.readerDistDir || process.env.PO18_READER_DIST_DIR || path.resolve(process.cwd(), "cirno-src", "dist-reader");

    return async function metricsSummary() {
        const requests = readJsonLinesTail(requestLogFile, { limit: 5000, maxBytes: 2 * 1024 * 1024 });
        const slow = readJsonLinesTail(slowLogFile, { limit: 5000, maxBytes: 2 * 1024 * 1024 });
        const events = readJsonLinesTail(eventLogFile, { limit: 3000, maxBytes: 1024 * 1024 });
        const now = new Date().toISOString();
        const byStatus = {};
        const byService = {};
        const byPath = new Map();
        let errorCount = 0;
        let durationSum = 0;
        let readerCount = 0;
        let readerDurationSum = 0;
        for (const row of requests) {
            const status = String(row.status || 0);
            const statusBucket = status[0] ? `${status[0]}xx` : "unknown";
            byStatus[statusBucket] = (byStatus[statusBucket] || 0) + 1;
            byService[row.service || "app"] = (byService[row.service || "app"] || 0) + 1;
            const path = String(row.path || "-");
            const current = byPath.get(path) || { path, count: 0, errors: 0, duration_ms_sum: 0 };
            current.count += 1;
            current.duration_ms_sum += Number(row.duration_ms || 0);
            if (Number(row.status || 0) >= 400) current.errors += 1;
            byPath.set(path, current);
            durationSum += Number(row.duration_ms || 0);
            if (Number(row.status || 0) >= 400) errorCount += 1;
            if (path.startsWith("/reader-api")) {
                readerCount += 1;
                readerDurationSum += Number(row.duration_ms || 0);
            }
        }
        const botEnabled = !!String(botTokenProvider() || "");
        const botHealth = botEnabled && typeof healthService.httpHealthCheck === "function"
            ? await healthService.httpHealthCheck("bot", botHealthUrlProvider(), { required: false, includeBody: true })
            : { body: { background_tasks: {} }, skipped: true };
        const queue = botHealth.body?.background_tasks || {};
        const backupEvents = events.filter((row) => /^backup-/.test(String(row.event || "")));
        const readerApi = requests.filter((row) => String(row.path || "").startsWith("/reader-api"));
        const readerPerformance = readerPerformanceSummary(requests, readerPerformanceBudgets);
        const readerAssets = collectReaderAssetBudget(readerDistDir, readerPerformanceBudgets);
        return {
            generated_at: now,
            window: {
                requests: requests.length,
                slow_requests: slow.length,
                events: events.length
            },
            http: {
                total: requests.length,
                errors: errorCount,
                avg_duration_ms: requests.length ? Math.round(durationSum / requests.length) : 0,
                by_status: byStatus,
                by_service: byService,
                top_paths: [...byPath.values()]
                    .sort((a, b) => b.count - a.count || b.errors - a.errors)
                    .slice(0, 12)
                    .map((item) => ({
                        ...item,
                        avg_duration_ms: item.count ? Math.round(item.duration_ms_sum / item.count) : 0
                    }))
            },
            reader_api: {
                total: readerCount,
                avg_duration_ms: readerCount ? Math.round(readerDurationSum / readerCount) : 0,
                p95_duration_ms: percentile(readerApi.map((row) => numericDuration(row)).filter((value) => value !== null), 95),
                performance: readerPerformance
            },
            reader_performance: readerPerformance,
            reader_assets: readerAssets,
            bot_queue: {
                online: !!botHealth.ok && !botHealth.skipped,
                running: Number(queue.running || 0),
                queued: Number(queue.queued || 0),
                locks: Number(queue.locks || 0),
                concurrency: Number(queue.concurrency || 0)
            },
            backup: {
                events: backupEvents.length,
                failures: backupEvents.filter((row) => row.level === "error" || /failed/i.test(String(row.event || ""))).length
            },
            database: {
                total: pool.totalCount,
                idle: pool.idleCount,
                waiting: pool.waitingCount
            }
        };
    };
}

function createHealthRoutes(options = {}) {
    const router = express.Router();
    const healthService = options.healthService;
    const versionPayload = options.versionPayload || ((service) => ({ service }));
    const serviceName = options.serviceName || "server-pg";
    const requireMetrics = createRequireMetrics({
        metricsTokenProvider: options.metricsTokenProvider,
        timingSafeEqualText: options.timingSafeEqualText
    });
    const prometheusMetricsText = createPrometheusMetricsText({ ...options, serviceName });
    const metricsSummary = createMetricsSummary(options);

    router.get("/health/live", (req, res) => {
        res.json(healthService.healthPayload(serviceName));
    });

    router.get("/health/version", (req, res) => {
        res.json(versionPayload(serviceName));
    });

    router.get(["/health/ready", "/health/status"], async (req, res) => {
        const ready = await healthService.collectReadyHealth();
        res.status(ready.statusCode).json(ready.payload);
    });

    router.get("/health/deep", async (req, res) => {
        const payload = await healthService.collectDeepHealth();
        res.status(payload.ok ? 200 : 503).json(payload);
    });

    router.get("/metrics", requireMetrics, async (req, res, next) => {
        try {
            res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
            res.end(await prometheusMetricsText());
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/metrics/summary", options.requireAdmin || ((req, res, next) => next()), async (req, res, next) => {
        try {
            res.json(await metricsSummary());
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    DEFAULT_READER_PERFORMANCE_BUDGETS,
    collectReaderAssetBudget,
    createHealthRoutes,
    createMetricsSummary,
    createPrometheusMetricsText,
    createRequireMetrics,
    groupedMetrics,
    metricLabelValue,
    metricLine,
    normalizeBudgetOptions,
    percentile,
    readerMetricName,
    readerPerformanceSummary,
    timingSafeEqualText
};
