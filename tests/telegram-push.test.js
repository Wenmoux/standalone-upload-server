/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供Telegram 推送队列、批次和失败恢复的自动化回归断言
 * [POS]: tests 的Telegram 推送队列、批次和失败恢复守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { hasTelegramSystemPushMarker } = require("../telegram-push-contract");
const {
    createTelegramPushService,
    originalChapterUrl,
    parseDailyReportTime,
    parseTelegramPushTypes,
    splitChatIds,
    telegramHtml
} = require("../services/telegram-push");

test("telegram helpers parse push types, report time and HTML safely", () => {
    assert.equal(telegramHtml(`a&<>"'`), "a&amp;&lt;&gt;&quot;&#39;");
    assert.deepEqual(parseTelegramPushTypes('["chapter","daily","review","chapter"]'), ["chapter", "daily", "review"]);
    assert.deepEqual(parseTelegramPushTypes({ metadata: true, daily_report: 1, chapter: false }), ["metadata", "daily"]);
    assert.deepEqual(splitChatIds("100, 200;300\n400"), ["100", "200", "300", "400"]);
    assert.deepEqual(parseDailyReportTime("9:05"), { value: "09:05", hour: 9, minute: 5 });
    assert.deepEqual(parseDailyReportTime("25:88"), { value: "23:59", hour: 23, minute: 59 });
    assert.deepEqual(parseDailyReportTime("bad"), { value: "22:00", hour: 22, minute: 0 });
    assert.equal(
        originalChapterUrl({ book_id: "123", chapter_id: "456" }, { detail_url: "https://www.po18.tw/books/123/articles" }),
        "https://www.po18.tw/books/123/articles/456"
    );
});

test("telegram service pages only non-banned registered recipients with Telegram ids", async () => {
    const calls = [];
    const service = createTelegramPushService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/COUNT\(DISTINCT telegram_id\)/.test(sql)) return { rows: [{ count: 2 }] };
            return { rows: [{ id: 11, telegram_id: "100" }, { id: 12, telegram_id: "200" }, { id: 13, telegram_id: "300" }] };
        }
    });
    const page = await service.registeredUserRecipients({ afterId: 10, limit: 2 });
    assert.deepEqual(page, { rows: [{ id: 11, telegram_id: "100" }, { id: 12, telegram_id: "200" }], has_more: true });
    assert.equal(await service.countRegisteredUserRecipients(), 2);
    assert.match(calls[0].sql, /is_banned/);
    assert.deepEqual(calls[0].params, [10, 3]);
});

test("telegram service sends chapter push and marks event sent", async () => {
    const config = {
        telegram_enabled: "1",
        telegram_push_types: JSON.stringify(["chapter"]),
        telegram_bot_token: "token-1",
        telegram_chat_id: "chat-1"
    };
    const posts = [];
    const updates = [];
    const service = createTelegramPushService({
        configGet: async (key) => config[key] || "",
        latestBookMetadata: async () => ({ title: "A&B", detail_url: "https://www.po18.tw/books/9/articles", platform: "po18" }),
        postJson: async (url, body) => {
            posts.push({ url, body });
            return "{}";
        },
        query: async (sql, params) => {
            updates.push({ sql, params });
            return { rows: [] };
        },
        sendDelayMs: 0
    });

    await service.notifyTelegram({ id: 7, event_type: "chapter", book_id: "9", chapter_id: "5", title: "T<1>" });

    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://api.telegram.org/bottoken-1/sendMessage");
    assert.equal(posts[0].body.chat_id, "chat-1");
    assert.match(posts[0].body.text, /A&amp;B/);
    assert.match(posts[0].body.text, /T&lt;1&gt;/);
    assert.equal(hasTelegramSystemPushMarker(posts[0].body.text), true);
    assert.deepEqual(updates[0].params, [7]);
    assert.match(updates[0].sql, /telegram_status = 'sent'/);
});

