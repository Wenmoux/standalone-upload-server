const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const { createUploadApiRoutes } = require("../routes/upload-api");

async function withApp(router, fn) {
    const app = express();
    app.use(express.json());
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

function uploadOnly(req, res, next) {
    if (req.get("X-Upload-Token") !== "upload-token") return res.status(401).json({ error: "upload token required" });
    next();
}

function baseDeps(overrides = {}) {
    return {
        requireUploadApi: uploadOnly,
        query: async () => ({ rows: [] }),
        saveChapter: async () => {},
        safePgBool: (value, fallback = false) => {
            if (value === undefined || value === null || value === "") return fallback;
            return value === true || value === "true" || value === 1 || value === "1";
        },
        cleanPgText: (value) => (value == null ? "" : String(value).trim()),
        chapterText: (row = {}) => row.text || String(row.html || "").replace(/<[^>]+>/g, ""),
        upsertBook: async () => {},
        isPgConnectionError: () => false,
        chapterListOrderSql: () => "chapter_id ASC",
        recordEvent: async () => {},
        ...overrides
    };
}

test("upload API protects write routes and returns cached chapter content", async () => {
    const calls = [];
    const router = createUploadApiRoutes(baseDeps({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ html: "<p>Hello</p>", text: "Hello", title: "Chapter 1" }] };
        }
    }));

    await withApp(router, async (base) => {
        const getResponse = await fetch(`${base}/api/parse/chapter-content`);
        assert.equal(getResponse.status, 405);

        const blocked = await fetch(`${base}/api/parse/chapter-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId: "b1", chapterId: "c1" })
        });
        assert.equal(blocked.status, 401);

        const response = await fetch(`${base}/api/parse/chapter-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Upload-Token": "upload-token" },
            body: JSON.stringify({ bookId: " b1 ", chapterId: " c1 " })
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            html: "<p>Hello</p>",
            text: "Hello",
            title: "Chapter 1",
            fromCache: true
        });
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, ["b1", "c1"]);
});

test("upload API accepts userscript chapter upload without cache lookup", async () => {
    const saved = [];
    let queries = 0;
    const router = createUploadApiRoutes(baseDeps({
        query: async () => {
            queries++;
            return { rows: [] };
        },
        saveChapter: async (payload) => saved.push(payload)
    }));

    await withApp(router, async (base) => {
        const response = await fetch(`${base}/api/parse/chapter-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Upload-Token": "upload-token" },
            body: JSON.stringify({ bookId: "b1", chapterId: "c1", html: "<p>New</p>", title: " New ", fromUserScript: true })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.uploaded, true);
        assert.equal(body.title, "New");
        assert.equal(body.text, "New");
    });

    assert.equal(saved.length, 1);
    assert.equal(queries, 0);
});

test("upload API batches metadata and stops on database connection errors", async () => {
    const seen = [];
    const router = createUploadApiRoutes(baseDeps({
        upsertBook: async (book) => {
            seen.push(book.bookId || book.book_id);
            if (book.bookId === "db-down") throw new Error("connection lost");
        },
        isPgConnectionError: (err) => /connection/.test(err.message)
    }));

    await withApp(router, async (base) => {
        const invalid = await fetch(`${base}/api/metadata/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Upload-Token": "upload-token" },
            body: JSON.stringify({ books: "bad" })
        });
        assert.equal(invalid.status, 400);

        const response = await fetch(`${base}/api/metadata/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Upload-Token": "upload-token" },
            body: JSON.stringify({ books: [{ bookId: "ok" }, {}, { bookId: "db-down" }, { bookId: "skipped" }] })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.stats, {
            success: 1,
            failed: 2,
            errors: ["unknown: Missing bookId", "db-down: connection lost"]
        });
    });

    assert.deepEqual(seen, ["ok", "db-down"]);
});

test("upload API checks cache and deletes book chapters", async () => {
    const events = [];
    const router = createUploadApiRoutes(baseDeps({
        query: async (sql, params) => {
            if (/SELECT chapter_id/.test(sql)) {
                assert.deepEqual(params, ["b1"]);
                assert.match(sql, /ORDER BY chapter_id ASC/);
                return { rows: [{ chapter_id: 2 }, { chapter_id: "10" }] };
            }
            if (/DELETE FROM chapter_cache/.test(sql)) {
                assert.deepEqual(params, ["b1"]);
                return { rows: [], rowCount: 12 };
            }
            return { rows: [] };
        },
        recordEvent: async (event) => events.push(event)
    }));

    await withApp(router, async (base) => {
        const cache = await fetch(`${base}/api/parse/check-cache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookId: "b1" })
        });
        assert.equal(cache.status, 200);
        assert.deepEqual(await cache.json(), {
            cached: true,
            chapterIds: ["2", "10"],
            cachedChapters: ["2", "10"]
        });

        const deleted = await fetch(`${base}/api/chapters/b1`, {
            method: "DELETE",
            headers: { "X-Upload-Token": "upload-token" }
        });
        assert.equal(deleted.status, 200);
        assert.deepEqual(await deleted.json(), { success: true, deleted: 12 });
    });

    assert.deepEqual(events, [{
        eventType: "chapter",
        action: "delete_book_chapters",
        bookId: "b1",
        source: "api",
        details: { changes: 12 }
    }]);
});
