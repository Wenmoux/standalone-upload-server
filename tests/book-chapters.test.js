/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供章节读取、写入、顺序与缓存行为的自动化回归断言
 * [POS]: tests 的章节读取、写入、顺序与缓存行为守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBookChapterService } = require("../services/book-chapters");

function makeService(overrides = {}) {
    const calls = [];
    const client = {
        async query(sql, params = []) {
            calls.push({ client: true, sql, params });
            if (/SELECT chapter_order/.test(sql)) return { rows: [] };
            if (/MAX\(chapter_order\)/.test(sql)) return { rows: [{ max_order: 4 }] };
            return { rows: [] };
        },
        release() {
            calls.push({ release: true });
        }
    };
    const service = createBookChapterService({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [] };
        },
        pool: { connect: async () => client },
        pick: (data, columns) => {
            const result = {};
            for (const key of columns) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
            return result;
        },
        bookColumns: ["book_id", "platform", "title", "updated_at", "uploader", "uploaderId", "detail_url"],
        chapterColumns: ["book_id", "chapter_id", "title", "html", "text", "chapter_order", "platform", "uploader", "uploaderId", "is_volume", "updated_at"],
        cleanPgText: (value) => String(value || "").trim(),
        cleanPgObject: (data) => data,
        col: (name) => name === "uploaderId" ? '"uploaderId"' : name,
        normalizeBook: (book) => ({
            book_id: String(book.book_id || book.bookId),
            platform: book.platform || "po18",
            title: book.title || "",
            updated_at: "now",
            uploader: book.uploader || "bot",
            uploaderId: book.uploaderId || "42",
            detail_url: book.detail_url || ""
        }),
        bookUpsertAssignment: (key) => `${key} = EXCLUDED.${key}`,
        shouldNormalizeChapterOrder: () => true,
        parseChapterOrderFromTitle: () => 0,
        safePgInt: (value, fallback = 0) => Number(value || fallback || 0),
        safePgBool: (value) => !!value,
        nowSql: () => "now",
        recordEvent: async (event) => {
            calls.push({ event });
            return { id: 1, ...event };
        },
        notifyTelegram: async (event) => {
            calls.push({ notify: event.eventType });
        },
        textFromHtml: (html) => String(html || "").replace(/<[^>]+>/g, ""),
        logger: { warn: () => {} },
        ...overrides
    });
    return { service, calls };
}

test("book chapter service upserts book metadata and records event", async () => {
    const { service, calls } = makeService({
        bookColumns: ["book_id", "platform", "title", "category", "chapter_count", "description_html", "updated_at", "uploader", "uploaderId", "detail_url"]
    });

    await service.upsertBook({
        book_id: "b1",
        title: "Book",
        category: "言情，都市",
        categories: ["都市", "玄幻"],
        chapter_count: 12,
        description_html: "<p>Intro</p>"
    });

    const insert = calls.find((call) => /INSERT INTO book_metadata/.test(call.sql || ""));
    assert.ok(insert);
    assert.match(insert.sql, /category/);
    assert.match(insert.sql, /chapter_count/);
    assert.match(insert.sql, /description_html/);
    assert.ok(insert.params.includes("言情，都市，玄幻"));
    assert.ok(insert.params.includes(12));
    assert.ok(insert.params.includes("<p>Intro</p>"));
    assert.ok(calls.some((call) => call.event?.eventType === "metadata" && call.event.bookId === "b1"));
    assert.ok(calls.some((call) => call.notify === "metadata"));
});

test("book metadata upsert keeps timestamp columns typed and accepts the unchanged qidian payload", async () => {
    const { service, calls } = makeService({
        bookColumns: [
            "book_id",
            "platform",
            "title",
            "latest_chapter_date",
            "source_updated_at",
            "catalog_updated_at",
            "metadata_cached_at",
            "updated_at"
        ]
    });

    await service.upsertBook({
        bookId: "1047414337",
        title: "顶流手记",
        platform: "qidian",
        latestChapterDate: "2026-07-12 07:10:00",
        sourceUpdatedAt: "",
        catalogUpdatedAt: ""
    });

    const insert = calls.find((call) => /INSERT INTO book_metadata/.test(call.sql || ""));
    assert.ok(insert);
    assert.ok(insert.params.includes("2026-07-12 07:10:00"));
    assert.equal(insert.params.filter((value) => value === null).length, 2);
    assert.match(insert.sql, /latest_chapter_date = COALESCE\(EXCLUDED\.latest_chapter_date, book_metadata\.latest_chapter_date\)/);
    assert.doesNotMatch(insert.sql, /NULLIF\(EXCLUDED\.(?:latest_chapter_date|source_updated_at|catalog_updated_at|metadata_cached_at), ''\)/);
});

test("book chapter service sorts books by cache completeness", () => {
    const { service } = makeService();

    const desc = service.bookOrder("complete_desc", "m", "bs");
    const asc = service.bookOrder("complete_asc", "m", "bs");

    assert.match(desc, /bs\.cache_count/);
    assert.match(desc, /total_chapters/);
    assert.match(desc, /DESC/);
    assert.match(asc, /ASC/);
    assert.equal(service.isCacheCountSort("complete_desc"), true);
});

test("book chapter service saves chapter in a transaction and records event", async () => {
    const { service, calls } = makeService();

    await service.saveChapter({ bookId: "b1", chapterId: "c1", title: "Chapter", html: "<p>Hello</p>" });

    assert.ok(calls.some((call) => call.client && call.sql === "BEGIN"));
    assert.ok(calls.some((call) => /INSERT INTO chapter_cache/.test(call.sql || "")));
    assert.ok(calls.some((call) => call.client && call.sql === "COMMIT"));
    assert.ok(calls.some((call) => call.release));
    assert.ok(calls.some((call) => call.event?.eventType === "chapter" && call.event.chapterId === "c1"));
});

