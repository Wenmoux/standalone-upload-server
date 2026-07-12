/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供离线缓存、更新与失效策略的自动化回归断言
 * [POS]: tests 的离线缓存、更新与失效策略守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

function loadOfflineModule() {
    const source = fs.readFileSync(path.resolve(__dirname, "../cirno-src/src/utils/reader-offline.js"), "utf8");
    return Function(`${source.replace(/export\s+/g, "")}\nreturn {
        createMemoryOfflineBackend,
        createReaderOfflineStore,
        flushOfflineProgress,
        rememberOfflineProgress,
        sanitizeOfflineChapter
    }`)();
}

function memoryStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        }
    };
}

test("offline chapters are partitioned by reader and recent eviction is per owner", async () => {
    const { createMemoryOfflineBackend, createReaderOfflineStore } = loadOfflineModule();
    const backend = createMemoryOfflineBackend();
    let clock = 0;
    const store = createReaderOfflineStore({ backend, recentLimit: 2, storage: memoryStorage(), now: () => ++clock });
    const chapter = (id) => ({ chapter_id: id, chapter_title: `Chapter ${id}`, txt_content: `body ${id}`, auth_access: 1 });

    await store.rememberRecentChapter({ ownerId: "u1", bookId: "b", chapterId: "1", chapter: chapter("1") });
    await store.rememberRecentChapter({ ownerId: "u2", bookId: "b", chapterId: "1", chapter: chapter("1") });
    await store.pinChapter({ ownerId: "u1", bookId: "b", chapterId: "2", chapter: chapter("2") });
    await store.rememberRecentChapter({ ownerId: "u1", bookId: "b", chapterId: "3", chapter: chapter("3") });
    await store.rememberRecentChapter({ ownerId: "u1", bookId: "b", chapterId: "4", chapter: chapter("4") });

    assert.equal((await store.listBookChapters("u1", "b")).length, 3);
    assert.equal((await store.listBookChapters("u2", "b")).length, 1);
    assert.equal(await store.getChapter("u1", "b", "1"), null);
    assert.equal((await store.getChapter("u1", "b", "2")).pinned, true);
    assert.equal((await store.getChapter("u2", "b", "1")).ownerId, "u2");
});

test("offline progress merges time and flushes only the authenticated owner", async () => {
    const { flushOfflineProgress, rememberOfflineProgress } = loadOfflineModule();
    const storage = memoryStorage();
    rememberOfflineProgress({ ownerId: "u1", bookId: "b1", chapterId: "c1", readingSeconds: 5 }, storage);
    rememberOfflineProgress({ ownerId: "u1", bookId: "b1", chapterId: "c2", readingSeconds: 7 }, storage);
    rememberOfflineProgress({ ownerId: "u2", bookId: "b2", chapterId: "c3", readingSeconds: 9 }, storage);
    const sent = [];
    const result = await flushOfflineProgress({
        ownerId: "u1",
        storage,
        fetchImpl: async (_url, options) => {
            sent.push(JSON.parse(options.body));
            return { ok: true, status: 200 };
        }
    });
    assert.equal(result.flushed, 1);
    assert.equal(result.remaining, 1);
    assert.deepEqual(sent, [{ bookId: "b1", chapterId: "c2", progress: 0, readingSeconds: 12 }]);
});

test("offline chapter sanitizer rejects oversized content and strips unknown fields", () => {
    const { sanitizeOfflineChapter } = loadOfflineModule();
    const clean = sanitizeOfflineChapter({ chapter_id: "1", txt_content: "body", secret: "do-not-store", auth_access: 1 });
    assert.equal(clean.secret, undefined);
    assert.equal(clean.auth_access, "1");
    assert.throws(
        () => sanitizeOfflineChapter({ chapter_id: "1", txt_content: "x".repeat(2 * 1024 * 1024 + 1) }),
        /too large/
    );
});
