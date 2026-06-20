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

function argList(name) {
    return argValue(name)
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function readCookie() {
    const direct = argValue("--cookie").trim();
    if (direct) return direct;
    const cookieFile = argValue("--cookie-file").trim();
    if (cookieFile) return fs.readFileSync(path.resolve(cookieFile), "utf8").trim();
    return String(process.env.PO18_CATALOG_COOKIE || process.env.PO18_COOKIE || "").trim();
}

function platformKey(value = "") {
    return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function shouldSkip(platform = "") {
    return SKIP_PLATFORMS.has(platformKey(platform));
}

function progress(message) {
    process.stderr.write(`[按原站目录修复] ${message}\n`);
}

function cleanText(value = "") {
    return String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastCounterIn(value = "") {
    const re = /<[^>]*class=["'][^"']*\bl_counter\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let found = null;
    for (const match of value.matchAll(re)) {
        const text = cleanText(match[1]);
        const number = Number.parseInt((text.match(/\d{1,8}/) || [])[0] || "", 10);
        if (Number.isFinite(number)) found = number;
    }
    return found;
}

function firstCounterIn(value = "") {
    const re = /<[^>]*class=["'][^"']*\bl_counter\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i;
    const match = value.match(re);
    if (!match) return null;
    const number = Number.parseInt((cleanText(match[1]).match(/\d{1,8}/) || [])[0] || "", 10);
    return Number.isFinite(number) ? number : null;
}

function parsePo18Catalog(html = "", bookId = "") {
    const rows = [];
    const seen = new Set();
    const escaped = String(bookId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`<a[^>]*href=["'][^"']*/books/${escaped}/articles/(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi"),
        new RegExp(`<a[^>]*href=["'][^"']*/books/${escaped}/articlescontent/(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi")
    ];
    const matches = [];
    for (const re of patterns) {
        for (const match of html.matchAll(re)) {
            matches.push({
                chapter_id: match[1],
                title: cleanText(match[2]),
                start: match.index || 0,
                end: (match.index || 0) + match[0].length
            });
        }
    }
    matches.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        if (seen.has(match.chapter_id)) continue;
        seen.add(match.chapter_id);
        const previousEnd = index > 0 ? matches[index - 1].end : 0;
        const nextStart = index + 1 < matches.length ? matches[index + 1].start : html.length;
        const before = html.slice(Math.max(previousEnd, match.start - 2500), match.start);
        const after = html.slice(match.end, Math.min(nextStart, match.end + 1200));
        rows.push({
            chapter_id: match.chapter_id,
            title: match.title || `chapter ${rows.length + 1}`,
            source_order: lastCounterIn(before) ?? firstCounterIn(after),
            fallback_order: rows.length + 1
        });
    }
    return rows;
}

async function fetchText(url, options = {}) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...options.headers
    };
    const cookie = String(options.cookie || "").trim();
    if (cookie) headers.Cookie = cookie;
    const retries = Math.max(0, options.retries || 0);
    const timeoutMs = Math.max(1000, options.timeoutMs || 20000);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { headers, redirect: "manual", signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok && response.status !== 302) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.text();
        } catch (err) {
            clearTimeout(timer);
            lastError = err;
            if (attempt >= retries) break;
            await sleep(800 * (attempt + 1));
        }
    }
    throw lastError;
}

async function fetchPo18Catalog(book = {}, options = {}) {
    const bookId = String(book.book_id || "").trim();
    const detailUrl = String(book.detail_url || "").trim();
    let base = detailUrl || `https://www.po18.tw/books/${bookId}/articles`;
    if (new RegExp(`/books/${bookId}/?$`).test(base)) {
        base = `${base.replace(/\/+$/, "")}/articles`;
    }
    base = base.replace(/\/+$/, "");
    const maxPages = options.maxPages || 50;
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
        const url = `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
        const html = await fetchText(url, {
            cookie: options.cookie,
            retries: options.retries,
            timeoutMs: options.timeoutMs
        });
        const pageRows = parsePo18Catalog(html, bookId);
        if (!pageRows.length) break;
        let added = 0;
        for (const row of pageRows) {
            if (seen.has(row.chapter_id)) continue;
            seen.add(row.chapter_id);
            rows.push(row);
            added += 1;
        }
        if (!added) break;
        if (options.delayMs && page < maxPages) await sleep(options.delayMs);
    }
    return rows;
}

function readBookIdsFromReport(reportPath) {
    if (!reportPath) return [];
    const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const items = Array.isArray(data)
        ? data
        : data.needs_source_catalog || data.repaired || data.anomalies?.items || data.items || [];
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
                       COALESCE(NULLIF(TRIM(m.platform), ''), 'po18') platform,
                       m.detail_url
                FROM book_metadata m
                ${whereSql}
                ORDER BY m.book_id, COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
            )
            SELECT metadata.book_id,
                   metadata.platform,
                   metadata.detail_url,
                   COUNT(c.id)::int chapter_count
            FROM metadata
            JOIN chapter_cache c ON c.book_id = metadata.book_id
            GROUP BY metadata.book_id, metadata.platform, metadata.detail_url
            ORDER BY COUNT(c.id) DESC, metadata.book_id ASC
            ${limit ? `LIMIT ${limit}` : ""}`,
            params
        )
    ).rows;
}

