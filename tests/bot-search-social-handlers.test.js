/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供搜索、私聊/群聊书评输入与取消清理交互契约的自动化回归断言
 * [POS]: tests 的搜索与社交命令处理器交互契约守卫，禁止 ForceReply 并防止草稿状态在取消后残留
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReviewDraftStore } = require("../bot/bot-session");
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

function reviewFixture(overrides = {}) {
    const sent = [];
    const edited = [];
    const deleted = [];
    const published = [];
    let messageId = 0;
    const reviewDrafts = createReviewDraftStore({ ttlMs: 60_000, maxSize: 10 });
    const client = {
        listBookReviews: async () => ({
            book: { title: "远南" },
            rules: { min_length: 6, max_length: 20, cost_copper: 100 }
        }),
        publishBookReview: async (bookId, userId, content) => {
            published.push({ bookId, userId, content });
            return { cost: 100, user: { copper_coins: 900 }, channel: { sent: true } };
        },
        ...overrides.client
    };
    const handlers = createSocialHandlers({
        client,
        ensureRegistered: async () => ({}),
        parseBookId: (value) => String(value || "").match(/([\w-]+)/)?.[1] || "",
        sendMessage: async (chatId, text, extra) => {
            const message = { message_id: ++messageId, chat: { id: chatId }, text };
            sent.push({ chatId, text, extra, message });
            return message;
        },
        editMessage: async (chatId, targetMessageId, text, extra) => edited.push({ chatId, targetMessageId, text, extra }),
        deleteMessage: async (chatId, targetMessageId) => deleted.push({ chatId, targetMessageId }),
        escapeHtml: (value) => String(value),
        bookReviewsActions: (bookId) => ({ inline_keyboard: [[{ text: "书评", callback_data: `reviews|${bookId}` }]] }),
        reviewPromptActions: (bookId) => ({ inline_keyboard: [[{ text: "取消", callback_data: `reviewcancel|${bookId}` }]] }),
        reviewDrafts
    });
    return { handlers, reviewDrafts, sent, edited, deleted, published };
}

test("guided review flow never forces a reply and only accepts the author's manual reply in groups", async () => {
    const fixture = reviewFixture();
    const author = { id: 88, username: "reader" };
    const chat = { id: -100, type: "supergroup" };
    await fixture.handlers.handleReviewStart({ chat, from: author }, "667518");

    assert.equal(fixture.sent[0].extra.reply_markup, undefined);
    assert.equal(fixture.sent[1].extra.reply_markup.inline_keyboard[0][0].callback_data, "reviewcancel|667518");
    assert.equal(fixture.handlers.reviewDraftContext({ chat, from: author }, "普通群聊"), null);
    assert.equal(fixture.handlers.reviewDraftContext({ chat, from: { id: 99 } }, "这不是我的草稿"), null);
    assert.equal(
        fixture.handlers.reviewDraftContext(
            { chat, from: author, reply_to_message: { message_id: fixture.sent[0].message.message_id } },
            "短"
        ).bookId,
        "667518"
    );

    await fixture.handlers.handleReviewDraft({ chat, from: author }, "短");
    const retryPrompt = fixture.sent.at(-1).message;
    assert.match(fixture.sent.at(-1).text, /至少需要 6 字/);
    assert.equal(fixture.reviewDrafts.get({ chatId: chat.id, userId: author.id }).promptMessageId, String(retryPrompt.message_id));

    await fixture.handlers.handleReviewDraft({ chat, from: author }, "这本真的非常好看");
    assert.deepEqual(fixture.published, [{ bookId: "667518", userId: 88, content: "这本真的非常好看" }]);
    assert.equal(fixture.reviewDrafts.get({ chatId: chat.id, userId: author.id }), null);
    assert.match(fixture.sent.at(-1).text, /书评已发布/);
});

test("guided review cancellation is scoped to the current book and publish failures retain the draft", async () => {
    let failPublish = true;
    const fixture = reviewFixture({
        client: {
            publishBookReview: async () => {
                if (failPublish) throw new Error("temporary outage");
                return { cost: 100, user: { copper_coins: 900 }, channel: { skipped: "disabled" } };
            }
        }
    });
    const message = { chat: { id: 7, type: "private" }, from: { id: 8 } };
    await fixture.handlers.handleReviewStart(message, "667518");
    assert.equal(fixture.sent[0].extra.reply_markup, undefined);
    await assert.rejects(fixture.handlers.handleReviewDraft(message, "这段书评足够长了"), /草稿已保留/);
    assert.equal(fixture.reviewDrafts.get({ chatId: 7, userId: 8 }).bookId, "667518");

    assert.equal(await fixture.handlers.handleReviewCancel(message, "other"), "没有待发布的书评");
    assert.equal(fixture.reviewDrafts.size(), 1);
    assert.equal(await fixture.handlers.handleReviewCancel(message, "667518", { chatId: 7, messageId: 9 }), "已取消");
    assert.equal(fixture.reviewDrafts.size(), 0);
    assert.match(fixture.edited[0].text, /已取消/);
    assert.deepEqual(fixture.deleted, [{ chatId: "7", targetMessageId: "1" }]);

    failPublish = false;
});