test("telegram service sends metadata push as cover card with jump buttons", async () => {
    const config = {
        telegram_enabled: "1",
        telegram_push_types: JSON.stringify(["metadata"]),
        telegram_bot_token: "token-1",
        telegram_chat_id: "chat-1"
    };
    const posts = [];
    const updates = [];
    const service = createTelegramPushService({
        configGet: async (key) => config[key] || "",
        labelsProvider: async () => ({ qidian: "起点" }),
        readerPublicUrlProvider: () => "https://reader.example",
        latestBookMetadata: async () => ({
            book_id: "9",
            title: "Book <A>",
            author: "Author & B",
            cover: "/cover.jpg",
            category: "玄幻",
            status: "连载",
            description: "这是一段 & 符号的简介。",
            tags: "热血,升级,玄幻",
            detail_url: "https://www.example.com/books/9",
            platform: "qidian"
        }),
        postJson: async (url, body) => {
            posts.push({ url, body });
            return "{}";
        },
        query: async (sql, params) => {
            updates.push({ sql, params });
            if (/INSERT INTO telegram_metadata_pushes/.test(sql)) return { rows: [{ book_id: params[0] }] };
            return { rows: [] };
        },
        sendDelayMs: 0
    });

    await service.notifyTelegram({ id: 8, event_type: "metadata", book_id: "9", title: "Old", platform: "qidian" });

    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://api.telegram.org/bottoken-1/sendPhoto");
    assert.equal(posts[0].body.chat_id, "chat-1");
    assert.equal(posts[0].body.photo, "https://www.example.com/cover.jpg");
    assert.match(posts[0].body.caption, /书名：Book &lt;A&gt;/);
    assert.match(posts[0].body.caption, /作者：Author &amp; B/);
    assert.match(posts[0].body.caption, /平台：起点/);
    assert.match(posts[0].body.caption, /分类：玄幻/);
    assert.match(posts[0].body.caption, /状态：连载/);
    assert.match(posts[0].body.caption, /标签：热血 \/ 升级 \/ 玄幻/);
    assert.match(posts[0].body.caption, /简介：\n<blockquote expandable>这是一段 &amp; 符号的简介。<\/blockquote>/);
    assert.equal(hasTelegramSystemPushMarker(posts[0].body.caption), true);
    assert.ok(posts[0].body.caption.length <= 1024);
    assert.deepEqual(posts[0].body.reply_markup.inline_keyboard[0], [
        { text: "阅读器详情", url: "https://reader.example/#/detail?bid=9" },
        { text: "原站链接", url: "https://www.example.com/books/9" }
    ]);
    assert.ok(updates.some((item) => /INSERT INTO telegram_metadata_pushes/.test(item.sql)));
    assert.ok(updates.some((item) => /UPDATE telegram_metadata_pushes/.test(item.sql) && item.params[1] === "sendPhoto"));
    const eventUpdate = updates.find((item) => /UPDATE upload_events/.test(item.sql));
    assert.deepEqual(eventUpdate.params, [8]);
    assert.match(eventUpdate.sql, /telegram_status = 'sent'/);
});

test("telegram service skips metadata push after a book id was already pushed", async () => {
    const config = {
        telegram_enabled: "1",
        telegram_push_types: JSON.stringify(["metadata"]),
        telegram_bot_token: "token-1",
        telegram_chat_id: "chat-1"
    };
    const posts = [];
    const updates = [];
    const service = createTelegramPushService({
        configGet: async (key) => config[key] || "",
        latestBookMetadata: async () => ({ book_id: "9", title: "Book", detail_url: "https://www.example.com/books/9", platform: "po18" }),
        postJson: async (url, body) => {
            posts.push({ url, body });
            return "{}";
        },
        query: async (sql, params) => {
            updates.push({ sql, params });
            if (/INSERT INTO telegram_metadata_pushes/.test(sql)) return { rows: [] };
            return { rows: [] };
        },
        sendDelayMs: 0
    });

    await service.notifyTelegram({ id: 9, event_type: "metadata", book_id: "9", title: "Book", platform: "po18" });

    assert.equal(posts.length, 0);
    const eventUpdate = updates.find((item) => /UPDATE upload_events/.test(item.sql));
    assert.deepEqual(eventUpdate.params, [9]);
    assert.match(eventUpdate.sql, /telegram_status = 'skipped'/);
});

test("daily report merges recipients, sends messages and records last date", async () => {
    const config = {
        telegram_daily_report_enabled: "1",
        telegram_daily_report_time: "22:30",
        telegram_daily_report_admin_ids: "100,200",
        telegram_daily_report_last_date: "",
        telegram_enabled: "1",
        telegram_push_types: JSON.stringify(["daily"]),
        telegram_chat_id: "200,300"
    };
    const sent = [];
    const saved = [];
    const service = createTelegramPushService({
        configGet: async (key) => config[key] || "",
        configSet: async (key, value) => saved.push({ key, value }),
        tokenProvider: async () => "token-2",
        postJson: async (url, body) => {
            sent.push({ url, body });
            return "{}";
        },
        query: async (sql) => {
            if (/WITH active_users/.test(sql)) {
                return {
                    rows: [{
                        new_books: 1,
                        new_chapters: 2,
                        metadata_events: 3,
                        metadata_books: 4,
                        active_users: 5,
                        signed_users: 6,
                        new_users: 7,
                        upload_events: 8,
                        chapter_events: 9,
                        transactions: 10,
                        corrections: 11,
                        total_books: 12,
                        total_chapters: 13,
                        total_metadata: 14,
                        total_users: 15,
                        pending_telegram: 16
                    }]
                };
            }
            return { rows: [{ uploader: "up&1", count: 2 }] };
        },
        sendDelayMs: 0
    });

    const result = await service.sendDailyReport();

    assert.equal(result.recipients, 3);
    assert.equal(result.sent, 3);
    assert.deepEqual(sent.map((item) => item.body.chat_id), ["100", "200", "300"]);
    assert.ok(sent.every((item) => item.url === "https://api.telegram.org/bottoken-2/sendMessage"));
    assert.match(sent[0].body.text, /PO18/);
    assert.match(sent[0].body.text, /up&amp;1/);
    assert.ok(sent.every((item) => hasTelegramSystemPushMarker(item.body.text)));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].key, "telegram_daily_report_last_date");
    assert.match(saved[0].value, /^\d{4}-\d{2}-\d{2}$/);
});
