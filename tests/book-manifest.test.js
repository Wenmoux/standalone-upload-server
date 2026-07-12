/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供书籍清单导入导出、校验和及确认边界的自动化回归断言
 * [POS]: tests 的书籍清单导入导出、校验和及确认边界守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const http = require("http");
const test = require("node:test");
const express = require("express");
const {
    createBookManifestService,
    normalizeBook,
    signChapter,
    signManifest,
    validateBookManifest
} = require("../services/book-manifest");
const { createAdminManifestRoutes } = require("../routes/admin-manifests");

function sampleManifest() {
    const book = normalizeBook({
        book_id: "book-1",
        platform: "po18",
        title: "Test Book",
        author: "Author",
        chapter_count: 2,
        metadata_cached_at: "2026-07-11T00:00:00.000Z"
    });
    const chapters = [
        signChapter({ chapter_id: "c1", title: "One", html: "<p>one</p>", text: "one", chapter_order: 1, platform: "po18" }),
        signChapter({ chapter_id: "c2", title: "Two", html: "<p>two</p>", text: "two", chapter_order: 2, platform: "po18" })
    ];
    return signManifest({
        format: "po18-reader-book",
        version: 1,
        generated_at: "2026-07-11T12:00:00.000Z",
        source: {
            app_version: "2.0.0-test",
            identity_model: "legacy-platform-external-id",
            platform: "po18",
            book_id: "book-1"
        },
        book,
        chapters,
        summary: { chapters: 2, content_included: true }
    });
}

test("book manifest validates source identity and detects content tampering", () => {
    const manifest = sampleManifest();
    const validated = validateBookManifest(manifest);
    assert.equal(validated.book.book_id, "book-1");
    assert.equal(validated.chapters.length, 2);

    const tampered = structuredClone(manifest);
    tampered.chapters[0].text = "changed";
    assert.throws(
        () => validateBookManifest(tampered),
        (error) => error.code === "MANIFEST_CHAPTER_CHECKSUM_MISMATCH" && error.status === 422
    );

    const mismatched = structuredClone(manifest);
    mismatched.source.platform = "qidian";
    assert.throws(
        () => validateBookManifest(mismatched),
        (error) => error.code === "MANIFEST_SOURCE_MISMATCH" && error.status === 409
    );

    const invalidDate = sampleManifest();
    invalidDate.book.source_updated_at = "not-a-date";
    assert.throws(
        () => validateBookManifest(invalidDate),
        (error) => error.code === "MANIFEST_FIELD_INVALID" && error.status === 400
    );
});

test("book manifest export is self-validating and refuses legacy cross-platform collisions", async () => {
    const bookRow = {
        book_id: "book-1",
        platform: "po18",
        title: "Test Book",
        author: "Author",
        metadata_cached_at: "2026-07-11T00:00:00.000Z"
    };
    const chapterRow = { chapter_id: "c1", title: "One", html: "<p>one</p>", text: "one", chapter_order: 1, platform: "po18" };
    const service = createBookManifestService({
        appVersion: () => "2.0.0-test",
        query: async (sql) => {
            if (/FROM book_metadata WHERE id/.test(sql)) return { rows: [bookRow] };
            if (/SELECT id, platform FROM book_metadata/.test(sql)) return { rows: [{ id: 1, platform: "po18" }] };
            if (/SELECT DISTINCT COALESCE/.test(sql)) return { rows: [{ platform: "po18" }] };
            if (/FROM chapter_cache WHERE book_id/.test(sql)) return { rows: [chapterRow] };
            throw new Error(`unexpected SQL: ${sql}`);
        }
    });
    const manifest = await service.exportManifest(1);
    assert.equal(validateBookManifest(manifest).chapters[0].chapter_id, "c1");

    const collisionService = createBookManifestService({
        query: async (sql) => {
            if (/FROM book_metadata WHERE id/.test(sql)) return { rows: [bookRow] };
            if (/SELECT id, platform FROM book_metadata/.test(sql)) return { rows: [{ id: 2, platform: "qidian" }] };
            if (/SELECT DISTINCT COALESCE/.test(sql)) return { rows: [] };
            return { rows: [] };
        }
    });
    await assert.rejects(
        collisionService.exportManifest(1),
        (error) => error.code === "BOOK_ID_COLLISION_REQUIRES_BOOK_KEY" && error.status === 409
    );
});

