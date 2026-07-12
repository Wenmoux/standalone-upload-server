#!/usr/bin/env node

/**
 * [INPUT]: 依赖 pg-store、chapter-title-cleaner、命令行筛选和显式 apply 开关
 * [OUTPUT]: 提供标题清洗 SQL 构造/参数解析，并以 dry-run 默认批量预览或更新章节标题
 * [POS]: scripts 的受控数据维护入口，复用生产清洗规则而不复制标题算法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const { Pool } = require("pg");
const { cleanChapterTitle } = require("../services/chapter-title-cleaner");

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        apply: false,
        limit: 200,
        platform: "",
        bookId: "",
        offset: 0,
        quiet: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--apply") options.apply = true;
        else if (arg === "--all") options.limit = 0;
        else if (arg === "--limit") options.limit = Number(argv[++index] || 0);
        else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length) || 0);
        else if (arg === "--offset") options.offset = Number(argv[++index] || 0);
        else if (arg.startsWith("--offset=")) options.offset = Number(arg.slice("--offset=".length) || 0);
        else if (arg === "--platform") options.platform = String(argv[++index] || "").trim();
        else if (arg.startsWith("--platform=")) options.platform = String(arg.slice("--platform=".length)).trim();
        else if (arg === "--book-id") options.bookId = String(argv[++index] || "").trim();
        else if (arg.startsWith("--book-id=")) options.bookId = String(arg.slice("--book-id=".length)).trim();
        else if (arg === "--quiet") options.quiet = true;
        else if (arg === "--help" || arg === "-h") options.help = true;
    }
    return options;
}

function usage() {
    return [
        "Usage:",
        "  node scripts/clean-chapter-titles.js [--limit 200] [--platform qidian] [--book-id 123]",
        "  node scripts/clean-chapter-titles.js --apply --all [--quiet]",
        "",
        "Default is dry-run. Use --apply to update chapter_cache.title.",
        "Set PO18_PG_URL or DATABASE_URL before running."
    ].join("\n");
}

function buildSelectSql(options = {}) {
    const where = ["COALESCE(title, '') <> ''"];
    const params = [];
    if (options.platform) {
        params.push(options.platform.toLowerCase());
        where.push("LOWER(TRIM(COALESCE(platform, ''))) = $" + params.length);
    }
    if (options.bookId) {
        params.push(String(options.bookId));
        where.push("book_id = $" + params.length);
    }
    const limit = Number(options.limit || 0);
    const offset = Number(options.offset || 0);
    let paging = "";
    if (limit > 0) {
        params.push(limit);
        paging += " LIMIT $" + params.length;
    }
    if (offset > 0) {
        params.push(offset);
        paging += " OFFSET $" + params.length;
    }
    return {
        sql: `SELECT id, book_id, chapter_id, chapter_order, title, platform
              FROM chapter_cache
              WHERE ${where.join(" AND ")}
              ORDER BY id ASC${paging}`,
        params
    };
}

async function main() {
    const options = parseArgs();
    if (options.help) {
        console.log(usage());
        return;
    }
    const connectionString = process.env.PO18_PG_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("missing PO18_PG_URL or DATABASE_URL");

    const pool = new Pool({ connectionString });
    let scanned = 0;
    let changed = 0;
    try {
        const { sql, params } = buildSelectSql(options);
        const result = await pool.query(sql, params);
        for (const row of result.rows || []) {
            scanned += 1;
            const cleaned = cleanChapterTitle(row.title || "");
            if (!cleaned.changed || cleaned.title === row.title) continue;
            changed += 1;
            if (!options.quiet) console.log(JSON.stringify({
                id: row.id,
                bookId: row.book_id,
                chapterId: row.chapter_id,
                order: row.chapter_order,
                platform: row.platform,
                before: row.title,
                after: cleaned.title,
                removed: cleaned.removed.map((item) => ({ text: item.text, ruleId: item.ruleId }))
            }));
            if (options.apply) {
                await pool.query(
                    "UPDATE chapter_cache SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                    [cleaned.title, row.id]
                );
            }
        }
    } finally {
        await pool.end();
    }
    console.log(JSON.stringify({ dryRun: !options.apply, scanned, changed }));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.stack || err.message || String(err));
        process.exit(1);
    });
}

module.exports = { buildSelectSql, parseArgs };
