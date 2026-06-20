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
    process.stderr.write(`[按标题修复异常书] ${message}\n`);
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

function compareByStableInsert(a, b) {
    const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ac && bc && ac !== bc) return ac - bc;
    if (ac && !bc) return -1;
    if (!ac && bc) return 1;
    return Number(a.id || 0) - Number(b.id || 0);
}

function sortByTitleNumber(rows = []) {
    const sorted = [...rows].sort(compareByStableInsert);
    const insertIndex = new Map(sorted.map((row, index) => [Number(row.id), index]));
    const keys = new Map();
    for (let index = 0; index < sorted.length; index += 1) {
        const row = sorted[index];
        const titleNumber = parseTitleNumber(row.title || "");
        if (titleNumber !== null) {
            keys.set(Number(row.id), titleNumber);
            continue;
        }
        let prevNumber = null;
        let nextNumber = null;
        for (let i = index - 1; i >= 0; i -= 1) {
            const value = parseTitleNumber(sorted[i].title || "");
            if (value !== null) {
                prevNumber = value;
                break;
            }
        }
        for (let i = index + 1; i < sorted.length; i += 1) {
            const value = parseTitleNumber(sorted[i].title || "");
            if (value !== null) {
                nextNumber = value;
                break;
            }
        }
        if (prevNumber !== null && nextNumber !== null && prevNumber <= nextNumber) {
            keys.set(Number(row.id), (prevNumber + nextNumber) / 2);
        } else if (prevNumber !== null) {
            keys.set(Number(row.id), prevNumber + 0.5);
        } else if (nextNumber !== null) {
            keys.set(Number(row.id), nextNumber - 0.5);
        } else {
            keys.set(Number(row.id), Number.MAX_SAFE_INTEGER);
        }
    }
    return [...rows].sort((a, b) => {
        const ak = keys.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER;
        const bk = keys.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER;
        if (ak !== bk) return ak - bk;
        return (insertIndex.get(Number(a.id)) ?? 0) - (insertIndex.get(Number(b.id)) ?? 0);
    });
}

function analyzeTitleOrder(rows = [], options = {}) {
    const minCoverage = options.minCoverage ?? 0.4;
    const maxRegressions = options.maxRegressions ?? 2;
    const maxDuplicateRatio = options.maxDuplicateRatio ?? 0.08;
    const sorted = sortByTitleNumber(rows);
    const desired = new Map(sorted.map((row, index) => [Number(row.id), index + 1]));
    const titleNumbers = [];
    const duplicates = new Map();
    let regressionsInTitleSort = 0;
    let previous = null;
    for (const row of sorted) {
        const value = parseTitleNumber(row.title || "");
        if (value === null) continue;
        titleNumbers.push(value);
        duplicates.set(value, (duplicates.get(value) || 0) + 1);
        if (previous !== null && value < previous) regressionsInTitleSort += 1;
        previous = Math.max(previous ?? value, value);
    }
    let duplicateTitleNumbers = 0;
    for (const count of duplicates.values()) {
        if (count > 1) duplicateTitleNumbers += count - 1;
    }
    let changes = 0;
    for (const row of rows) {
        if (Number(row.chapter_order || 0) !== desired.get(Number(row.id))) changes += 1;
    }
    const parsedCoverage = rows.length ? titleNumbers.length / rows.length : 0;
    const duplicateRatio = titleNumbers.length ? duplicateTitleNumbers / titleNumbers.length : 0;
    const usable =
        rows.length > 0 &&
        parsedCoverage >= minCoverage &&
        regressionsInTitleSort <= maxRegressions &&
        duplicateRatio <= maxDuplicateRatio;
    return {
        sorted,
        desired,
        changes,
        usable,
        parsed: titleNumbers.length,
        parsedCoverage,
        regressionsInTitleSort,
        duplicateTitleNumbers,
        duplicateRatio,
        reason: usable
            ? "title_number"
            : [
                  parsedCoverage < minCoverage ? "low_title_number_coverage" : "",
                  regressionsInTitleSort > maxRegressions ? "title_number_regressions" : "",
                  duplicateRatio > maxDuplicateRatio ? "duplicate_title_numbers" : ""
              ]
                  .filter(Boolean)
                  .join(",")
    };
}

function readBookIdsFromReport(reportPath) {
    if (!reportPath) return [];
    const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const items = Array.isArray(data) ? data : data.anomalies?.items || data.items || [];
    return items.map((item) => String(item.book_id || item.bookId || "").trim()).filter(Boolean);
}

