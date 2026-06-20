const fs = require("fs/promises");
const path = require("path");

const DEFAULT_REQUIRED_TABLES = [
    "book_metadata",
    "chapter_cache",
    "admin_users",
    "admin_config",
    "reader_users",
    "upload_events",
    "schema_migrations",
    "system_jobs",
    "book_stats"
];

function checkResult(name, ok, fields = {}) {
    return {
        name,
        ok: !!ok,
        required: fields.required !== false,
        skipped: !!fields.skipped,
        detail: fields.detail || "",
        error: fields.error || "",
        latency_ms: fields.latency_ms || 0,
        status: fields.status || undefined,
        url: fields.url || undefined,
        body: fields.body || undefined
    };
}

function timeoutSignal(ms) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function maskedTelegramUrl(base) {
    return `${String(base || "https://api.telegram.org").replace(/\/+$/, "")}/bot<TOKEN>/getMe`;
}

function valueOf(value) {
    return typeof value === "function" ? value() : value;
}

function databaseErrorDetail(err) {
    const code = String(err?.code || "");
    const message = err?.message || String(err || "");
    if (code === "57P03" || /recovery mode|not yet accepting connections/i.test(message)) {
        return "PostgreSQL is starting or recovering";
    }
    return message;
}

function createHealthService(options = {}) {
    const serviceName = options.serviceName || "server-pg";
    const startedAt = Number(options.startedAt || Date.now());
    const configFile = options.configFile || process.env.PO18_CONFIG_FILE || "/config/app.env";
    const requiredTables = Array.isArray(options.requiredTables) && options.requiredTables.length
        ? options.requiredTables
        : DEFAULT_REQUIRED_TABLES;
    const query = options.query;
    const pool = options.pool || { totalCount: 0, idleCount: 0, waitingCount: 0 };

    function healthPayload(service = serviceName, extra = {}) {
        return {
            ok: true,
            service,
            uptime_seconds: Math.round(process.uptime()),
            started_at: new Date(startedAt).toISOString(),
            ...extra
        };
    }

    async function httpHealthCheck(name, url, httpOptions = {}) {
        const timeoutMs = Number(httpOptions.timeoutMs || process.env.PO18_DEEP_HEALTH_TIMEOUT_MS || 2500);
        const timer = timeoutSignal(timeoutMs);
        const started = Date.now();
        try {
            const response = await fetch(url, { signal: timer.signal });
            const text = await response.text();
            let body = {};
            try {
                body = text ? JSON.parse(text) : {};
            } catch {
                body = { raw: text.slice(0, 240) };
            }
            return checkResult(name, response.ok && body.ok !== false, {
                required: httpOptions.required !== false,
                status: response.status,
                latency_ms: Date.now() - started,
                url,
                body: httpOptions.includeBody === false ? undefined : body,
                detail: `HTTP ${response.status}`
            });
        } catch (err) {
            return checkResult(name, false, {
                required: httpOptions.required !== false,
                latency_ms: Date.now() - started,
                url,
                error: err.message || String(err)
            });
        } finally {
            timer.done();
        }
    }

    async function databaseHealthCheck() {
        const started = Date.now();
        try {
            if (typeof query !== "function") throw new Error("database query function is not configured");
            await query("SELECT 1");
            return checkResult("database", true, { required: true, latency_ms: Date.now() - started, detail: "SELECT 1 OK" });
        } catch (err) {
            return checkResult("database", false, { required: true, latency_ms: Date.now() - started, error: databaseErrorDetail(err) });
        }
    }

    async function schemaHealthCheck() {
        const started = Date.now();
        try {
            if (typeof query !== "function") throw new Error("database query function is not configured");
            const found = await query(
                `SELECT table_name
                 FROM information_schema.tables
                 WHERE table_schema = 'public'
                   AND table_name = ANY($1::text[])`,
                [requiredTables]
            );
            const names = new Set((found.rows || []).map((row) => row.table_name));
            const missing = requiredTables.filter((name) => !names.has(name));
            return checkResult("database schema", missing.length === 0, {
                required: true,
                latency_ms: Date.now() - started,
                detail: missing.length ? `missing: ${missing.join(", ")}` : `required tables ready: ${requiredTables.length}`,
                body: { required_tables: requiredTables, missing_tables: missing }
            });
        } catch (err) {
            return checkResult("database schema", false, { required: true, latency_ms: Date.now() - started, error: databaseErrorDetail(err) });
        }
    }

    async function diskWritableHealthCheck() {
        const started = Date.now();
        const dir = process.env.PO18_HEALTH_WRITE_DIR || path.dirname(configFile);
        const file = path.join(dir, `.po18-health-${process.pid}-${Date.now()}`);
        try {
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(file, "ok", "utf8");
            await fs.rm(file, { force: true });
            return checkResult("config disk", true, { required: true, latency_ms: Date.now() - started, detail: `${dir} writable` });
        } catch (err) {
            return checkResult("config disk", false, { required: true, latency_ms: Date.now() - started, error: err.message || String(err) });
        }
    }

    async function telegramApiHealthCheck() {
        const started = Date.now();
        const provider = options.telegramTokenProvider || (() => process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "");
        const token = String(await Promise.resolve(provider()).catch(() => process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "") || "");
        if (!token) {
            return checkResult("telegram api", true, { required: false, skipped: true, detail: "Telegram Token is not configured" });
        }
        const base = String(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
        const timer = timeoutSignal(Number(process.env.PO18_TELEGRAM_HEALTH_TIMEOUT_MS || 3500));
        try {
            const response = await fetch(`${base}/bot${token}/getMe`, { signal: timer.signal });
            const body = await response.json().catch(() => ({}));
            return checkResult("telegram api", response.ok && body.ok !== false, {
                required: false,
                status: response.status,
                latency_ms: Date.now() - started,
                url: maskedTelegramUrl(base),
                detail: body.result?.username ? `@${body.result.username}` : `HTTP ${response.status}`
            });
        } catch (err) {
            return checkResult("telegram api", false, {
                required: false,
                latency_ms: Date.now() - started,
                url: maskedTelegramUrl(base),
                error: err.message || String(err)
            });
        } finally {
            timer.done();
        }
    }

    async function collectReadyHealth() {
        const [db, schema] = await Promise.all([databaseHealthCheck(), schemaHealthCheck()]);
        const ok = db.ok && schema.ok;
        return {
            statusCode: ok ? 200 : 503,
            payload: healthPayload(serviceName, {
                ok,
                db,
                schema,
                pool: {
                    total: pool.totalCount || 0,
                    idle: pool.idleCount || 0,
                    waiting: pool.waitingCount || 0
                }
            })
        };
    }

    async function collectDeepHealth() {
        const started = Date.now();
        const uploadToken = String(valueOf(options.uploadApiToken) || "");
        const botApiTokenConfigured = String(valueOf(options.botApiToken) || "").length >= 16;
        const botConfigured = !!(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN);
        const checks = await Promise.all([
            Promise.resolve(checkResult(serviceName, true, { required: true, detail: "process alive" })),
            databaseHealthCheck(),
            schemaHealthCheck(),
            diskWritableHealthCheck(),
            Promise.resolve(checkResult("upload-api-token", uploadToken.length >= 16, {
                required: false,
                detail: uploadToken ? "configured" : "not configured; upload/write APIs return 503"
            })),
            Promise.resolve(checkResult("bot-api-token", botApiTokenConfigured, {
                required: false,
                detail: botApiTokenConfigured ? "configured" : "not configured; /bot-api/* returns 503"
            })),
            httpHealthCheck("reader", process.env.READER_HEALTH_URL || "http://127.0.0.1:3200/health/ready", { required: true }),
            botConfigured
                ? httpHealthCheck("bot", process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready", { required: false })
                : Promise.resolve(checkResult("bot", true, { required: false, skipped: true, detail: "Telegram Token is not configured" })),
            telegramApiHealthCheck()
        ]);
        const requiredFailed = checks.filter((item) => item.required !== false && !item.ok);
        const optionalFailed = checks.filter((item) => item.required === false && !item.skipped && !item.ok);
        return {
            ok: requiredFailed.length === 0,
            service: serviceName,
            uptime_seconds: Math.round(process.uptime()),
            started_at: new Date(startedAt).toISOString(),
            duration_ms: Date.now() - started,
            required_failed: requiredFailed.length,
            optional_failed: optionalFailed.length,
            checks
        };
    }

    async function collectSchemaInfo() {
        const info = {
            version: "not configured",
            migrationTable: false,
            migrationCount: 0,
            recentMigrations: [],
            publicTables: 0,
            pgTrgm: false,
            database: "",
            systemJobsTable: false,
            bookStatsTable: false
        };
        try {
            if (typeof query !== "function") throw new Error("database query function is not configured");
            const basic = await query(
                `SELECT current_database() database,
                        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public') public_tables,
                        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') pg_trgm,
                        to_regclass('public.schema_migrations')::text migration_table,
                        to_regclass('public.system_jobs')::text system_jobs_table,
                        to_regclass('public.book_stats')::text book_stats_table`
            );
            const row = basic.rows[0] || {};
            info.database = row.database || "";
            info.publicTables = Number(row.public_tables || 0);
            info.pgTrgm = !!row.pg_trgm;
            info.migrationTable = !!row.migration_table;
            info.systemJobsTable = !!row.system_jobs_table;
            info.bookStatsTable = !!row.book_stats_table;
            if (info.migrationTable) {
                const migrations = await query(
                    `SELECT version, name, applied_at, duration_ms
                     FROM schema_migrations
                     ORDER BY version DESC
                     LIMIT 10`
                ).catch(() => ({ rows: [] }));
                info.recentMigrations = migrations.rows || [];
                info.migrationCount = info.recentMigrations.length;
                const count = await query("SELECT COUNT(*)::int count FROM schema_migrations").catch(() => ({ rows: [] }));
                info.migrationCount = Number(count.rows[0]?.count || info.migrationCount || 0);
                info.version = info.recentMigrations[0]?.version || "schema_migrations exists but has no version";
            } else {
                info.version = process.env.PO18_SCHEMA_VERSION || "pg-default";
            }
        } catch (err) {
            info.error = err.message || String(err);
        }
        return info;
    }

    return {
        checkResult,
        collectDeepHealth,
        collectReadyHealth,
        collectSchemaInfo,
        databaseHealthCheck,
        diskWritableHealthCheck,
        healthPayload,
        httpHealthCheck,
        maskedTelegramUrl,
        requiredTables,
        schemaHealthCheck,
        telegramApiHealthCheck,
        timeoutSignal
    };
}

module.exports = {
    DEFAULT_REQUIRED_TABLES,
    checkResult,
    createHealthService,
    databaseErrorDetail,
    maskedTelegramUrl,
    timeoutSignal
};