test("book manifest import skips unchanged chapters and writes only the incremental batch", async () => {
    const manifest = sampleManifest();
    const statements = [];
    let released = false;
    const db = {
        async query(sql, params = []) {
            statements.push({ sql, params });
            if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) return { rows: [] };
            if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
            if (/SELECT id, platform FROM book_metadata/.test(sql)) return { rows: [{ id: 1, platform: "po18" }] };
            if (/SELECT DISTINCT COALESCE/.test(sql)) return { rows: [{ platform: "po18" }] };
            if (/SELECT id, manifest_checksum FROM book_metadata/.test(sql)) {
                return { rows: [{ id: 1, manifest_checksum: manifest.checksum.value }] };
            }
            if (/INSERT INTO book_metadata/.test(sql)) return { rows: [] };
            if (/SELECT chapter_id, manifest_checksum FROM chapter_cache/.test(sql)) {
                return { rows: [{ chapter_id: "c1", manifest_checksum: manifest.chapters[0].checksum.value }] };
            }
            if (/SELECT chapter_id, chapter_order/.test(sql)) return { rows: [] };
            if (/INSERT INTO chapter_cache/.test(sql)) return { rows: [] };
            throw new Error(`unexpected SQL: ${sql}`);
        },
        release() {
            released = true;
        }
    };
    const service = createBookManifestService({ query: async () => ({ rows: [] }), pool: { connect: async () => db } });
    const result = await service.importManifest(manifest);

    assert.deepEqual(result.chapters, { total: 2, inserted: 1, updated: 0, unchanged: 1 });
    assert.equal(result.metadata, "unchanged");
    const chapterInsert = statements.find((item) => /INSERT INTO chapter_cache/.test(item.sql));
    assert.equal(chapterInsert.params.length, 11);
    assert.ok(chapterInsert.params.includes("c2"));
    assert.ok(!chapterInsert.params.includes("c1"));
    assert.equal(released, true);
});

async function withApp(router, callback) {
    const app = express();
    app.use(express.json());
    app.use(router);
    app.use((error, req, res, _next) => res.status(error.status || 500).json({ code: error.code, error: error.message }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("admin manifest routes enforce admin access and exact import confirmation", async () => {
    const manifest = sampleManifest();
    const imported = [];
    const router = createAdminManifestRoutes({
        requireAdmin: (req, res, next) => req.get("X-Test-Admin") === "1" ? next() : res.status(401).json({ error: "admin required" }),
        bookManifestService: {
            validateManifest: validateBookManifest,
            exportManifest: async () => manifest,
            importManifest: async (value) => {
                imported.push(value);
                return { success: true, book_id: "book-1", platform: "po18", checksum: manifest.checksum.value, chapters: { inserted: 0, updated: 0, unchanged: 2 } };
            }
        }
    });
    await withApp(router, async (base) => {
        assert.equal((await fetch(`${base}/admin-api/books/1/manifest`)).status, 401);

        const validated = await fetch(`${base}/admin-api/books/manifests/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ manifest })
        });
        assert.equal(validated.status, 200);
        assert.equal((await validated.json()).expected_confirmation, "IMPORT po18:book-1");

        const rejected = await fetch(`${base}/admin-api/books/manifests/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ manifest, confirmation: "wrong" })
        });
        assert.equal(rejected.status, 400);

        const accepted = await fetch(`${base}/admin-api/books/manifests/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Admin": "1" },
            body: JSON.stringify({ manifest, confirmation: "IMPORT po18:book-1" })
        });
        assert.equal(accepted.status, 200);
        assert.equal(imported.length, 1);
    });
});
