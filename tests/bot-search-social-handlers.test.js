const test = require("node:test");
const assert = require("node:assert/strict");
const { createSearchHandlers } = require("../bot/search-handlers");
const { createSocialHandlers } = require("../bot/social-handlers");

function searchDeps(overrides = {}) {
    const sent = [];
    return {
        sent,
        deps: {
            client: {
                searchBooks: async () => ({ rows: [], page: 1, limit: 5, total: 0 }),
                recordSearch: async () => {},
                submitSearchRequest: async () => ({ already_exists: false })
            },
            searchLimit: 5,
            defaultRecommendPlatform: "po18",
            parseSearchQuery: (query) => ({ params: {}, type: "keyword", keyword: query, platform: "", cleanQuery: query }),
            parsePlatformSuffix: () => ({ platform: "", query: "" }),
            platformLabel: () => "全部站点",
            rememberSearch: () => "cache-key",
            ensureRegistered: async () => ({}),
            userDisplayName: () => "tester",
            escapeHtml: (value) => String(value),
            sendMessage: async (chatId, text, extra) => sent.push({ chatId, text, extra }),
            editMessage: async () => {},
            sendDocument: async () => {},
            sendPhoto: async () => {},
            deliverLongGroupResult: async (message, text, extra, options) => sent.push({ message, text, extra, options }),
            bookListItem: (book, index) => `${index}. ${book.title}`,
            listActions: () => ({ inline_keyboard: [[{ text: "详情" }]] }),
            searchPager: () => [[{ text: "下一页" }]],
            searchRequestActions: () => ({ inline_keyboard: [[{ text: "提交缺书" }]] }),
            mergeKeyboards: (left, right) => ({ inline_keyboard: [...left.inline_keyboard, ...right] }),
            detailCardText: () => "detail",
            bookActions: () => ({}),
            ...overrides
        }
    };
}

test("search handler keeps paging and cached search callback data", async () => {
    const fixture = searchDeps({
        client: {
            searchBooks: async () => ({ rows: [{ title: "A" }, { title: "B" }], page: 2, limit: 5, total: 12 }),
            recordSearch: async () => {}
        }
    });
    const handlers = createSearchHandlers(fixture.deps);
    await handlers.handleSearch({ chat: { id: 1 }, from: { id: 2 } }, "测试", 2, { chatId: 1, messageId: 9 });
    assert.equal(fixture.sent.length, 1);
    assert.match(fixture.sent[0].text, /6\. A/);
    assert.match(fixture.sent[0].text, /当前第 2 页/);
    assert.deepEqual(fixture.sent[0].options.editTarget, { chatId: 1, messageId: 9 });
    assert.equal(fixture.sent[0].extra.reply_markup.inline_keyboard.length, 2);
});

test("missing search submission preserves the existing payload fields", async () => {
    let submitted;
    const fixture = searchDeps({
        parseSearchQuery: () => ({ type: "tag", keyword: "仙侠", platform: "qidian", cleanQuery: "仙侠" }),
        client: {
            submitSearchRequest: async (telegramId, payload) => {
                submitted = { telegramId, payload };
                return { already_exists: false };
            }
        }
    });
    const handlers = createSearchHandlers(fixture.deps);
    const result = await handlers.handleSearchRequestSubmit({ from: { id: 88, username: "reader" } }, "#仙侠 -qd");
    assert.equal(result, "已提交到缺书需求列表。");
    assert.equal(submitted.telegramId, 88);
    assert.equal(submitted.payload.platform, "qidian");
    assert.equal(submitted.payload.type, "tag");
    assert.equal(submitted.payload.telegram_username, "reader");
});

test("review argument parsing accepts links and keeps the full review body", () => {
    const handlers = createSocialHandlers({
        parseBookId: (value) => String(value).match(/(\d+)/)?.[1] || ""
    });
    assert.deepEqual(handlers.parseReviewArgs("https://example.test/book/667518 太棒了 我的启蒙书"), {
        bookId: "667518",
        content: "太棒了 我的启蒙书"
    });
    assert.deepEqual(handlers.parseReviewArgs("无效参数"), { bookId: "", content: "" });
});
