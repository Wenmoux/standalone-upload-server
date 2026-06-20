const assert = require("assert/strict");
const test = require("node:test");
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
    assert.deepEqual(parseTelegramPushTypes('["chapter","daily","chapter"]'), ["chapter", "daily"]);
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
    assert.deepEqual(updates[0].params, [7]);
    assert.match(updates[0].sql, /telegram_status = 'sent'/);
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
    assert.equal(saved.length, 1);
    assert.equal(saved[0].key, "telegram_daily_report_last_date");
    assert.match(saved[0].value, /^\d{4}-\d{2}-\d{2}$/);
});
