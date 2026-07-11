const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const PG_URL =
    process.env.PO18_PG_URL ||
    "postgres://po18:po18-change-me@127.0.0.1:5432/po18";

const pool = new Pool({
    connectionString: PG_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

const MIGRATIONS_DIR = path.join(__dirname, "db", "migrations");
const ROLLBACKS_DIR = path.join(__dirname, "db", "rollbacks");
const MIGRATION_LOCK_KEY = 182018;

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
    "purchase_count"
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
    return pool.query(sql, params);
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

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await ensureSchemaMigrations(client);
        const files = await listMigrationFiles();
        const appliedResult = await client.query("SELECT version, checksum FROM schema_migrations");
        const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
        const executed = [];

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
            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    `INSERT INTO schema_migrations(version, name, checksum, duration_ms, app_version)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [migration.version, migration.name, checksum, Date.now() - started, String(process.env.PO18_APP_VERSION || "").slice(0, 120)]
                );
                await client.query("COMMIT");
                executed.push(migration.version);
                console.log(`[pg-migrate] applied ${migration.version}`);
            } catch (err) {
                await client.query("ROLLBACK");
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
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
        client.release();
    }
}

async function runMigrationRollback({ steps = 1, toVersion = "", confirm = "" } = {}) {
    if (process.env.PO18_ALLOW_SCHEMA_ROLLBACK !== "1") {
        throw new Error("schema rollback is disabled; set PO18_ALLOW_SCHEMA_ROLLBACK=1 to continue");
    }
    if (String(confirm || "") !== "ROLLBACK") {
        throw new Error("schema rollback requires confirm=ROLLBACK");
    }

    const safeSteps = Math.max(1, Math.min(50, Number(steps || 1)));
    const targetVersion = String(toVersion || "").trim();
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await ensureSchemaMigrations(client);
        const appliedResult = await client.query("SELECT version, name FROM schema_migrations ORDER BY version DESC");
        const rollbackFiles = await listRollbackFiles();
        const rollbackByVersion = new Map(rollbackFiles.map((file) => [file.version, file]));
        const targets = [];

        for (const row of appliedResult.rows || []) {
            if (targetVersion && row.version <= targetVersion) break;
            if (!targetVersion && targets.length >= safeSteps) break;
            targets.push(row);
        }

        if (!targets.length) return [];

        const rolledBack = [];
        for (const row of targets) {
            const rollback = rollbackByVersion.get(row.version);
            if (!rollback) throw new Error(`missing rollback file for ${row.version}`);
            const sql = await fs.readFile(rollback.path, "utf8");
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
    initPg,
    runMigrations,
    runMigrationRollback,
    listMigrationFiles,
    listRollbackFiles,
    checksumSql,
    verifyMigrationChecksum,
    bookColumns,
    chapterColumns,
    pick,
    placeholders
};
