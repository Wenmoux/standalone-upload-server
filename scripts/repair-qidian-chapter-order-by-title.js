const fs = require("fs");
const path = require("path");
const { pool, query } = require("../pg-store");

const DEFAULT_BOOK_IDS = [
    "1040317756",
    "1028443277",
    "1044896207",
    "1047166699",
    "1046938619",
    "1047882236",
    "1047672759",
    "1010868264"
];

const SPECIAL_TITLE_RE =
    /(\u4e0a\u67b6|\u611f\u8a00|\u8bf7\u5047|\u55ae\u7ae0|\u5355\u7ae0|\u6d3b\u52a8|\u6d3b\u52d5|\u6708\u7968|\u62bd\u5956|\u901a\u77e5|\u516c\u544a|\u8bf4\u660e|\u8aaa\u660e|\u603b\u7ed3|\u7e3d\u7d50|\u756a\u5916|\u5b8c\u7ed3|\u5b8c\u672c|\u5927\u4fee|\u89e3\u7981|\u65b0\u5e74\u5feb\u4e50|\u4e2d\u79cb\u5feb\u4e50|\u611f\u8c22|\u611f\u8b1d|\u6210\u7ee9|\u6210\u7e3e|\u6c47\u62a5|\u532f\u5831|\u4f11\u606f)/u;

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

function uniq(items) {
    return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeDigits(value = "") {
    return String(value || "").replace(/[\uff10-\uff19]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parseLeadingChapterNumber(title = "") {
    const text = normalizeDigits(title).trim();
    let match = text.match(/^\u7b2c\s*0*(\d{1,5})(?:\.(\d{1,3}))?\s*[\u7ae0\u8282\u7bc0\u56de\u8a71\u8bdd]/u);
    if (match) {
        const main = Number(match[1]);
        const decimal = match[2] ? Number(`0.${match[2]}`) : 0;
        return main + decimal;
    }
    match = text.match(/^0*(\d{1,5})(?:\.(\d{1,3}))?\s*[.\uff0e\u3001]/u);
    if (match) {
        const main = Number(match[1]);
        const decimal = match[2] ? Number(`0.${match[2]}`) : 0;
        return main + decimal;
    }
    match = text.match(/^0*(\d{1,5})(?:\.(\d{1,3}))?\s+\S/u);
    if (!match) return null;
    const main = Number(match[1]);
    const decimal = match[2] ? Number(`0.${match[2]}`) : 0;
    return main + decimal;
}

function parseEmbeddedSubChapterNumber(title = "") {
    const text = normalizeDigits(title).trim();
    const match = text.match(/\u7b2c\s*0*(\d{1,5})\.(\d{1,3})\s*[\u7ae0\u8282\u7bc0\u56de\u8a71\u8bdd]/u);
    if (!match) return null;
    return Number(match[1]) + Number(`0.${match[2]}`);
}

function isSpecialTitle(title = "") {
    return SPECIAL_TITLE_RE.test(String(title || ""));
}

function titleSortKey(row) {
    const title = row.title || "";
    const embedded = parseEmbeddedSubChapterNumber(title);
    if (embedded !== null) return { key: embedded, source: "embedded_subchapter", special: false };
    const leading = parseLeadingChapterNumber(title);
    if (leading === null) return { key: null, source: "unparsed", special: isSpecialTitle(title) };
    const special = isSpecialTitle(title);
    return { key: special ? null : leading, source: special ? "special_anchor" : "leading_chapter", special };
}

function compareCurrent(a, b) {
    const ao = Number(a.chapter_order || 0);
    const bo = Number(b.chapter_order || 0);
    if (ao > 0 && bo > 0 && ao !== bo) return ao - bo;
    if (ao > 0 && bo <= 0) return -1;
    if (ao <= 0 && bo > 0) return 1;
    return Number(a.id || 0) - Number(b.id || 0);
}

function buildDesiredOrder(rows) {
    const current = [...rows].sort(compareCurrent);
    const items = current.map((row, index) => {
        const info = titleSortKey(row);
        return {
            row,
            currentIndex: index,
            titleKey: info.key,
            source: info.source,
            special: info.special,
            anchorKey: null
        };
    });

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.titleKey !== null) {
            item.anchorKey = item.titleKey;
            continue;
        }

        let previous = null;
        let next = null;
        for (let i = index - 1; i >= 0; i -= 1) {
            if (items[i].titleKey !== null) {
                previous = items[i];
                break;
            }
        }
        for (let i = index + 1; i < items.length; i += 1) {
            if (items[i].titleKey !== null) {
                next = items[i];
                break;
            }
        }

        if (previous && next && previous.titleKey <= next.titleKey) {
            const span = Math.max(2, next.currentIndex - previous.currentIndex);
            const offset = (index - previous.currentIndex) / span;
            item.anchorKey = previous.titleKey + (next.titleKey - previous.titleKey) * offset;
        } else if (previous) {
            item.anchorKey = previous.titleKey + 0.001 + (index - previous.currentIndex) * 0.001;
        } else if (next) {
            item.anchorKey = next.titleKey - 0.001 * (next.currentIndex - index);
        } else {
            item.anchorKey = Number.MAX_SAFE_INTEGER;
        }
    }

    return items.sort((a, b) => {
        if (a.anchorKey !== b.anchorKey) return a.anchorKey - b.anchorKey;
        if (a.titleKey !== null && b.titleKey !== null && a.titleKey !== b.titleKey) return a.titleKey - b.titleKey;
        return a.currentIndex - b.currentIndex;
    });
}

function chapterRegressions(orderedItems) {
    const regressions = [];
    let previous = null;
    for (let index = 0; index < orderedItems.length; index += 1) {
        const item = orderedItems[index];
        if (item.titleKey === null) continue;
        if (previous && item.titleKey < previous.titleKey) {
            regressions.push({
                position: index + 1,
                previous: sampleItem(previous, previous.position),
                current: sampleItem(item, index + 1)
            });
        }
        if (!previous || item.titleKey > previous.titleKey) {
            previous = { ...item, position: index + 1 };
        }
    }
    return regressions;
}

function sampleItem(item, position) {
    return {
        position,
        id: Number(item.row.id),
        chapter_id: String(item.row.chapter_id || ""),
        old_order: Number(item.row.chapter_order || 0),
        title_key: item.titleKey,
        source: item.source,
        title: item.row.title || ""
    };
}

function analyzeRows(rows) {
    const ordered = buildDesiredOrder(rows);
    const desired = new Map(ordered.map((item, index) => [Number(item.row.id), index + 1]));
    let changes = 0;
    let parsed = 0;
    let specialAnchors = 0;
    let unparsed = 0;
    for (const item of ordered) {
        if (item.titleKey !== null) parsed += 1;
        else if (item.special) specialAnchors += 1;
        else unparsed += 1;
        if (Number(item.row.chapter_order || 0) !== desired.get(Number(item.row.id))) changes += 1;
    }
    return {
        ordered,
        desired,
        changes,
        parsed,
        specialAnchors,
        unparsed,
        regressions: chapterRegressions(ordered)
    };
}

async function applyBook(client, bookId, analysis) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`qidian_title_order:${bookId}`]);
    const values = analysis.ordered.map((item, index) => `(${Number(item.row.id)}, ${index + 1})`).join(",");
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
        [bookId]
    );
}

