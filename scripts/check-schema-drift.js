#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_DIR = path.join(ROOT, "db", "migrations");
const SNAPSHOT_FILE = path.join(ROOT, "db", "schema-snapshot.json");
const SOURCE_ROOTS = ["pg-store.js", "server-pg.js", "services", "routes", "bot", "docker", "scripts"];

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function migrationSnapshot(directory = MIGRATION_DIR) {
    const files = fs.readdirSync(directory).filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
    const migrations = files.map((file) => ({ file, sha256: sha256(fs.readFileSync(path.join(directory, file))) }));
    return {
        version: 1,
        latest: files.at(-1)?.replace(/\.sql$/, "") || "",
        migration_count: files.length,
        aggregate_sha256: sha256(migrations.map((row) => `${row.file}:${row.sha256}`).join("\n")),
        migrations
    };
}

function javascriptFiles(target) {
    const stat = fs.statSync(target);
    if (stat.isFile()) return target.endsWith(".js") ? [target] : [];
    return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
        if (["node_modules", "dist", "dist-reader", "public"].includes(entry.name)) return [];
        return javascriptFiles(path.join(target, entry.name));
    });
}

function unexpectedRuntimeDdl(root = ROOT) {
    const pattern = /\b(?:CREATE|ALTER|DROP)\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|INDEX|TRIGGER|TYPE|FUNCTION)\b/gi;
    const hits = [];
    for (const source of SOURCE_ROOTS) {
        const target = path.join(root, source);
        if (!fs.existsSync(target)) continue;
        for (const file of javascriptFiles(target)) {
            const relative = path.relative(root, file).replace(/\\/g, "/");
            const text = fs.readFileSync(file, "utf8");
            for (const match of text.matchAll(pattern)) {
                const context = text.slice(match.index, match.index + 180);
                const allowedMigrationLedger = relative === "pg-store.js" && /schema_migrations/i.test(context);
                const allowedBenchmarkFixture = relative === "scripts/search-benchmark.js" && /benchmark_/i.test(context);
                if (!allowedMigrationLedger && !allowedBenchmarkFixture) {
                    const line = text.slice(0, match.index).split(/\r?\n/).length;
                    hits.push({ file: relative, line, statement: match[0] });
                }
            }
        }
    }
    return hits;
}

function checkSchemaDrift(options = {}) {
    const actual = migrationSnapshot(options.migrationDir || MIGRATION_DIR);
    const expected = JSON.parse(fs.readFileSync(options.snapshotFile || SNAPSHOT_FILE, "utf8"));
    const errors = [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(`migration snapshot differs: expected ${expected.aggregate_sha256}, got ${actual.aggregate_sha256}`);
    }
    for (const hit of unexpectedRuntimeDdl(options.root || ROOT)) {
        errors.push(`runtime schema DDL outside migrations: ${hit.file}:${hit.line} ${hit.statement}`);
    }
    return { ok: errors.length === 0, expected, actual, errors };
}

if (require.main === module) {
    const result = checkSchemaDrift();
    if (!result.ok) {
        for (const error of result.errors) console.error(`[schema-drift] ${error}`);
        process.exitCode = 1;
    } else {
        console.log(`[schema-drift] ${result.actual.migration_count} migrations, latest ${result.actual.latest}, snapshot ${result.actual.aggregate_sha256}`);
    }
}

module.exports = { checkSchemaDrift, migrationSnapshot, sha256, unexpectedRuntimeDdl };
