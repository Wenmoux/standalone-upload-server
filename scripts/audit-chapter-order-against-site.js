const fs = require("fs");
const path = require("path");
const { pool, query } = require("../pg-store");

const DEFAULT_OUTPUT = "chapter-order-site-audit.json";
const DEFAULT_PROGRESS = "chapter-order-site-audit.jsonl";
const DEFAULT_SUPPORTED = new Set(["po18"]);

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

function platformKey(value = "") {
    return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function readCookie() {
    const direct = argValue("--cookie").trim();
    if (direct) return direct;
    const cookieFile = argValue("--cookie-file").trim();
    if (cookieFile) return fs.readFileSync(path.resolve(cookieFile), "utf8").trim();
    return String(process.env.PO18_CATALOG_COOKIE || process.env.PO18_COOKIE || "").trim();
}

function progress(message) {
    process.stderr.write(`[网站目录对比] ${message}\n`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function lastCounterIn(value = "") {
    const re = /<[^>]*class=["'][^"']*\bl_counter\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let found = null;
    for (const match of value.matchAll(re)) {
        const number = Number.parseInt((cleanText(match[1]).match(/\d{1,8}/) || [])[0] || "", 10);
        if (Number.isFinite(number)) found = number;
    }
    return found;
}

function firstCounterIn(value = "") {
    const match = value.match(/<[^>]*class=["'][^"']*\bl_counter\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (!match) return null;
    const number = Number.parseInt((cleanText(match[1]).match(/\d{1,8}/) || [])[0] || "", 10);
    return Number.isFinite(number) ? number : null;
}

async function fetchText(url, options = {}) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...options.headers
    };
    const cookie = String(options.cookie || "").trim();
    if (cookie) headers.Cookie = cookie;
    const retries = Math.max(0, Number(options.retries || 0));
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 20000));
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { headers, redirect: "manual", signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok && response.status !== 302) throw new Error(`HTTP ${response.status}`);
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

function parsePopoCatalog(html = "", bookId = "") {
    const rows = [];
    const seen = new Set();
    const escaped = String(bookId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<a[^>]*href=["'][^"']*/books/${escaped}/articles/(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi");
    for (const match of html.matchAll(re)) {
        const title = cleanText(match[2]);
        if (!title || /免費閱讀|付費閱讀|訂購|阅读|購買/.test(title)) continue;
        if (seen.has(match[1])) continue;
        seen.add(match[1]);
        rows.push({
            chapter_id: match[1],
            title,
            source_order: rows.length + 1,
            fallback_order: rows.length + 1
        });
    }
    return rows;
}

function catalogBase(book = {}) {
    const bookId = String(book.book_id || "").trim();
    const platform = platformKey(book.platform);
    const detailUrl = String(book.detail_url || "").trim();
    if (platform === "po18") {
        let base = detailUrl || `https://www.po18.tw/books/${bookId}/articles`;
        if (new RegExp(`/books/${bookId}/?$`).test(base)) base = `${base.replace(/\/+$/, "")}/articles`;
        return base.replace(/\/+$/, "");
    }
    if (platform === "popo") {
        let base = detailUrl || `https://www.popo.tw/books/${bookId}/articles`;
        if (new RegExp(`/books/${bookId}/?$`).test(base)) base = `${base.replace(/\/+$/, "")}/articles`;
        return base.replace(/\/+$/, "");
    }
    return detailUrl;
}

function pageUrl(base, page) {
    return `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
}

async function fetchCatalog(book = {}, options = {}) {
    const platform = platformKey(book.platform);
    const maxPages = Math.max(1, Number(options.maxPages || 50));
    const base = catalogBase(book);
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
        const html = await fetchText(pageUrl(base, page), options);
        const pageRows =
            platform === "po18"
                ? parsePo18Catalog(html, book.book_id)
                : platform === "popo"
                  ? parsePopoCatalog(html, book.book_id)
                  : [];
        if (!pageRows.length) break;
        let added = 0;
        for (const row of pageRows) {
            if (seen.has(row.chapter_id)) continue;
            seen.add(row.chapter_id);
            rows.push({ ...row, fallback_order: rows.length + 1 });
            added += 1;
        }
        if (!added) break;
        if (options.delayMs && page < maxPages) await sleep(options.delayMs);
    }
    return rows;
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
    const usable = rows.length > 0 && matched.length > 0 && matchRatio >= minMatchRatio;
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
        usable
    };
}

async function findBooks(options = {}) {
    const params = [];
    const where = [];
    const bookIds = options.bookIds || [];
    const platforms = options.platforms || [];
    if (bookIds.length) {
        params.push(bookIds);
        where.push(`m.book_id = ANY($${params.length})`);
    }
    if (platforms.length) {
        params.push(platforms.map(platformKey));
        where.push(`lower(regexp_replace(COALESCE(m.platform, ''), '[\\s_-]+', '', 'g')) = ANY($${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(0, Number(options.limit || 0));
    return (
        await query(
            `WITH metadata AS (
                SELECT DISTINCT ON (m.book_id)
                       m.book_id,
                       m.title,
                       COALESCE(NULLIF(TRIM(m.platform), ''), 'po18') platform,
                       m.detail_url
                FROM book_metadata m
                ${whereSql}
                ORDER BY m.book_id, COALESCE(m.subscribed_chapters, 0) DESC, COALESCE(m.updated_at, m.created_at) DESC, m.id DESC
            )
            SELECT metadata.book_id,
                   metadata.title,
                   metadata.platform,
                   metadata.detail_url,
                   COUNT(c.id)::int chapter_count
            FROM metadata
            JOIN chapter_cache c ON c.book_id = metadata.book_id
            GROUP BY metadata.book_id, metadata.title, metadata.platform, metadata.detail_url
            ORDER BY metadata.platform ASC, COUNT(c.id) DESC, metadata.book_id ASC
            ${limit ? `LIMIT ${limit}` : ""}`,
            params
        )
    ).rows;
}

async function chaptersForBook(client, bookId) {
    return (
        await client.query(
            `SELECT id, book_id, chapter_id, chapter_order, title
             FROM chapter_cache
             WHERE book_id = $1`,
            [bookId]
        )
    ).rows;
}

async function applyBook(client, item) {
    const rows = await chaptersForBook(client, item.book_id);
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const sorted = [];
    for (const id of item.ordered_row_ids || []) {
        const row = byId.get(String(id));
        if (row) sorted.push(row);
    }
    if (sorted.length !== rows.length) {
        throw new Error(`ordered_row_ids 不完整：${item.book_id} ${sorted.length}/${rows.length}`);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`audit_site_order:${item.book_id}`]);
    const values = sorted.map((row, index) => `(${Number(row.id)}, ${index + 1})`).join(",");
    if (!values) return 0;
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
        [item.book_id]
    );
    return Number(item.changes || 0);
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function appendJsonl(filePath, row) {
    ensureDir(filePath);
    fs.appendFileSync(path.resolve(filePath), `${JSON.stringify(row)}\n`);
}

function writeJson(filePath, data) {
    ensureDir(filePath);
    fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(data, null, 2)}\n`);
    return path.resolve(filePath);
}

function safeSummary(book, rows, catalog, analysis, extra = {}) {
    return {
        book_id: book.book_id,
        title: book.title || "",
        platform: book.platform,
        detail_url: book.detail_url || "",
        chapters: rows.length,
        catalog_chapters: analysis.catalogCount,
        catalog_with_source_order: analysis.catalogWithSourceOrder,
        matched_chapters: analysis.matched,
        unmatched_chapters: analysis.unmatched,
        match_ratio: Number(analysis.matchRatio.toFixed(4)),
        duplicate_source_order: analysis.duplicateSourceOrders,
        changes: analysis.changes,
        ...extra
    };
}

async function runAudit() {
    const outputPath = argValue("--output").trim() || DEFAULT_OUTPUT;
    const progressPath = argValue("--progress").trim() || DEFAULT_PROGRESS;
    const cookie = readCookie();
    const platforms = argList("--platforms");
    const bookIds = [...new Set([...argList("--book-ids"), ...(argValue("--book-id").trim() ? [argValue("--book-id").trim()] : [])])];
    const limit = Math.max(0, Number.parseInt(argValue("--limit") || "0", 10) || 0);
    const maxPages = Math.max(1, Number.parseInt(argValue("--max-pages") || "80", 10) || 80);
    const retries = Math.max(0, Number.parseInt(argValue("--retries") || "2", 10) || 2);
    const timeoutMs = Math.max(1000, Number.parseInt(argValue("--timeout-ms") || "30000", 10) || 30000);
    const delayMs = Math.max(0, Number.parseInt(argValue("--delay-ms") || "600", 10) || 600);
    const minMatchRatio = Math.min(1, Math.max(0, Number.parseFloat(argValue("--min-match-ratio") || "0.95") || 0.95));
    const allowPlatforms = new Set(argList("--allow-platforms").map(platformKey));
    if (!allowPlatforms.size) for (const platform of DEFAULT_SUPPORTED) allowPlatforms.add(platform);

    const books = await findBooks({ bookIds, platforms, limit });
    const totals = {
        scannedBooks: books.length,
        sameBooks: 0,
        changeBooks: 0,
        reviewBooks: 0,
        unsupportedBooks: 0,
        changedChapters: 0,
        totalChapters: 0
    };
    const same = [];
    const changes = [];
    const review = [];
    const client = await pool.connect();
    try {
        progress(`开始：对比 ${books.length} 本，自动认可平台=${[...allowPlatforms].join(",")}，${cookie ? "已启用 Cookie" : "未提供 Cookie"}。`);
        for (let index = 0; index < books.length; index += 1) {
            const book = books[index];
            const platform = platformKey(book.platform);
            const rows = await chaptersForBook(client, book.book_id);
            totals.totalChapters += rows.length;
            if (!allowPlatforms.has(platform)) {
                const item = safeSummary(book, rows, [], {
                    catalogCount: 0,
                    catalogWithSourceOrder: 0,
                    matched: 0,
                    unmatched: rows.length,
                    matchRatio: 0,
                    duplicateSourceOrders: 0,
                    changes: 0
                }, { status: "unsupported", reason: "unsupported_platform" });
                totals.unsupportedBooks += 1;
                totals.reviewBooks += 1;
                review.push(item);
                appendJsonl(progressPath, item);
                progress(`[${index + 1}/${books.length}] ${book.book_id} ${book.platform}：暂不支持，跳过。`);
                continue;
            }
            let catalog = [];
            let fetchError = "";
            try {
                catalog = await fetchCatalog(book, { cookie, maxPages, retries, timeoutMs, delayMs });
            } catch (err) {
                fetchError = err.message || String(err);
            }
            const analysis = analyzeCatalogOrder(rows, catalog, { minMatchRatio });
            let status = "review";
            let reason = fetchError || (analysis.usable ? "site_catalog" : "low_catalog_match");
            if (analysis.usable && analysis.changes === 0) {
                status = "same";
                reason = "already_same";
                totals.sameBooks += 1;
            } else if (analysis.usable && analysis.changes > 0) {
                status = "change";
                totals.changeBooks += 1;
                totals.changedChapters += analysis.changes;
            } else {
                totals.reviewBooks += 1;
            }
            const item = safeSummary(book, rows, catalog, analysis, {
                status,
                reason,
                ordered_row_ids: status === "change" ? analysis.sorted.map((row) => Number(row.id)) : undefined,
                preview: analysis.sorted.slice(0, 10).map((row, previewIndex) => ({
                    row_id: Number(row.id),
                    chapter_id: row.chapter_id,
                    old_order: Number(row.chapter_order || 0),
                    new_order: previewIndex + 1,
                    title: row.title || ""
                }))
            });
            if (status === "same") same.push(item);
            else if (status === "change") changes.push(item);
            else review.push(item);
            appendJsonl(progressPath, item);
            progress(
                `[${index + 1}/${books.length}] ${book.book_id} ${book.platform}：${status}，匹配 ${item.matched_chapters}/${item.chapters}，待改 ${item.changes} 章。`
            );
        }
    } finally {
        client.release();
    }
    const output = {
        mode: "audit",
        generated_at: new Date().toISOString(),
        options: {
            min_match_ratio: minMatchRatio,
            max_pages: maxPages,
            allow_platforms: [...allowPlatforms]
        },
        totals,
        changes,
        same,
        review
    };
    const file = writeJson(outputPath, output);
    progress(`报告已写入：${file}`);
    progress(`完成：扫描 ${totals.scannedBooks} 本，一致 ${totals.sameBooks} 本，需确认修改 ${totals.changeBooks} 本 / ${totals.changedChapters} 章，需人工复核 ${totals.reviewBooks} 本。`);
}

async function runApplyFromReport() {
    const reportPath = argValue("--apply-from-report").trim();
    if (!reportPath) throw new Error("请提供 --apply-from-report <report.json>");
    const outputPath = argValue("--output").trim() || "chapter-order-site-audit-apply.json";
    const onlyBookIds = new Set(argList("--book-ids"));
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const candidates = (report.changes || []).filter((item) => !onlyBookIds.size || onlyBookIds.has(String(item.book_id)));
    const applyAll = hasFlag("--yes") || hasFlag("--apply");
    if (!applyAll) {
        throw new Error("写库需要确认：追加 --yes。未写入任何数据。");
    }
    const totals = { targetBooks: candidates.length, changedBooks: 0, changedChapters: 0 };
    const applied = [];
    const skipped = [];
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const item of candidates) {
            if (!Array.isArray(item.ordered_row_ids) || !item.ordered_row_ids.length) {
                skipped.push({ book_id: item.book_id, reason: "missing_ordered_row_ids" });
                continue;
            }
            const changed = await applyBook(client, item);
            totals.changedBooks += 1;
            totals.changedChapters += changed;
            applied.push({ book_id: item.book_id, platform: item.platform, changes: changed });
            progress(`已写库：${item.book_id}，${changed} 章。`);
        }
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    const file = writeJson(outputPath, {
        mode: "apply",
        source_report: path.resolve(reportPath),
        generated_at: new Date().toISOString(),
        totals,
        applied,
        skipped
    });
    progress(`写库报告已写入：${file}`);
    progress(`完成：已处理 ${totals.changedBooks} 本 / ${totals.changedChapters} 章。`);
}

async function main() {
    if (argValue("--apply-from-report").trim()) await runApplyFromReport();
    else await runAudit();
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