function analyzeCatalogOrder(rows = [], catalog = [], options = {}) {
    const minMatchRatio = options.minMatchRatio ?? 0.95;
    const orderMap = new Map();
    const sourceOrderCounts = new Map();
    for (let index = 0; index < catalog.length; index += 1) {
        const row = catalog[index];
        const sourceOrder = Number(row.source_order || 0);
        const fallbackOrder = Number(row.fallback_order || index + 1);
        if (sourceOrder > 0) sourceOrderCounts.set(sourceOrder, (sourceOrderCounts.get(sourceOrder) || 0) + 1);
        orderMap.set(String(row.chapter_id), {
            sourceOrder: sourceOrder > 0 ? sourceOrder : null,
            fallbackOrder
        });
    }
    let duplicateSourceOrders = 0;
    for (const count of sourceOrderCounts.values()) {
        if (count > 1) duplicateSourceOrders += count - 1;
    }
    const compareCatalog = (a, b) => {
        const ao = orderMap.get(String(a.chapter_id)) || {};
        const bo = orderMap.get(String(b.chapter_id)) || {};
        const av = ao.sourceOrder ?? ao.fallbackOrder ?? Number.MAX_SAFE_INTEGER;
        const bv = bo.sourceOrder ?? bo.fallbackOrder ?? Number.MAX_SAFE_INTEGER;
        if (av !== bv) return av - bv;
        if ((ao.fallbackOrder || 0) !== (bo.fallbackOrder || 0)) return (ao.fallbackOrder || 0) - (bo.fallbackOrder || 0);
        return Number(a.id) - Number(b.id);
    };
    const matched = rows.filter((row) => orderMap.has(String(row.chapter_id)));
    const unmatched = rows.filter((row) => !orderMap.has(String(row.chapter_id)));
    const sorted = [
        ...matched.sort(compareCatalog),
        ...unmatched.sort((a, b) => Number(a.chapter_order || 0) - Number(b.chapter_order || 0) || Number(a.id) - Number(b.id))
    ];
    const desired = new Map(sorted.map((row, index) => [Number(row.id), index + 1]));
    let changes = 0;
    for (const row of rows) {
        if (Number(row.chapter_order || 0) !== desired.get(Number(row.id))) changes += 1;
    }
    const matchRatio = rows.length ? matched.length / rows.length : 0;
    return {
        sorted,
        desired,
        changes,
        matched: matched.length,
        unmatched: unmatched.length,
        catalogCount: catalog.length,
        catalogWithSourceOrder: catalog.filter((row) => Number(row.source_order || 0) > 0).length,
        duplicateSourceOrders,
        matchRatio,
        usable: rows.length > 0 && matched.length > 0 && matchRatio >= minMatchRatio
    };
}

