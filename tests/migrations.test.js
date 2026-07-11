const assert = require("assert/strict");
const fs = require("fs/promises");
const path = require("path");
const test = require("node:test");
const { adoptLegacyBaseline, checksumSql, listMigrationFiles, listRollbackFiles, verifyMigrationChecksum } = require("../pg-store");

test("migration files use sortable versioned names", async () => {
    const files = await listMigrationFiles();
    assert.ok(files.length > 0, "expected at least one migration file");

    const versions = files.map((file) => file.version);
    const sorted = [...versions].sort((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(versions, sorted);

    for (const file of files) {
        assert.match(file.file, /^\d{3}_[a-z0-9_]+\.sql$/);
        assert.ok(file.name);
    }
    assert.equal(files[0].version, "001_baseline");
});

test("baseline migration owns initial schema and initPg only invokes migrations", async () => {
    const baseline = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "001_baseline.sql"), "utf8");
    const store = await fs.readFile(path.join(__dirname, "..", "pg-store.js"), "utf8");
    assert.match(baseline, /CREATE TABLE IF NOT EXISTS book_metadata/);
    assert.match(baseline, /CREATE TABLE IF NOT EXISTS chapter_cache/);
    assert.match(baseline, /CREATE TABLE IF NOT EXISTS reader_users/);
    assert.match(store, /async function initPg\(\) \{\s+await runMigrations\(\);\s+\}/);
});

test("legacy migration history adopts the consolidated baseline without executing it", async () => {
    const files = await listMigrationFiles();
    const queries = [];
    const client = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (/to_regclass/.test(sql)) {
                return {
                    rows: [{
                        table_0: true,
                        table_1: true,
                        table_2: true,
                        table_3: true,
                        table_4: true,
                        table_5: true,
                        table_6: true,
                        table_7: true,
                        table_8: true
                    }]
                };
            }
            return { rows: [] };
        }
    };
    const applied = new Map([["010_word_cloud_indexes", "legacy-checksum"]]);

    assert.equal(await adoptLegacyBaseline(client, files, applied), true);
    assert.equal(applied.has("001_baseline"), true);
    assert.match(queries[1].sql, /INSERT INTO schema_migrations/);
    assert.equal(queries[1].params[0], "001_baseline");
});

test("applied migration checksum drift fails unless explicitly allowed", () => {
    const checksum = checksumSql("SELECT 1;");
    assert.equal(checksum.length, 64);
    assert.equal(verifyMigrationChecksum("001_test", checksum, checksum), true);
    assert.throws(
        () => verifyMigrationChecksum("001_test", checksum, checksumSql("SELECT 2;")),
        (err) => err.code === "PO18_MIGRATION_CHECKSUM_MISMATCH"
    );
    assert.equal(verifyMigrationChecksum("001_test", checksum, checksumSql("SELECT 2;"), { allowDrift: true }), false);
});

test("chapter stats migration replaces per-row refresh with statement-level updates", async () => {
    const sql = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "011_chapter_stats_incremental.sql"), "utf8");
    assert.match(sql, /DROP TRIGGER IF EXISTS trg_chapter_cache_book_stats/);
    assert.match(sql, /REFERENCING NEW TABLE AS new_chapters/);
    assert.match(sql, /REFERENCING OLD TABLE AS old_chapters/);
    assert.match(sql, /FOR EACH STATEMENT EXECUTE FUNCTION chapter_stats_after_insert/);
    assert.doesNotMatch(sql, /FOR EACH ROW/);
});

test("admin audit migration creates an append-only audit table", async () => {
    const sql = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "012_admin_audit_logs.sql"), "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS admin_audit_logs/);
    assert.match(sql, /details_json JSONB/);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON admin_audit_logs/);
    assert.match(sql, /append-only/);
});

test("system job lease migration adds claim retry heartbeat and cancel fields", async () => {
    const sql = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "013_system_job_leases.sql"), "utf8");
    assert.match(sql, /max_attempts INTEGER/);
    assert.match(sql, /idempotency_key TEXT/);
    assert.match(sql, /lease_expires_at TIMESTAMP/);
    assert.match(sql, /heartbeat_at TIMESTAMP/);
    assert.match(sql, /cancel_requested_at TIMESTAMP/);
    assert.match(sql, /idx_system_jobs_claim/);
    assert.match(sql, /idx_system_jobs_idempotency/);
});

test("API token migration stores only hashes scopes revocation and usage metadata", async () => {
    const sql = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "014_api_tokens.sql"), "utf8");
    assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
    assert.match(sql, /scopes_json JSONB/);
    assert.match(sql, /allowed_ips_json JSONB/);
    assert.match(sql, /revoked_at TIMESTAMP/);
    assert.match(sql, /last_used_at TIMESTAMP/);
    assert.doesNotMatch(sql, /token_value|raw_token/);
});

test("rollback files match migration versions and use sortable names", async () => {
    const migrations = await listMigrationFiles();
    const rollbacks = await listRollbackFiles();
    assert.ok(rollbacks.length > 0, "expected at least one rollback file");

    const migrationVersions = new Set(migrations.map((file) => file.version));
    const rollbackVersions = rollbacks.map((file) => file.version);
    const sorted = [...rollbackVersions].sort((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(rollbackVersions, sorted);

    for (const file of rollbacks) {
        assert.match(file.file, /^\d{3}_[a-z0-9_]+\.down\.sql$/);
        assert.ok(migrationVersions.has(file.version), `missing forward migration for ${file.version}`);
    }
});

test("data quality migration protects new writes without blocking legacy rows", async () => {
    const sql = await fs.readFile(path.join(__dirname, "..", "db", "migrations", "018_data_quality_guards.sql"), "utf8");
    assert.match(sql, /book_metadata_book_id_nonempty/);
    assert.match(sql, /chapter_cache_identity_nonempty/);
    assert.match(sql, /reader_review_vote_value/);
    assert.match(sql, /system_jobs_status_value/);
    assert.match(sql, /NOT VALID/g);
    assert.doesNotMatch(sql, /book_key/i);
});
