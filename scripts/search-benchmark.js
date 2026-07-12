#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASELINE = path.join(ROOT, "benchmarks", "search-plan-baseline.json");

function percentile(values, ratio) {
    const rows = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (!rows.length) return 0;
    return rows[Math.max(0, Math.ceil(rows.length * ratio) - 1)];
}

function walkPlan(node, callback) {
    if (!node || typeof node !== "object") return;
    callback(node);
    for (const child of node.Plans || []) walkPlan(child, callback);
}

function summarizePlan(document) {
    const plan = document?.Plan || {};
    const nodeTypes = new Set();
    const buffers = {
        shared_hit: Number(plan["Shared Hit Blocks"] || 0),
        shared_read: Number(plan["Shared Read Blocks"] || 0),
        temp_read: Number(plan["Temp Read Blocks"] || 0),
        temp_written: Number(plan["Temp Written Blocks"] || 0)
    };
    walkPlan(plan, (node) => {
        if (node["Node Type"]) nodeTypes.add(node["Node Type"]);
    });
    return {
        planning_ms: Number(document?.["Planning Time"] || 0),
        execution_ms: Number(document?.["Execution Time"] || 0),
        plan_rows: Number(plan["Plan Rows"] || 0),
        actual_rows: Number(plan["Actual Rows"] || 0),
        total_cost: Number(plan["Total Cost"] || 0),
        node_types: [...nodeTypes].sort(),
        buffers
    };
}

function evaluateResults(results, budgets = {}) {
    const violations = [];
    for (const [name, result] of Object.entries(results || {})) {
        const budget = Number(budgets[name]);
        if (Number.isFinite(budget) && result.p95_ms > budget) {
            violations.push(`${name} p95 ${result.p95_ms.toFixed(2)}ms exceeds ${budget}ms`);
        }
        if (!result.samples || result.samples < 1) violations.push(`${name} has no benchmark samples`);
        if (!Array.isArray(result.node_types) || !result.node_types.length) violations.push(`${name} has no EXPLAIN plan nodes`);
    }
    return violations;
}

function parseArgs(argv = process.argv.slice(2)) {
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (key === "--baseline" || key === "--output" || key === "--rows" || key === "--runs") values[key.slice(2)] = argv[++index];
    }
    return values;
}

async function explain(client, sql, params, runs) {
    const samples = [];
    let latest = null;
    for (let index = 0; index < runs; index += 1) {
        const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
        const raw = result.rows[0]?.["QUERY PLAN"];
        const document = Array.isArray(raw) ? raw[0] : raw;
        latest = summarizePlan(document);
        samples.push(latest.execution_ms);
    }
    return {
        samples: samples.length,
        p50_ms: percentile(samples, 0.5),
        p95_ms: percentile(samples, 0.95),
        min_ms: Math.min(...samples),
        max_ms: Math.max(...samples),
        node_types: latest.node_types,
        planning_ms: latest.planning_ms,
        plan_rows: latest.plan_rows,
        actual_rows: latest.actual_rows,
        total_cost: latest.total_cost,
        buffers: latest.buffers
    };
}

async function prepareDataset(client, rows) {
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await client.query(`CREATE TEMP TABLE benchmark_book_metadata (
        id BIGINT PRIMARY KEY,
        book_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        tags TEXT NOT NULL,
        category TEXT NOT NULL,
        platform TEXT NOT NULL,
        total_popularity INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE benchmark_book_stats (
        book_id TEXT PRIMARY KEY,
        cache_count INTEGER NOT NULL,
        like_count INTEGER NOT NULL,
        dislike_count INTEGER NOT NULL
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE benchmark_book_taxonomy (
        metadata_id BIGINT NOT NULL,
        kind TEXT NOT NULL,
        normalized_value TEXT NOT NULL
    ) ON COMMIT DROP`);
    await client.query(
        `INSERT INTO benchmark_book_metadata(id, book_id, title, author, tags, category, platform, total_popularity, created_at, updated_at)
         SELECT g,
                'bench-' || g,
                CASE WHEN g % 97 = 0 THEN '星河目标作品 ' || g ELSE '普通作品 ' || md5(g::text) END,
                CASE WHEN g % 131 = 0 THEN '星河作者' ELSE '作者-' || (g % 2500) END,
                'tag-' || (g % 100) || ',category-' || (g % 20),
                'category-' || (g % 20),
                CASE WHEN g % 4 = 0 THEN 'qidian' ELSE 'po18' END,
                (g * 37) % 100000,
                CURRENT_TIMESTAMP - make_interval(secs => (g % 200000)::int),
                CURRENT_TIMESTAMP - make_interval(secs => (g % 200000)::int)
         FROM generate_series(1, $1::int) g`,
        [rows]
    );
    await client.query(
        `INSERT INTO benchmark_book_stats(book_id, cache_count, like_count, dislike_count)
         SELECT book_id, (id % 600)::int, (id % 90)::int, (id % 7)::int FROM benchmark_book_metadata`
    );
    await client.query(
        `INSERT INTO benchmark_book_taxonomy(metadata_id, kind, normalized_value)
         SELECT id, 'category', category FROM benchmark_book_metadata
         UNION ALL
         SELECT id, 'tag', 'tag-' || (id % 100) FROM benchmark_book_metadata`
    );
    await client.query("CREATE INDEX benchmark_books_book_id_trgm ON benchmark_book_metadata USING GIN (book_id gin_trgm_ops)");
    await client.query("CREATE INDEX benchmark_books_title_trgm ON benchmark_book_metadata USING GIN (title gin_trgm_ops)");
    await client.query("CREATE INDEX benchmark_books_author_trgm ON benchmark_book_metadata USING GIN (author gin_trgm_ops)");
    await client.query("CREATE INDEX benchmark_books_tags_trgm ON benchmark_book_metadata USING GIN (tags gin_trgm_ops)");
    await client.query("CREATE INDEX benchmark_books_updated_cursor ON benchmark_book_metadata ((COALESCE(updated_at, created_at)) DESC, id DESC)");
    await client.query("CREATE INDEX benchmark_books_platform ON benchmark_book_metadata (platform)");
    await client.query("CREATE INDEX benchmark_stats_cache ON benchmark_book_stats (cache_count, book_id)");
    await client.query("CREATE INDEX benchmark_taxonomy_lookup ON benchmark_book_taxonomy (kind, normalized_value, metadata_id)");
    await client.query("ANALYZE benchmark_book_metadata");
    await client.query("ANALYZE benchmark_book_stats");
    await client.query("ANALYZE benchmark_book_taxonomy");
}