test("book chapter service cleans confirmed bracket notes on save", async () => {
    const { service, calls } = makeService();

    await service.saveChapter({ bookId: "b1", chapterId: "c1", title: "第1章 开始（求月票）", html: "<p>Hello</p>" });

    const insert = calls.find((call) => /INSERT INTO chapter_cache/.test(call.sql || ""));
    assert.ok(insert);
    assert.ok(insert.params.includes("第1章 开始"));
    assert.equal(insert.params.includes("第1章 开始（求月票）"), false);
});

test("book chapter service keeps unconfirmed bracket notes on save", async () => {
    const { service, calls } = makeService();

    await service.saveChapter({ bookId: "b1", chapterId: "c1", title: "第1章 开始（上）", html: "<p>Hello</p>" });

    const insert = calls.find((call) => /INSERT INTO chapter_cache/.test(call.sql || ""));
    assert.ok(insert);
    assert.ok(insert.params.includes("第1章 开始（上）"));
});

test("book chapter service does not renumber PO18 displayed chapter orders", async () => {
    const { service, calls } = makeService({
        pool: {
            connect: async () => ({
                async query(sql, params = []) {
                    calls.push({ client: true, sql, params });
                    if (/SELECT chapter_order/.test(sql)) return { rows: [] };
                    if (/SELECT 1 FROM chapter_cache/.test(sql)) return { rows: [{ exists: true }] };
                    return { rows: [] };
                },
                release() {
                    calls.push({ release: true });
                }
            })
        }
    });

    await service.saveChapter({ bookId: "b1", chapterId: "9004", title: "Chapter 4", html: "<p>Hello</p>", chapterOrder: 4, platform: "po18" });

    assert.equal(calls.some((call) => /SET chapter_order = -/.test(call.sql || "")), false);
    const insert = calls.find((call) => /INSERT INTO chapter_cache/.test(call.sql || ""));
    assert.ok(insert);
    assert.ok(insert.params.includes(4));
});

test("book chapter service lets PO18 userscript upload correct existing chapter order", async () => {
    const { service, calls } = makeService({
        pool: {
            connect: async () => ({
                async query(sql, params = []) {
                    calls.push({ client: true, sql, params });
                    if (/SELECT chapter_order/.test(sql)) return { rows: [{ chapter_order: 3 }] };
                    return { rows: [] };
                },
                release() {
                    calls.push({ release: true });
                }
            })
        }
    });

    await service.saveChapter({
        bookId: "b1",
        chapterId: "9004",
        title: "Chapter 4",
        html: "<p>Hello</p>",
        chapterOrder: 4,
        platform: "po18",
        fromUserScript: true
    });

    const insert = calls.find((call) => /INSERT INTO chapter_cache/.test(call.sql || ""));
    assert.ok(insert);
    assert.ok(insert.params.includes(4));
    assert.equal(calls.some((call) => /SET chapter_order = -/.test(call.sql || "")), false);
});

test("book chapter service updates qidian order-only without replacing content", async () => {
    const { service, calls } = makeService({
        pool: {
            connect: async () => ({
                async query(sql, params = []) {
                    calls.push({ client: true, sql, params });
                    if (/SELECT chapter_order/.test(sql)) return { rows: [{ chapter_order: 8 }] };
                    return { rows: [] };
                },
                release() {
                    calls.push({ release: true });
                }
            })
        }
    });

    const result = await service.saveChapter({
        bookId: "b1",
        chapterId: "9004",
        title: "Changed title should be ignored",
        html: "",
        chapterOrder: 12,
        platform: "qidian",
        fromUserScript: true,
        orderOnly: true,
        updateOrderOnly: true,
        skipContentUpdate: true
    });

    assert.equal(result.orderOnly, true);
    assert.equal(result.updated, true);
    assert.equal(calls.some((call) => /INSERT INTO chapter_cache/.test(call.sql || "")), false);
    const update = calls.find((call) => /UPDATE chapter_cache SET chapter_order/.test(call.sql || ""));
    assert.ok(update);
    assert.deepEqual(update.params, [12, "qidian", "b1", "9004"]);
    assert.ok(calls.some((call) => call.event?.action === "order-only" && call.event.details.contentUpdated === false));
});

test("book chapter service does not apply order-only shortcut to PO18", async () => {
    const { service, calls } = makeService({
        pool: {
            connect: async () => ({
                async query(sql, params = []) {
                    calls.push({ client: true, sql, params });
                    if (/SELECT chapter_order/.test(sql)) return { rows: [{ chapter_order: 8 }] };
                    return { rows: [] };
                },
                release() {
                    calls.push({ release: true });
                }
            })
        }
    });

    const result = await service.saveChapter({
        bookId: "b1",
        chapterId: "9004",
        title: "PO18 title",
        html: "<p>content</p>",
        chapterOrder: 12,
        platform: "po18",
        fromUserScript: true,
        orderOnly: true,
        skipContentUpdate: true
    });

    assert.equal(result.orderOnly, false);
    assert.ok(calls.some((call) => /INSERT INTO chapter_cache/.test(call.sql || "")));
    assert.equal(calls.some((call) => /UPDATE chapter_cache SET chapter_order/.test(call.sql || "")), false);
});
