/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供TXT/EPUB 分享、样式选择与投递流程的自动化回归断言
 * [POS]: tests 的TXT/EPUB 分享、样式选择与投递流程守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createShareHandlers } = require("../bot/share-handlers");

function createRuntime({ book = {}, chapters = [], cachedIds = [] } = {}) {
    const uploaded = [];
    const client = {
        getBook: async () => ({
            book: {
                book_id: "100",
                title: "测试书",
                platform: "po18",
                ...book
            }
        }),
        getChapters: async () => ({ rows: chapters }),
        shareMetadata: async () => ({ success: true, stats: { failed: 0 } }),
        checkSharedCache: async () => ({ ids: cachedIds }),
        shareChapter: async (payload) => uploaded.push(payload),
        po18Account: async () => ({ cookies: [] })
    };
    const runtime = createShareHandlers({
        client,
        sendMessage: async () => ({ message_id: 1 }),
        editMessage: async () => {},
        ensureRegistered: async () => {},
        escapeHtml: (value) => String(value),
        isVolumeChapter: (chapter) => !!chapter.is_volume,
        userDisplayName: () => "tester",
        bookToSharePayload: (value) => value,
        extractCacheIds: (cache) => new Set(cache.ids || []),
        chapterToSharePayload: (_book, chapter, index) => ({
            chapterId: String(chapter.chapter_id),
            chapterOrder: index,
            html: `<p>${chapter.text}</p>`,
            text: chapter.text
        }),
        fetchPo18PurchasedChapters: async () => [],
        fetchPo18Bookshelf: async () => [],
        hasPo18Auth: () => false,
        logger: { warn() {}, error() {} }
    });
    return { ...runtime, client, uploaded };
}

const message = { from: { id: 42, username: "tester" }, chat: { id: 42 } };

test("share upload does not reward free chapters", async () => {
    const runtime = createRuntime({
        chapters: [
            { chapter_id: "1", text: "免费正文", is_free: true },
            { chapter_id: "2", text: "付费正文", is_paid: true }
        ]
    });

    const stats = await runtime._internals.shareBookForUser(message, { book_id: "100" });
    assert.equal(stats.uploaded, 2);
    assert.equal(stats.rewardableUploaded, 1);
});

test("share upload counts newly uploaded paid chapters as rewardable", async () => {
    const runtime = createRuntime({
        chapters: [
            { chapter_id: "9", text: "付费正文", price: 10 }
        ]
    });

    const stats = await runtime._internals.shareBookForUser(message, { book_id: "100" });
    assert.equal(stats.status, "uploaded");
    assert.equal(stats.uploaded, 1);
    assert.equal(stats.rewardableUploaded, 1);
});

test("share upload skips existing cached chapters before upload and reward calculation", async () => {
    const runtime = createRuntime({
        chapters: [
            { chapter_id: "20", text: "已缓存付费正文", is_paid: true },
            { chapter_id: "21", text: "新增付费正文", is_paid: true }
        ],
        cachedIds: ["20"]
    });

    const stats = await runtime._internals.shareBookForUser(message, { book_id: "100" });
    assert.equal(stats.skipped, 1);
    assert.equal(stats.uploaded, 1);
    assert.equal(stats.rewardableUploaded, 1);
    assert.deepEqual(runtime.uploaded.map((item) => item.chapterId), ["21"]);
});