async function runBenchmark(options = {}) {
    const baselinePath = path.resolve(options.baseline || DEFAULT_BASELINE);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const requestedRows = Number(options.rows || baseline.dataset_rows || 50000);
    const requestedRuns = Number(options.runs || baseline.runs || 5);
    const rows = Number.isSafeInteger(requestedRows) && requestedRows >= 1000 ? requestedRows : 50000;
    const runs = Number.isSafeInteger(requestedRuns) && requestedRuns >= 1 ? Math.min(requestedRuns, 50) : 5;
    const connectionString = options.connectionString || process.env.PO18_TEST_PG_URL || process.env.PO18_PG_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("set PO18_TEST_PG_URL or PO18_PG_URL to run the search benchmark");
    const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
    await client.connect();
    try {
        await client.query("BEGIN");
        await prepareDataset(client, rows);
        const results = {};
        results.keyword = await explain(
            client,
            `SELECT m.id, m.book_id, m.title, m.author, COALESCE(bs.cache_count, 0) cache_count
             FROM benchmark_book_metadata m
             LEFT JOIN benchmark_book_stats bs ON bs.book_id=m.book_id
             WHERE m.book_id ILIKE $1 OR m.title ILIKE $1 OR m.author ILIKE $1 OR m.tags ILIKE $1
             ORDER BY m.total_popularity DESC, m.id DESC LIMIT 21`,
            ["%星河%"],
            runs
        );
        results.taxonomy = await explain(
            client,
            `SELECT m.id, m.book_id, m.title, bs.cache_count
             FROM benchmark_book_metadata m
             JOIN benchmark_book_stats bs ON bs.book_id=m.book_id
             WHERE m.platform=$1 AND bs.cache_count >= $2
               AND EXISTS (
                   SELECT 1 FROM benchmark_book_taxonomy t
                   WHERE t.metadata_id=m.id AND t.kind='category' AND t.normalized_value=$3
               )
             ORDER BY COALESCE(m.updated_at, m.created_at) DESC, m.id DESC LIMIT 21`,
            ["po18", 1, "category-7"],
            runs
        );
        results.cursor = await explain(
            client,
            `SELECT m.id, m.book_id, m.title
             FROM benchmark_book_metadata m
             WHERE (COALESCE(m.updated_at, m.created_at), m.id) < ($1::timestamp, $2::bigint)
             ORDER BY COALESCE(m.updated_at, m.created_at) DESC, m.id DESC LIMIT 21`,
            [new Date(Date.now() - 60 * 60 * 1000), rows],
            runs
        );
        const violations = evaluateResults(results, baseline.budgets_ms);
        const version = await client.query("SHOW server_version");
        const report = {
            version: 1,
            generated_at: new Date().toISOString(),
            postgres_version: version.rows[0]?.server_version || "",
            dataset: { rows, runs, shape: "synthetic-reader-search-v1" },
            baseline: { path: path.relative(ROOT, baselinePath).replace(/\\/g, "/"), budgets_ms: baseline.budgets_ms },
            results,
            passed: violations.length === 0,
            violations
        };
        if (options.output) {
            const output = path.resolve(options.output);
            fs.mkdirSync(path.dirname(output), { recursive: true });
            fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
        }
        return report;
    } finally {
        await client.query("ROLLBACK").catch(() => {});
        await client.end();
    }
}

async function main() {
    const args = parseArgs();
    const report = await runBenchmark(args);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error.message || String(error));
        process.exitCode = 1;
    });
}

module.exports = { evaluateResults, parseArgs, percentile, runBenchmark, summarizePlan, walkPlan };