function writeJson(filePath, data) {
    const fullPath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return fullPath;
}

async function main() {
    const apply = hasFlag("--apply");
    const noReport = hasFlag("--no-report");
    const bookIds = uniq(argValue("--book-id") ? [argValue("--book-id")] : DEFAULT_BOOK_IDS);
    const outputPath = argValue("--output") || (apply ? "qidian-title-order-apply.json" : "qidian-title-order-preview.json");
    const books = (
        await query(
            `SELECT DISTINCT ON (m.book_id)
                    m.book_id,
                    m.title,
                    COALESCE(NULLIF(TRIM(m.platform), ''), 'unknown') platform
             FROM book_metadata m
             WHERE m.book_id = ANY($1)
             ORDER BY m.book_id, m.id DESC`,
            [bookIds]
        )
    ).rows;
    const bookById = new Map(books.map((book) => [String(book.book_id), book]));
    const client = await pool.connect();
    const summaries = [];
    try {
        if (apply) await client.query("BEGIN");
        for (const bookId of bookIds) {
            const book = bookById.get(bookId) || { book_id: bookId, title: bookId, platform: "unknown" };
            const rows = (
                await client.query(
                    `SELECT id, book_id, chapter_id, chapter_order, title
                     FROM chapter_cache
                     WHERE book_id = $1`,
                    [bookId]
                )
            ).rows;
            const analysis = analyzeRows(rows);
            if (apply && analysis.changes) await applyBook(client, bookId, analysis);
            const summary = {
                book_id: bookId,
                title: book.title || bookId,
                platform: book.platform,
                chapters: rows.length,
                parsed_body_chapters: analysis.parsed,
                special_anchored: analysis.specialAnchors,
                unparsed: analysis.unparsed,
                changes: analysis.changes,
                body_regressions_after: analysis.regressions.length,
                regression_samples: analysis.regressions.slice(0, 8),
                preview: analysis.ordered.slice(0, 16).map((item, index) => ({
                    new_order: index + 1,
                    ...sampleItem(item, index + 1)
                }))
            };
            summaries.push(summary);
            process.stderr.write(
                `[qidian-title-order] ${apply ? "applied" : "preview"} ${bookId} ${summary.title}: ` +
                    `${rows.length} chapters, changes=${summary.changes}, bodyRegressions=${summary.body_regressions_after}, ` +
                    `special=${summary.special_anchored}, unparsed=${summary.unparsed}\n`
            );
        }
        if (apply) await client.query("COMMIT");
    } catch (err) {
        if (apply) await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    if (!noReport) {
        const reportFile = writeJson(outputPath, { mode: apply ? "apply" : "preview", books: summaries });
        process.stderr.write(`[qidian-title-order] report written: ${reportFile}\n`);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
