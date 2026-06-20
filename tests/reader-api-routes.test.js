const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createReaderApiRoutes } = require("../routes/reader-api");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = {};
        next();
    });
    app.use(router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function readerOnly(req, res, next) {
    if (req.get("X-Test-Reader") !== "1") return res.status(401).json({ error: "reader required" });
    req.session.readerUser = { id: 1, username: "reader" };
    next();
}

function baseDeps(overrides = {}) {
    return {
        query: async () => ({ rows: [] }),
        currentReaderUser: async () => ({ id: 1, username: "reader" }),
        publicReaderUser: (user) => user ? ({ id: user.id, username: user.username }) : null,
        requireReader: readerOnly,
        requireLibraryAccess: readerOnly,
        requireReaderContentAccess: readerOnly,
        getHotKeywords: async (limit) => [{ keyword: "alpha", limit }],
        platformConfigPayload: async () => ({ labels: { po18: "PO18" }, platforms: [] }),
        isCacheCountSort: () => false,
        bookOrder: () => "m.id DESC",
        logSlowSearch: () => {},
        slowSearchContext: () => ({}),
        chapterListOrderSql: () => "id ASC",
        chapterText: () => "",
        edgeTtsFallbackVoices: [{ name: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", gender: "Female" }],
        edgeTtsVoices: async () => {
            throw new Error("offline");
        },
        edgeTtsSynthesize: async () => Buffer.from("audio"),
        ttsProviderSettings: (req) => req.body || {},
        synthesizeVolcengineTts: async () => Buffer.from("volc"),
        synthesizeAliyunTts: async () => Buffer.from("ali"),
        synthesizeAzureTts: async () => Buffer.from("azure"),
        synthesizeElevenLabsTts: async () => Buffer.from("eleven"),
        synthesizeCartesiaTts: async () => Buffer.from("cartesia"),
        normalizeCorrectionText: (value = "") => String(value),
        correctionCharLength: (value = "") => Array.from(String(value)).length,
        ...overrides
    };
}

test("reader routes expose public auth and catalog helpers", async () => {
    const router = createReaderApiRoutes(baseDeps());

    await withApp(router, async (base) => {
        const me = await fetch(`${base}/reader-auth/me`);
        assert.deepEqual(await me.json(), { user: { id: 1, username: "reader" } });

        const hot = await fetch(`${base}/reader-api/hot-keywords?limit=2`);
        assert.deepEqual((await hot.json()).rows, [{ keyword: "alpha", limit: "2" }]);

        const platforms = await fetch(`${base}/reader-api/platforms`);
        assert.deepEqual(await platforms.json(), { labels: { po18: "PO18" }, platforms: [] });
    });
});

test("reader bookshelf status reports whether a book is shelved", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: params[1] === "b1" ? [{ exists: 1 }] : [] };
        }
    }));

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/reader-api/me/bookshelf/b1/status`);
        assert.equal(blocked.status, 401);

        const inShelf = await fetch(`${base}/reader-api/me/bookshelf/b1/status`, { headers: { "X-Test-Reader": "1" } });
        assert.equal(inShelf.status, 200);
        assert.deepEqual(await inShelf.json(), { inShelf: true });

        const missing = await fetch(`${base}/reader-api/me/bookshelf/b2/status`, { headers: { "X-Test-Reader": "1" } });
        assert.equal(missing.status, 200);
        assert.deepEqual(await missing.json(), { inShelf: false });
    });

    assert.match(calls[0].sql, /FROM reader_bookshelf/);
    assert.deepEqual(calls[0].params, [1, "b1"]);
});

test("reader bookshelf idsOnly returns a lean id list", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [{ book_id: "b1" }, { book_id: "b2" }] };
        }
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/me/bookshelf?idsOnly=1`, { headers: { "X-Test-Reader": "1" } });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { rows: [{ book_id: "b1" }, { book_id: "b2" }] });
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /^SELECT book_id FROM reader_bookshelf/);
    assert.doesNotMatch(calls[0].sql, /book_metadata/);
    assert.deepEqual(calls[0].params, [1]);
});