async function applyBook(client, book, analysis) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`repair_chapter_order_catalog:${book.book_id}`]);
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
    const explicitBookIds = argList("--book-ids");
    const outputPath = argValue("--output").trim() || "chapter-order-source-catalog-repair.json";
    const cookie = readCookie();
    const maxPages = Math.max(1, Number.parseInt(argValue("--max-pages") || "50", 10) || 50);
    const minMatchRatio = Math.min(1, Math.max(0, Number.parseFloat(argValue("--min-match-ratio") || "0.95") || 0.95));
    const retries = Math.max(0, Number.parseInt(argValue("--retries") || "2", 10) || 2);
    const timeoutMs = Math.max(1000, Number.parseInt(argValue("--timeout-ms") || "20000", 10) || 20000);
    const delayMs = Math.max(0, Number.parseInt(argValue("--delay-ms") || "350", 10) || 350);
    const limit = Math.max(0, Number.parseInt(argValue("--limit") || "0", 10) || 0);
    const bookIds = [...new Set([...(bookId ? [bookId] : []), ...explicitBookIds, ...readBookIdsFromReport(reportPath)])];
    if (!bookIds.length && !limit) {
        throw new Error("请提供 --from-report、--book-id 或 --limit");
    }

    const books = (await findBooks(bookIds, limit)).filter((book) => !shouldSkip(book.platform));
    const totals = {
        scannedBooks: books.length,
        catalogUsableBooks: 0,
        needsManualBooks: 0,
        changedBooks: 0,
        changedChapters: 0,
        totalChapters: 0
    };
    const repaired = [];
    const needsManual = [];
    const samples = [];
    const client = await pool.connect();
    try {
        progress(`开始：模式=${apply ? "实际写入" : "预览"}，待处理 ${books.length} 本。${cookie ? "已启用原站 Cookie。" : "未提供原站 Cookie。"}`);
        if (apply) await client.query("BEGIN");
        for (let index = 0; index < books.length; index += 1) {
            const book = books[index];
            const rows = (
                await client.query(
                    `SELECT id, book_id, chapter_id, chapter_order, title
                     FROM chapter_cache
                     WHERE book_id = $1`,
                    [book.book_id]
                )
            ).rows;
            totals.totalChapters += rows.length;
            let catalog = [];
            let fetchError = "";
            try {
                if (platformKey(book.platform) === "po18") {
                    progress(`[${index + 1}/${books.length}] 书号 ${book.book_id}：正在访问 PO18 原站目录...`);
                    catalog = await fetchPo18Catalog(book, { cookie, maxPages, retries, timeoutMs, delayMs });
                }
            } catch (err) {
                fetchError = err.message;
            }
            const analysis = analyzeCatalogOrder(rows, catalog, { minMatchRatio });
            const summary = {
                book_id: book.book_id,
                platform: book.platform,
                chapters: rows.length,
                catalog_chapters: analysis.catalogCount,
                catalog_with_l_counter: analysis.catalogWithSourceOrder,
                duplicate_l_counter: analysis.duplicateSourceOrders,
                matched_chapters: analysis.matched,
                unmatched_chapters: analysis.unmatched,
                match_ratio: Number(analysis.matchRatio.toFixed(4)),
                changes: analysis.changes,
                strategy: analysis.usable ? "source_catalog" : "manual",
                reason: fetchError || (analysis.usable ? "source_catalog" : "low_catalog_match")
            };
            if (analysis.usable) {
                totals.catalogUsableBooks += 1;
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
                            source_order:
                                catalog.find((item) => String(item.chapter_id) === String(row.chapter_id))?.source_order || null,
                            title: row.title || ""
                        }))
                    });
                }
            } else {
                totals.needsManualBooks += 1;
                needsManual.push(summary);
            }
            const status = analysis.usable
                ? analysis.changes
                    ? `${apply ? "已修复" : "需修复"} ${analysis.changes} 章`
                    : "无需修改"
                : analysis.changes
                  ? `未写库，预计变动 ${analysis.changes} 章`
                  : "未写库";
            const matchText = fetchError
                ? `访问失败：${fetchError}`
                : `目录匹配 ${summary.matched_chapters}/${rows.length}，原站目录 ${summary.catalog_chapters} 章，l_counter ${summary.catalog_with_l_counter} 个`;
            const next = analysis.usable ? "原站目录可用" : "仍需人工检查";
            progress(`[${index + 1}/${books.length}] 书号 ${book.book_id}，平台 ${book.platform}，共 ${rows.length} 章，${status}；${matchText}；${next}。`);
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
        needs_manual: needsManual,
        samples
    };
    const reportFile = writeJsonReport(outputPath, output);
    progress(`报告已写入：${reportFile}`);
    progress(`完成：处理 ${totals.scannedBooks} 本，原站目录可修 ${totals.catalogUsableBooks} 本，需人工 ${totals.needsManualBooks} 本，${apply ? "已修复" : "预览需修复"} ${totals.changedBooks} 本 / ${totals.changedChapters} 章。`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
