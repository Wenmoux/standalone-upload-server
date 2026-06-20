const fs = require("fs");
const path = require("path");
const { pool, query } = require("../pg-store");

const SKIP_PLATFORMS = new Set(["qidian", "qd", "fanqie", "fq", "tomato"]);

function argValue(name) {
    const prefix = `${name}=`;
    const exact = process.argv.indexOf(name);
    if (exact >= 0) return process.argv[exact + 1] || "";
    const found = process.argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : "";
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function platformKey(value = "") {
    return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function shouldSkip(platform = "") {
    return SKIP_PLATFORMS.has(platformKey(platform));
}

function progress(message) {
    process.stderr.write(`[按chapter_id修复] ${message}\n`);
}

function numericChapterId(value = "") {
    const text = String(value || "").trim();
    return /^\d+$/.test(text) ? BigInt(text) : null;
}

function normalizeDigits(value = "") {
    return String(value || "").replace(/[\uff10-\uff19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parseTitleNumber(title = "") {
    const text = normalizeDigits(title).trim();
    let match = text.match(/\u7b2c\s*0*(\d{1,5})\s*[\u7ae0\u8282\u7bc0\u56de\u8a71\u8bdd]/u);
    if (match) return Number(match[1]);
    match = text.match(/^0*(\d{1,5})\s*[.\uff0e\u3001]/u);
    if (match) return Number(match[1]);
    match = text.match(/^0*(\d{1,5})\s+\S/u);
    return match ? Number(match[1]) : null;
}

function compareChapterRows(a, b) {
    const an = numericChapterId(a.chapter_id);
    const bn = numericChapterId(b.chapter_id);
    if (an !== null && bn !== null && an !== bn) return an < bn ? -1 : 1;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    const ao = Number(a.chapter_order || 0);
    const bo = Number(b.chapter_order || 0);
    if (ao > 0 && bo > 0 && ao !== bo) return ao - bo;
    if (ao > 0 && bo <= 0) return -1;
    if (ao <= 0 && bo > 0) return 1;
    return Number(a.id || 0) - Number(b.id || 0);
}

function titleOrderDiagnostics(rows = []) {
    const parsedRows = [];
    let previous = null;
    const regressions = [];
    const sorted = [...rows].sort(compareChapterRows);
    for (let index = 0; index < sorted.length; index += 1) {
        const row = sorted[index];
        const titleNumber = parseTitleNumber(row.title || "");
        if (titleNumber === null) continue;
        parsedRows.push(row);
        if (previous && titleNumber < previous.titleNumber) {
            regressions.push({
                position: index + 1,
                previous: {
                    chapter_id: previous.row.chapter_id,
                    title: previous.row.title || "",
                    title_number: previous.titleNumber
                },
                current: {
                    chapter_id: row.chapter_id,
                    title: row.title || "",
                    title_number: titleNumber
                }
            });
        }
        if (!previous || titleNumber > previous.titleNumber) previous = { row, titleNumber };
    }
    const parsedCoverage = rows.length ? parsedRows.length / rows.length : 0;
    return {
        parsed: parsedRows.length,
        parsedCoverage,
        regressions: regressions.length,
        sampleRegressions: regressions.slice(0, 5)
    };
}

function analyzeRows(rows = []) {
    const sorted = [...rows].sort(compareChapterRows);
    const desired = new Map(sorted.map((row, index) => [Number(row.id), index + 1]));
    let changes = 0;
    let duplicates = 0;
    let missing = 0;
    const seen = new Map();
    for (const row of rows) {
        const current = Number(row.chapter_order || 0);
        if (current <= 0) missing += 1;
        if (current > 0) seen.set(current, (seen.get(current) || 0) + 1);
        if (current !== desired.get(Number(row.id))) changes += 1;
    }
    for (const count of seen.values()) {
        if (count > 1) duplicates += count - 1;
    }
    return { sorted, desired, changes, duplicates, missing };
}

async function repairBook(client, book, analysis, apply) {
    if (!apply || !analysis.changes) return;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`repair_chapter_order:${book.book_id}`]);
    await client.query(
        `WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     ORDER BY
                       CASE WHEN chapter_id ~ '^[0-9]+$' THEN 0 ELSE 1 END ASC,
                       CASE WHEN chapter_id ~ '^[0-9]+$' THEN chapter_id::numeric END ASC NULLS LAST,
                       CASE WHEN COALESCE(chapter_order, 0) > 0 THEN chapter_order END ASC NULLS LAST,
                       id ASC
                   )::int rn
            FROM chapter_cache
            WHERE book_id = $1
         )
         UPDATE chapter_cache c
         SET chapter_order = -ranked.rn
         FROM ranked
         WHERE c.id = ranked.id`,
        [book.book_id]
    );
    await client.query(
        `UPDATE chapter_cache
         SET chapter_order = -chapter_order
         WHERE book_id = $1 AND chapter_order < 0`,
        [book.book_id]
    );
}

function writeJsonReport(filePath, output) {
    const fullPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, `${JSON.stringify(output, null, 2)}\n`);
    return fullPath;
}

async function main() {
    const apply = hasFlag("--apply");
    const bookId = argValue("--book-id").trim();
    const limit = Math.max(0, Number.parseInt(argValue("--limit") || "0", 10) || 0);
    const anomalyReportPath = argValue("--anomaly-report").trim() || "chapter-order-anomalies.json";
    const anomalyRegressionThreshold = Math.max(1, Number.parseInt(argValue("--anomaly-regressions") || "3", 10) || 3);
    const anomalyCoverageThreshold = Math.min(1, Math.max(0, Number.parseFloat(argValue("--anomaly-coverage") || "0.4") || 0.4));

    const params = [];
    const where = [];
    if (bookId) {
        params.push(bookId);
        where.push(`c.book_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const bookSql = `
        WITH metadata AS (
            SELECT DISTINCT ON (m.book_id)
                   m.book_id,
                   COALESCE(NULLIF(TRIM(m.platform), ''), 'po18') platform
            FROM book_metadata m
            ${whereSql.replace(/c\./g, "m.")}
            ORDER BY m.book_id, COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
        )
        SELECT metadata.book_id,
               metadata.platform,
               COUNT(c.id)::int chapter_count
        FROM metadata
        JOIN chapter_cache c ON c.book_id = metadata.book_id
        GROUP BY metadata.book_id, metadata.platform
        ORDER BY COUNT(c.id) DESC, metadata.book_id ASC
        ${limit ? `LIMIT ${limit}` : ""}`;
    const books = (await query(bookSql, params)).rows;
    const targetBooks = books.filter((book) => !shouldSkip(book.platform));
    const skippedBooks = books.length - targetBooks.length;

    const totals = {
        scannedBooks: books.length,
        skippedBooks,
        targetBooks: targetBooks.length,
        changedBooks: 0,
        changedChapters: 0,
        duplicateOrders: 0,
        missingOrders: 0,
        totalChapters: 0
    };
    const samples = [];
    const anomalies = [];
    const client = await pool.connect();
    try {
        progress(`开始：模式=${apply ? "实际写入" : "预览"}，扫描 ${books.length} 本，跳过 ${skippedBooks} 本，待处理 ${targetBooks.length} 本。`);
        if (apply) await client.query("BEGIN");
        for (let index = 0; index < targetBooks.length; index += 1) {
            const book = targetBooks[index];
            const rows = (
                await client.query(
                    `SELECT id, book_id, chapter_id, chapter_order, title
                     FROM chapter_cache
                     WHERE book_id = $1`,
                    [book.book_id]
                )
            ).rows;
            totals.totalChapters += rows.length;
            const analysis = analyzeRows(rows);
            await repairBook(client, book, analysis, apply);
            const diagnostics = titleOrderDiagnostics(rows);
            const abnormal =
                rows.length >= 3 &&
                diagnostics.parsedCoverage >= anomalyCoverageThreshold &&
                diagnostics.regressions >= anomalyRegressionThreshold;
            if (abnormal) {
                anomalies.push({
                    book_id: book.book_id,
                    platform: book.platform,
                    chapters: rows.length,
                    parsed_title_numbers: diagnostics.parsed,
                    parsed_coverage: Number(diagnostics.parsedCoverage.toFixed(4)),
                    chapterid_title_regressions: diagnostics.regressions,
                    suggested_next_strategy: "title_number",
                    sample_regressions: diagnostics.sampleRegressions
                });
            }
            totals.duplicateOrders += analysis.duplicates;
            totals.missingOrders += analysis.missing;
            if (analysis.changes) {
                totals.changedBooks += 1;
                totals.changedChapters += analysis.changes;
                if (samples.length < 20) {
                    const preview = analysis.sorted.slice(0, 5).map((row, previewIndex) => ({
                        chapter_id: row.chapter_id,
                        old_order: Number(row.chapter_order || 0),
                        new_order: previewIndex + 1,
                        title: row.title || ""
                    }));
                    samples.push({ book_id: book.book_id, platform: book.platform, chapters: rows.length, changes: analysis.changes, strategy: "numeric_chapter_id", preview });
                }
            }
            const status = analysis.changes ? `${apply ? "已修复" : "需修复"} ${analysis.changes} 章` : "无需修改";
            const check = abnormal
                ? `异常：按标题检测 chapter_id 顺序回退 ${diagnostics.regressions} 次，已加入异常报告`
                : `正常：标题可解析 ${diagnostics.parsed}/${rows.length}，未发现明显回退`;
            progress(`[${index + 1}/${targetBooks.length}] 书号 ${book.book_id}，平台 ${book.platform}，共 ${rows.length} 章，${status}；${check}。`);
        }
        if (apply) await client.query("COMMIT");
    } catch (err) {
        if (apply) await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    const output = { mode: apply ? "apply" : "dry-run", totals, anomalies: { count: anomalies.length, items: anomalies }, samples };
    const reportFile = writeJsonReport(anomalyReportPath, output);
    progress(`报告已写入：${reportFile}`);
    progress(`完成：处理 ${totals.targetBooks} 本，${apply ? "已修复" : "预览需修复"} ${totals.changedBooks} 本 / ${totals.changedChapters} 章，异常 ${anomalies.length} 本。`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
