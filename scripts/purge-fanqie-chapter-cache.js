#!/usr/bin/env node

/**
 * [INPUT]: 依赖 /config/app.env 中的 PostgreSQL 连接、chapter_cache 平台字段及 book_metadata 的旧数据归属证据
 * [OUTPUT]: 提供事务化清理 fanqie/fq/tomato 正文缓存的 CLI，并输出删除章节数与去重书籍 ID 数组
 * [POS]: scripts 的破坏性数据维护入口，只删除可证明属于番茄平台的 chapter_cache 行，绝不改动书籍元信息
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const CONFIRM_PHRASE = "PURGE_FANQIE_CHAPTER_CACHE";
const FANQIE_ALIASES = Object.freeze(["fanqie", "fq", "tomato"]);

const PURGE_SQL = `
WITH target AS MATERIALIZED (
    SELECT cache.id
    FROM chapter_cache AS cache
    WHERE LOWER(TRIM(COALESCE(cache.platform, ''))) = ANY($1::text[])
       OR (
            TRIM(COALESCE(cache.platform, '')) = ''
            AND EXISTS (
                SELECT 1
                FROM book_metadata AS metadata
                WHERE metadata.book_id = cache.book_id
                  AND LOWER(TRIM(COALESCE(metadata.platform, ''))) = ANY($1::text[])
            )
            AND NOT EXISTS (
                SELECT 1
                FROM book_metadata AS metadata
                WHERE metadata.book_id = cache.book_id
                  AND TRIM(COALESCE(metadata.platform, '')) <> ''
                  AND NOT (LOWER(TRIM(metadata.platform)) = ANY($1::text[]))
            )
       )
), deleted AS (
    DELETE FROM chapter_cache AS cache
    USING target
    WHERE cache.id = target.id
    RETURNING cache.book_id
)
SELECT
    COUNT(*)::integer AS deleted_chapters,
    COALESCE(JSON_AGG(DISTINCT book_id ORDER BY book_id), '[]'::json) AS book_ids
FROM deleted`;

function parseArgs(argv = process.argv.slice(2)) {
    const options = { confirm: "", help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--confirm") options.confirm = String(argv[++index] || "").trim();
        else if (arg.startsWith("--confirm=")) options.confirm = String(arg.slice("--confirm=".length)).trim();
        else if (arg === "--help" || arg === "-h") options.help = true;
        else throw new Error(`unknown argument: ${arg}`);
    }
    return options;
}

function usage() {
    return [
        "Usage:",
        `  node scripts/purge-fanqie-chapter-cache.js --confirm ${CONFIRM_PHRASE}`,
        "",
        "Deletes only chapter_cache rows for fanqie/fq/tomato and keeps book_metadata unchanged.",
        "The command prints JSON containing deletedChapters and the affected bookIds array."
    ].join("\n");
}

function assertConfirmed(value) {
    if (value !== CONFIRM_PHRASE) {
        throw new Error(`refusing to purge without --confirm ${CONFIRM_PHRASE}`);
    }
}

function normalizeResult(row = {}) {
    let bookIds = row.book_ids || [];
    if (typeof bookIds === "string") bookIds = JSON.parse(bookIds);
    return {
        success: true,
        deletedChapters: Number(row.deleted_chapters || 0),
        bookIds: [...new Set(bookIds.map((bookId) => String(bookId)))].sort()
    };
}

async function purgeFanqieChapterCache(pool) {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
        await client.query("BEGIN");
        transactionStarted = true;
        await client.query("SET LOCAL statement_timeout = 0");
        await client.query("SET LOCAL lock_timeout = '30s'");
        await client.query("LOCK TABLE chapter_cache IN SHARE ROW EXCLUSIVE MODE");
        const result = await client.query(PURGE_SQL, [FANQIE_ALIASES]);
        const summary = normalizeResult(result.rows?.[0]);
        await client.query("COMMIT");
        transactionStarted = false;
        return summary;
    } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(usage());
        return;
    }
    assertConfirmed(options.confirm);

    const { loadConfig } = require("../docker/run-all");
    loadConfig(process.env.PO18_CONFIG_FILE || "/config/app.env");
    const connectionString = process.env.PO18_PG_URL;
    if (!connectionString) throw new Error("missing PO18_PG_URL after loading the application config");

    const { Pool } = require("pg");
    const maintenanceTimeoutMs = Math.max(10 * 60 * 1000, Number(process.env.PO18_PG_MIGRATION_TIMEOUT_MS) || 0);
    const pool = new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 10000,
        query_timeout: maintenanceTimeoutMs
    });
    try {
        const summary = await purgeFanqieChapterCache(pool);
        console.log(JSON.stringify(summary));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(JSON.stringify({ success: false, error: error.message || String(error) }));
        process.exitCode = 1;
    });
}

module.exports = {
    CONFIRM_PHRASE,
    FANQIE_ALIASES,
    PURGE_SQL,
    assertConfirmed,
    normalizeResult,
    parseArgs,
    purgeFanqieChapterCache,
    usage
};
