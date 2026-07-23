/**
 * [INPUT]: 依赖 pg Pool、db/migrations 与 db/rollbacks SQL 链、结构化日志和运行时数据库超时配置
 * [OUTPUT]: 对外提供连接池查询、指标、迁移/回滚执行、checksum 校验及兼容字段/占位符工具
 * [POS]: services 下方的 PostgreSQL 基础设施边界，统一连接和 Schema 演进，不承载 HTTP 或 Bot 协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const PG_URL =
    process.env.PO18_PG_URL ||
    "postgres://po18:po18-change-me@127.0.0.1:5432/po18";

function positiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const QUERY_TIMEOUT_MS = positiveInt(process.env.PO18_PG_QUERY_TIMEOUT_MS, 30000, 1000, 10 * 60 * 1000);
const QUERY_SLOW_MS = positiveInt(process.env.PO18_PG_SLOW_QUERY_MS, 1000, 10, QUERY_TIMEOUT_MS);
const MIGRATION_TIMEOUT_MS = positiveInt(
    process.env.PO18_PG_MIGRATION_TIMEOUT_MS,
    10 * 60 * 1000,
    QUERY_TIMEOUT_MS,
    60 * 60 * 1000
);

const pool = new Pool({
    connectionString: PG_URL,
    max: positiveInt(process.env.PO18_PG_POOL_MAX, 10, 1, 200),
    idleTimeoutMillis: positiveInt(process.env.PO18_PG_IDLE_TIMEOUT_MS, 30000, 1000, 10 * 60 * 1000),
    connectionTimeoutMillis: positiveInt(process.env.PO18_PG_CONNECT_TIMEOUT_MS, 10000, 1000, 120000),
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS
});

const queryTelemetry = {
    count: 0,
    failures: 0,
    timeouts: 0,
    slow: 0,
    durations: []
};

const MIGRATIONS_DIR = path.join(__dirname, "db", "migrations");
const ROLLBACKS_DIR = path.join(__dirname, "db", "rollbacks");
const MIGRATION_LOCK_KEY = 182018;
const BASELINE_VERSION = "001_baseline";
const LEGACY_BASELINE_TABLES = [
    "book_metadata",
    "chapter_cache",
    "reader_users",
    "admin_users",
    "system_jobs",
    "book_stats",
    "bot_audit_logs",
    "reader_search_requests",
    "reader_book_reviews"
];

const bookColumns = [
    "id",
    "book_id",
    "title",
    "author",
    "cover",
    "description",
    "tags",
    "category",
    "word_count",
    "chapter_count",
    "status",
    "detail_url",
    "created_at",
    "updated_at",
    "total_chapters",
    "subscribed_chapters",
    "free_chapters",
    "paid_chapters",
    "latest_chapter_name",
    "latest_chapter_date",
    "platform",
    "favorites_count",
    "comments_count",
    "monthly_popularity",
    "total_popularity",
    "uploader",
    "uploaderId",
    "description_html",
    "weekly_popularity",
    "readers_count",
    "daily_popularity",
    "purchase_count",
    "source_updated_at",
    "catalog_updated_at",
    "metadata_cached_at"
];

const chapterColumns = [
    "id",
    "book_id",
    "chapter_id",
    "title",
    "html",
    "text",
    "created_at",
    "updated_at",
    "chapter_order",
    "uploader",
    "uploaderId",
    "platform",
    "is_volume"
];

function placeholders(values, start = 1) {
    return values.map((_, index) => `$${start + index}`).join(", ");
}

function pick(data, columns) {
    const out = {};
    for (const key of columns) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}

async function query(sql, params = []) {
    const startedAt = Date.now();
    queryTelemetry.count += 1;
    try {
        return await pool.query(sql, params);
    } catch (error) {
        queryTelemetry.failures += 1;
        if (error?.code === "57014" || /query.*timeout|statement timeout|canceling statement/i.test(String(error?.message || ""))) {
            queryTelemetry.timeouts += 1;
        }
        throw error;
    } finally {
        const duration = Math.max(0, Date.now() - startedAt);
        if (duration >= QUERY_SLOW_MS) queryTelemetry.slow += 1;
        queryTelemetry.durations.push(duration);
        if (queryTelemetry.durations.length > 2000) queryTelemetry.durations.splice(0, queryTelemetry.durations.length - 2000);
    }
}

function databaseQueryMetrics() {
    const sorted = queryTelemetry.durations.slice().sort((a, b) => a - b);
    const percentile = (ratio) => sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
        : 0;
    return {
        count: queryTelemetry.count,
        failures: queryTelemetry.failures,
        timeouts: queryTelemetry.timeouts,
        slow: queryTelemetry.slow,
        p50_ms: percentile(0.50),
        p95_ms: percentile(0.95),
        p99_ms: percentile(0.99),
        sample_count: sorted.length,
        slow_threshold_ms: QUERY_SLOW_MS,
        timeout_ms: QUERY_TIMEOUT_MS
    };
}

async function listMigrationFiles() {
    let entries = [];
    try {
        entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
    return entries
        .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name))
        .map((entry) => ({
            file: entry.name,
            version: entry.name.replace(/\.sql$/i, ""),
            name: entry.name.replace(/^\d+_/, "").replace(/\.sql$/i, ""),
            path: path.join(MIGRATIONS_DIR, entry.name)
        }))
        .sort((a, b) => a.version.localeCompare(b.version, "en"));
}

async function listRollbackFiles() {
    let entries = [];
    try {
        entries = await fs.readdir(ROLLBACKS_DIR, { withFileTypes: true });
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
    }
    return entries
        .filter((entry) => entry.isFile() && /^\d+_.+\.down\.sql$/i.test(entry.name))
        .map((entry) => ({
            file: entry.name,
            version: entry.name.replace(/\.down\.sql$/i, ""),
            name: entry.name.replace(/^\d+_/, "").replace(/\.down\.sql$/i, ""),
            path: path.join(ROLLBACKS_DIR, entry.name)
        }))
        .sort((a, b) => a.version.localeCompare(b.version, "en"));
}

function checksumSql(sql) {
    return crypto.createHash("sha256").update(sql).digest("hex");
}

function verifyMigrationChecksum(version, expected, actual, { allowDrift = false } = {}) {
    if (!expected || expected === actual) return true;
    const message = `migration checksum mismatch for ${version}: applied=${expected} current=${actual}`;
    if (allowDrift) {
        console.warn(`[pg-migrate] ${message}; PO18_ALLOW_MIGRATION_CHECKSUM_DRIFT=1 is set`);
        return false;
    }
    const err = new Error(message);
    err.code = "PO18_MIGRATION_CHECKSUM_MISMATCH";
    throw err;
}

async function ensureSchemaMigrations(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            checksum TEXT NOT NULL DEFAULT '',
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            app_version TEXT NOT NULL DEFAULT ''
        );
        ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT ''
    `);
}

async function adoptLegacyBaseline(client, files, applied) {
    const baseline = files.find((migration) => migration.version === BASELINE_VERSION);
    if (!baseline || applied.has(BASELINE_VERSION) || applied.size === 0) return false;

    const checks = LEGACY_BASELINE_TABLES.map(
        (table, index) => `to_regclass($${index + 1}) IS NOT NULL AS table_${index}`
    ).join(", ");
    const result = await client.query(
        `SELECT ${checks}`,
        LEGACY_BASELINE_TABLES.map((table) => `public.${table}`)
    );
    const row = result.rows[0] || {};
    if (!LEGACY_BASELINE_TABLES.every((_, index) => row[`table_${index}`] === true)) return false;

    const sql = await fs.readFile(baseline.path, "utf8");
    const checksum = checksumSql(sql);
    await client.query(
        `INSERT INTO schema_migrations(version, name, checksum, duration_ms, app_version)
         VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (version) DO NOTHING`,
        [baseline.version, baseline.name, checksum, String(process.env.PO18_APP_VERSION || "").slice(0, 120)]
    );
    applied.set(baseline.version, checksum);
    console.log(`[pg-migrate] adopted ${baseline.version} for existing schema`);
    return true;
}

async function runMigrations() {
    const client = await pool.connect();
    let lockHeld = false;
    try {
        const lockResult = await client.query("SELECT pg_try_advisory_lock($1) locked", [MIGRATION_LOCK_KEY]);
        lockHeld = lockResult.rows[0]?.locked === true;
        if (!lockHeld) {
            const err = new Error("database migrations are running in another instance");
            err.code = "55P03";
            throw err;
        }
        await ensureSchemaMigrations(client);
        const files = await listMigrationFiles();
        const appliedResult = await client.query("SELECT version, checksum FROM schema_migrations");
        const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
        const executed = [];
        await adoptLegacyBaseline(client, files, applied);

        for (const migration of files) {
            const sql = await fs.readFile(migration.path, "utf8");
            const checksum = checksumSql(sql);
            if (applied.has(migration.version)) {
                const existingChecksum = applied.get(migration.version);
                verifyMigrationChecksum(migration.version, existingChecksum, checksum, {
                    allowDrift: process.env.PO18_ALLOW_MIGRATION_CHECKSUM_DRIFT === "1"
                });
                continue;
            }

            const started = Date.now();
            console.log(`[pg-migrate] applying ${migration.version} (timeout ${MIGRATION_TIMEOUT_MS}ms)`);
            await migrationQuery(client, "BEGIN");
            try {
                await executeMigrationSql(client, sql);
                await migrationQuery(
                    client,
                    `INSERT INTO schema_migrations(version, name, checksum, duration_ms, app_version)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [migration.version, migration.name, checksum, Date.now() - started, String(process.env.PO18_APP_VERSION || "").slice(0, 120)]
                );
                await migrationQuery(client, "COMMIT");
                executed.push(migration.version);
                console.log(`[pg-migrate] applied ${migration.version}`);
            } catch (err) {
                await migrationQuery(client, "ROLLBACK").catch(() => {});
                throw err;
            }
        }

        return {
            ok: true,
            executed,
            latest: files[files.length - 1]?.version || "",
            total: files.length
        };
    } finally {
        if (lockHeld) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

function migrationQuery(client, text, values = []) {
    return client.query({ text, values, query_timeout: MIGRATION_TIMEOUT_MS });
}

async function executeMigrationSql(client, sql) {
    await migrationQuery(client, "SELECT set_config('statement_timeout', $1, true)", [String(MIGRATION_TIMEOUT_MS)]);
    return migrationQuery(client, sql);
}

function normalizeRollbackRequest({ steps = 1, toVersion = "" } = {}) {
    const targetVersion = String(toVersion || "").trim();
    const parsedSteps = Number(steps);
    if (!targetVersion && (!Number.isSafeInteger(parsedSteps) || parsedSteps < 1 || parsedSteps > 50)) {
        throw new Error("rollback steps must be an integer between 1 and 50");
    }
    return { safeSteps: targetVersion ? 0 : parsedSteps, targetVersion };
}

async function runMigrationRollback({ steps = 1, toVersion = "", confirm = "" } = {}) {
    if (process.env.PO18_ALLOW_SCHEMA_ROLLBACK !== "1") {
        throw new Error("schema rollback is disabled; set PO18_ALLOW_SCHEMA_ROLLBACK=1 to continue");
    }
    if (String(confirm || "") !== "ROLLBACK") {
        throw new Error("schema rollback requires confirm=ROLLBACK");
    }

    const { safeSteps, targetVersion } = normalizeRollbackRequest({ steps, toVersion });
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await ensureSchemaMigrations(client);
        const appliedResult = await client.query("SELECT version, name FROM schema_migrations ORDER BY version DESC");
        const rollbackFiles = await listRollbackFiles();
        const rollbackByVersion = new Map(rollbackFiles.map((file) => [file.version, file]));
        const targets = [];

        if (targetVersion && !(appliedResult.rows || []).some((row) => row.version === targetVersion)) {
            throw new Error(`rollback target version is not applied: ${targetVersion}`);
        }

        for (const row of appliedResult.rows || []) {
            if (targetVersion && row.version <= targetVersion) break;
            if (!targetVersion && targets.length >= safeSteps) break;
            targets.push(row);
        }

        if (!targets.length) return [];

        const plans = [];
        for (const row of targets) {
            const rollback = rollbackByVersion.get(row.version);
            if (!rollback) throw new Error(`missing rollback file for ${row.version}`);
            const sql = await fs.readFile(rollback.path, "utf8");
            plans.push({ row, rollback, sql });
        }

        const rolledBack = [];
        for (const { row, rollback, sql } of plans) {
            const started = Date.now();
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query("DELETE FROM schema_migrations WHERE version = $1", [row.version]);
                await client.query("COMMIT");
                rolledBack.push({
                    version: row.version,
                    name: row.name || rollback.name,
                    file: rollback.file,
                    durationMs: Date.now() - started
                });
                console.log(`[pg-migrate] rolled back ${row.version}`);
            } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw err;
            }
        }

        return rolledBack;
    } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

async function initPg() {
    await runMigrations();
}

module.exports = {
    pool,
    query,
    databaseQueryMetrics,
    initPg,
    runMigrations,
    runMigrationRollback,
    normalizeRollbackRequest,
    listMigrationFiles,
    listRollbackFiles,
    checksumSql,
    verifyMigrationChecksum,
    adoptLegacyBaseline,
    migrationQuery,
    executeMigrationSql,
    MIGRATION_TIMEOUT_MS,
    bookColumns,
    chapterColumns,
    pick,
    placeholders
};
