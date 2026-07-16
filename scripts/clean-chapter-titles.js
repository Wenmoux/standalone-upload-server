#!/usr/bin/env node

/**
 * [INPUT]: 依赖 pg-store、chapter-title-cleaner、命令行筛选和显式 apply 开关
 * [OUTPUT]: 提供一次性目录标题清洗 SQL、参数解析、用户正则和事务更新，并以 dry-run 默认预览
 * [POS]: scripts 的受控数据维护入口，只改 chapter_cache.title，复用生产清洗规则而不复制标题算法
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
        volumesOnly: false,
        regexSources: [],
        regexFlags: "gu",
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
        else if (arg === "--volumes-only") options.volumesOnly = true;
        else if (arg === "--regex") options.regexSources.push(String(argv[++index] || ""));
        else if (arg.startsWith("--regex=")) options.regexSources.push(String(arg.slice("--regex=".length)));
        else if (arg === "--regex-flags") options.regexFlags = String(argv[++index] || "gu");
        else if (arg.startsWith("--regex-flags=")) options.regexFlags = String(arg.slice("--regex-flags=".length) || "gu");
        else if (arg === "--quiet") options.quiet = true;
        else if (arg === "--help" || arg === "-h") options.help = true;
    }
    return options;
}

function usage() {
    return [
        "Usage:",
        "  node scripts/clean-chapter-titles.js [--limit 200] [--platform qidian] [--book-id 123]",
        "  node scripts/clean-chapter-titles.js --apply --all [--volumes-only] [--quiet]",
        "  node scripts/clean-chapter-titles.js --apply --all --regex '/\\[作者注：[^\\]]+\\]/gu'",
        "",
        "这是一次性手工维护脚本，不会在启动或上传时自动执行。默认 dry-run；仅传 --apply 才会以事务更新 chapter_cache.title。",
        "Built-in rules remove confirmed bracketed author/update notes, dangling tail notes, and normalize whitespace/punctuation.",
        "--regex may be repeated; slash-delimited flags are honored, otherwise --regex-flags defaults to gu.",
        "Set PO18_PG_URL or DATABASE_URL before running."
    ].join("\n");
}

function parseRegexSpec(value, defaultFlags = "gu") {
    const text = String(value || "").trim();
    if (!text) throw new Error("--regex cannot be empty");
    const slash = text.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    const source = slash ? slash[1] : text;
    let flags = slash ? slash[2] : String(defaultFlags || "gu");
    if (!flags.includes("g")) flags += "g";
    try {
        return new RegExp(source, flags);
    } catch (error) {
        throw new Error(`invalid --regex ${text}: ${error.message}`);
    }
}

function buildCustomRegexes(options = {}) {
    return (options.regexSources || []).map((source) => parseRegexSpec(source, options.regexFlags));
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
    if (options.volumesOnly) where.push("COALESCE(is_volume, FALSE) = TRUE");
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

    const customRegexes = buildCustomRegexes(options);
    const pool = new Pool({ connectionString, keepAlive: true, keepAliveInitialDelayMillis: 10000 });
    let client;
    let clientError;
    let scanned = 0;
    let changed = 0;
    let transactionStarted = false;
    try {
        client = await pool.connect();
        client.on("error", (error) => {
            clientError = error;
        });
        const assertClientHealthy = () => {
            if (clientError) throw clientError;
        };
        const { sql, params } = buildSelectSql(options);
        const result = await client.query(sql, params);
        assertClientHealthy();
        if (options.apply) {
            await client.query("BEGIN");
            transactionStarted = true;
        } else {
            client.release();
            client = undefined;
        }
        for (const row of result.rows || []) {
            assertClientHealthy();
            scanned += 1;
            const cleaned = cleanChapterTitle(row.title || "", { customRegexes });
            if (!cleaned.changed || cleaned.title === row.title) continue;
            changed += 1;
            if (!options.quiet)
                console.log(
                    JSON.stringify({
                        id: row.id,
                        bookId: row.book_id,
                        chapterId: row.chapter_id,
                        order: row.chapter_order,
                        platform: row.platform,
                        before: row.title,
                        after: cleaned.title,
                        removed: cleaned.removed.map((item) => ({ text: item.text, ruleId: item.ruleId }))
                    })
                );
            if (options.apply) {
                await client.query("UPDATE chapter_cache SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [
                    cleaned.title,
                    row.id
                ]);
            }
        }
        assertClientHealthy();
        if (transactionStarted) await client.query("COMMIT");
    } catch (error) {
        if (transactionStarted && client) await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        if (client) client.release();
        await pool.end();
    }
    console.log(
        JSON.stringify({
            dryRun: !options.apply,
            scanned,
            changed,
            volumesOnly: options.volumesOnly,
            customRegexes: customRegexes.length
        })
    );
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.stack || err.message || String(err));
        process.exit(1);
    });
}

module.exports = { buildCustomRegexes, buildSelectSql, parseArgs, parseRegexSpec };
