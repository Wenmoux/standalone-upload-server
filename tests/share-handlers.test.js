/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 TXT/EPUB 分享、PO18 缓存先行补抓、会话失效与投递流程的自动化回归断言
 * [POS]: tests 的共享上传守卫，防止已有免费章被重抓、未购章上传、过期 Cookie 误报空书架或重复奖励
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createShareHandlers } = require("../bot/share-handlers");

function createRuntime({
    book = {},
    chapters = [],
    cachedIds = [],
    account = { cookies: [] },
    bookshelfError = null,
    fetchPurchasedChapters = async () => []
} = {}) {
    const uploaded = [];
    const edits = [];
    const savedAccounts = [];
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
        po18Account: async () => account,
        addBookshelf: async () => {},
        savePo18Account: async (_telegramId, payload) => savedAccounts.push(payload),
        recordUserEvent: async () => {}
    };
    const runtime = createShareHandlers({
        client,
        sendMessage: async () => ({ message_id: 1 }),
        editMessage: async (...args) => edits.push(args),
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
        fetchPo18PurchasedChapters: fetchPurchasedChapters,
        fetchPo18Bookshelf: async () => {
            if (bookshelfError) throw bookshelfError;
            return [];
        },
        hasPo18Auth: (cookies) => cookies.some((cookie) => cookie.name === "authtoken1"),
        logger: { warn() {}, error() {} }
    });
    return { ...runtime, client, uploaded, edits, savedAccounts };
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

test("share checks caches before PO18 and fetches only missing free or purchased chapters", async () => {
    let fetchOptions = null;
    const runtime = createRuntime({
        book: { free_chapters: 1, total_chapters: 3 },
        chapters: [{ chapter_id: "1", text: "本地免费正文", is_free: true }],
        cachedIds: ["2"],
        account: { cookies: [{ name: "authtoken1", value: "ok" }] },
        fetchPurchasedChapters: async (_bookId, _cookies, options) => {
            fetchOptions = options;
            return [{ chapter_id: "3", text: "已购付费正文", is_paid: true, chapter_order: 3 }];
        }
    });

    const stats = await runtime._internals.shareBookForUser(message, { book_id: "100" });
    assert.deepEqual([...fetchOptions.skipChapterIds].sort(), ["1", "2"]);
    assert.equal(fetchOptions.freeChapterCount, 1);
    assert.deepEqual(runtime.uploaded.map((item) => item.chapterId), ["1", "3"]);
    assert.equal(stats.rewardableUploaded, 1);
});

test("bookshelf sharing clears expired PO18 sessions instead of reporting an empty shelf", async () => {
    const runtime = createRuntime({
        account: { account: "reader", cookies: [{ name: "authtoken1", value: "expired" }] },
        bookshelfError: Object.assign(new Error("expired"), { code: "PO18_AUTH_EXPIRED", retryable: false })
    });

    const result = await runtime.handleShareBookshelf(message);
    assert.equal(result.authExpired, true);
    assert.deepEqual(runtime.savedAccounts, [{ cookies: [], last_status: "session_expired" }]);
    assert.match(runtime.edits.at(-1)[2], /登录已失效/);
});