test("reader bookshelf list applies paging to the optimized shelf query", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [{ book_id: "b21", title: "Book 21" }] };
        }
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/me/bookshelf?count=20&page=2&order=shelved_time`, { headers: { "X-Test-Reader": "1" } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.page, 2);
        assert.equal(body.limit, 20);
        assert.equal(body.rows[0].book_id, "b21");
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /WITH shelf_rows AS/);
    assert.match(calls[0].sql, /metadata_rows AS/);
    assert.match(calls[0].sql, /LIMIT \$2 OFFSET \$3/);
    assert.deepEqual(calls[0].params, [1, 20, 20]);
});

test("reader routes keep tts endpoints protected and return edge voice fallback", async () => {
    const router = createReaderApiRoutes(baseDeps());

    await withApp(router, async (base) => {
        const blocked = await fetch(`${base}/reader-api/tts/edge/voices`);
        assert.equal(blocked.status, 401);

        const ok = await fetch(`${base}/reader-api/tts/edge/voices?locale=zh-CN`, { headers: { "X-Test-Reader": "1" } });
        const body = await ok.json();
        assert.equal(ok.status, 200);
        assert.equal(body.fallback, true);
        assert.equal(body.rows[0].name, "zh-CN-XiaoxiaoNeural");
    });
});

test("reader search suggestions combine metadata and hot keywords", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/UNION ALL/.test(sql)) {
                return {
                    rows: [
                        { type: "title", value: "Alpha Book", book_id: "b1", author: "Author A", platform: "po18", score: 99 },
                        { type: "author", value: "Alpha Writer", author: "Alpha Writer", platform: "po18", score: 2 },
                        { type: "tag", value: "AlphaTag", platform: "po18", score: 1 }
                    ]
                };
            }
            return { rows: [] };
        },
        getHotKeywords: async () => [{ keyword: "alpha hot", count: 4, result_count: 8 }]
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/search/suggest?q=alpha&platform=po18&limit=4`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.q, "alpha");
        assert.equal(body.platform, "po18");
        assert.deepEqual(body.rows.map((row) => `${row.type}:${row.value}`), [
            "title:Alpha Book",
            "author:Alpha Writer",
            "tag:AlphaTag",
            "hot:alpha hot"
        ]);
        assert.equal(body.rows[0].book_id, "b1");
    });

    assert.deepEqual(calls[0].params, ["po18", "%alpha%", 12]);
    assert.match(calls[0].sql, /platform = \$1/);
    assert.match(calls[0].sql, /title ILIKE \$2/);
});

test("reader search combines author tag and platform filters", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/COUNT/.test(sql)) return { rows: [{ count: 1 }] };
            return {
                rows: [
                    {
                        book_id: "b1",
                        title: "Filtered Book",
                        author: "Alpha Writer",
                        tags: "AlphaTag",
                        platform: "po18",
                        cache_count: 3
                    }
                ]
            };
        }
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/search?author=Alpha&tag=AlphaTag&platform=po18&limit=5&page=2`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.total, 1);
        assert.equal(body.page, 2);
        assert.equal(body.limit, 5);
        assert.equal(body.rows[0].book_id, "b1");
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, ["%Alpha%", "%AlphaTag%", "po18", 1]);
    assert.match(calls[0].sql, /m\.author ILIKE \$1/);
    assert.match(calls[0].sql, /m\.tags ILIKE \$2/);
    assert.match(calls[0].sql, /m\.platform = \$3/);
    assert.match(calls[0].sql, /COALESCE\(cc\.cache_count, 0\) >= \$4/);
    assert.deepEqual(calls[1].params, ["%Alpha%", "%AlphaTag%", "po18", 1, 5, 5]);
    assert.match(calls[1].sql, /m\.author ILIKE \$1/);
    assert.match(calls[1].sql, /m\.tags ILIKE \$2/);
    assert.match(calls[1].sql, /m\.platform = \$3/);
    assert.match(calls[1].sql, /COALESCE\(cc\.cache_count, 0\) >= \$4/);
});

test("reader search fast mode skips exact count and fetches one extra row", async () => {
    const calls = [];
    const router = createReaderApiRoutes(baseDeps({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return {
                rows: [
                    { book_id: "b4", title: "Alpha 4", cache_count: 1 },
                    { book_id: "b5", title: "Alpha 5", cache_count: 1 },
                    { book_id: "b6", title: "Alpha 6", cache_count: 1 },
                    { book_id: "b7", title: "Alpha 7", cache_count: 1 }
                ]
            };
        }
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/reader-api/search?keyword=Alpha&cache_min=1&sort=cache_desc&limit=3&page=2&fast=1`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.page, 2);
        assert.equal(body.limit, 3);
        assert.equal(body.total, 7);
        assert.equal(body.has_more, true);
        assert.equal(body.total_is_estimated, true);
        assert.deepEqual(body.rows.map((row) => row.book_id), ["b4", "b5", "b6"]);
    });

    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, /COUNT/);
    assert.match(calls[0].sql, /COALESCE\(cc\.cache_count, 0\) >= \$2/);
    assert.deepEqual(calls[0].params, ["%Alpha%", 1, 4, 3]);
});