async function findBooks(bookIds, limit) {
    const params = [];
    const where = [];
    if (bookIds.length) {
        params.push(bookIds);
        where.push(`m.book_id = ANY($${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
        await query(
            `WITH metadata AS (
                SELECT DISTINCT ON (m.book_id)
                       m.book_id,
                       COALESCE(NULLIF(TRIM(m.platform), ''), 'po18') platform
                FROM book_metadata m
                ${whereSql}
                ORDER BY m.book_id, COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
            )
            SELECT metadata.book_id,
                   metadata.platform,
                   COUNT(c.id)::int chapter_count
            FROM metadata
            JOIN chapter_cache c ON c.book_id = metadata.book_id
            GROUP BY metadata.book_id, metadata.platform
            ORDER BY COUNT(c.id) DESC, metadata.book_id ASC
            ${limit ? `LIMIT ${limit}` : ""}`,
            params
        )
    ).rows;
}

async function applyBook(client, book, analysis) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`repair_chapter_order_title:${book.book_id}`]);
    const values = analysis.sorted.map((row, index) => `(${Number(row.id)}, ${index + 1})`).join(",");
    if (!values) return;
    await client.query(
        `WITH desired(id, rn) AS (VALUES ${values})
         UPDATE chapter_cache c
         SET chapter_order = -desired.rn
         FROM desired
         WHERE c.id = desired.id`
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
    const reportPath = argValue("--from-report").trim();
    const bookId = argValue("--book-id").trim();
    const outputPath = argValue("--output").trim() || "chapter-order-title-repair.json";
    const limit = Math.max(0, Number.parseInt(argValue("--limit") || "0", 10) || 0);
    const minCoverage = Math.min(1, Math.max(0, Number.parseFloat(argValue("--min-coverage") || "0.4") || 0.4));
    const maxRegressions = Math.max(0, Number.parseInt(argValue("--max-regressions") || "2", 10) || 2);
    const maxDuplicateRatio = Math.min(1, Math.max(0, Number.parseFloat(argValue("--max-duplicate-ratio") || "0.08") || 0.08));
    const bookIds = [...new Set([...(bookId ? [bookId] : []), ...readBookIdsFromReport(reportPath)])];
    if (!bookIds.length && !limit) {
        throw new Error("请提供 --from-report、--book-id 或 --limit");
    }

    const books = (await findBooks(bookIds, limit)).filter((book) => !shouldSkip(book.platform));
    const totals = {
        scannedBooks: books.length,
        titleUsableBooks: 0,
        needsSourceCatalogBooks: 0,
        changedBooks: 0,
        changedChapters: 0,
        totalChapters: 0
    };
    const repaired = [];
    const needsSourceCatalog = [];
    const samples = [];
    const client = await pool.connect();
    try {
        progress(`开始：模式=${apply ? "实际写入" : "预览"}，待处理异常书 ${books.length} 本。`);
        if (apply) await client.query("BEGIN");
        for (let index = 0; index < books.length; index += 1) {
            const book = books[index];
            const rows = (
                await client.query(
                    `SELECT id, book_id, chapter_id, chapter_order, title, created_at
                     FROM chapter_cache
                     WHERE book_id = $1`,
                    [book.book_id]
                )
            ).rows;
            totals.totalChapters += rows.length;
            const analysis = analyzeTitleOrder(rows, { minCoverage, maxRegressions, maxDuplicateRatio });
            const summary = {
                book_id: book.book_id,
                platform: book.platform,
                chapters: rows.length,
                parsed_title_numbers: analysis.parsed,
                parsed_coverage: Number(analysis.parsedCoverage.toFixed(4)),
                title_sort_regressions: analysis.regressionsInTitleSort,
                duplicate_title_numbers: analysis.duplicateTitleNumbers,
                duplicate_title_ratio: Number(analysis.duplicateRatio.toFixed(4)),
                changes: analysis.changes,
                strategy: analysis.usable ? "title_number" : "source_catalog",
                reason: analysis.reason
            };
            if (analysis.usable) {
                totals.titleUsableBooks += 1;
                if (analysis.changes) {
                    totals.changedBooks += 1;
                    totals.changedChapters += analysis.changes;
                    if (apply) await applyBook(client, book, analysis);
                }
                repaired.push(summary);
                if (samples.length < 20) {
                    samples.push({
                        ...summary,
                        preview: analysis.sorted.slice(0, 8).map((row, previewIndex) => ({
                            chapter_id: row.chapter_id,
                            old_order: Number(row.chapter_order || 0),
                            new_order: previewIndex + 1,
                            title_number: parseTitleNumber(row.title || ""),
                            title: row.title || ""
                        }))
                    });
                }
            } else {
                totals.needsSourceCatalogBooks += 1;
                needsSourceCatalog.push(summary);
            }
            const status = analysis.usable
                ? analysis.changes
                    ? `${apply ? "已修复" : "需修复"} ${analysis.changes} 章`
                    : "无需修改"
                : analysis.changes
                  ? `未写库，预计变动 ${analysis.changes} 章`
                  : "未写库";
            const strategyText = analysis.usable
                ? `标题可用：解析 ${summary.parsed_title_numbers}/${rows.length} 个标题序号，重复 ${summary.duplicate_title_numbers} 个`
                : `标题不可靠：${summary.reason || "未知原因"}，留给原站目录排序`;
            progress(`[${index + 1}/${books.length}] 书号 ${book.book_id}，平台 ${book.platform}，共 ${rows.length} 章，${status}；${strategyText}。`);
        }
        if (apply) await client.query("COMMIT");
    } catch (err) {
        if (apply) await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    const output = {
        mode: apply ? "apply" : "dry-run",
        totals,
        repaired,
        needs_source_catalog: needsSourceCatalog,
        samples
    };
    const reportFile = writeJsonReport(outputPath, output);
    progress(`报告已写入：${reportFile}`);
    progress(`完成：处理 ${totals.scannedBooks} 本，标题可修 ${totals.titleUsableBooks} 本，需原站目录 ${totals.needsSourceCatalogBooks} 本，${apply ? "已修复" : "预览需修复"} ${totals.changedBooks} 本 / ${totals.changedChapters} 章。`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
