/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 Bot HTTP 客户端分页、鉴权、书评操作键和错误映射的自动化回归断言
 * [POS]: tests 的 Bot HTTP 访问边界守卫，防止分页或幂等请求字段在协议演进中静默丢失
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { PgBotClient } = require("../bot/pg-bot-client");

test("bot client fetches large export content in bounded pages", async () => {
    const calls = [];
    const chapters = Array.from({ length: 45 }, (_, index) => `c${index + 1}`);
    const client = new PgBotClient({
        baseUrl: "http://bot.test",
        botToken: "test-token",
        exportPageSize: 20,
        fetchImpl: async (url) => {
            const parsed = new URL(url);
            const offset = Number(parsed.searchParams.get("offset") || 0);
            const limit = Number(parsed.searchParams.get("limit") || 0);
            calls.push({ offset, limit, url });
            const rows = chapters.slice(offset, offset + limit).map((chapter_id) => ({ chapter_id, html: chapter_id }));
            return {
                ok: true,
                async json() {
                    return {
                        rows,
                        total: rows.length,
                        has_more: offset + rows.length < chapters.length,
                        next_offset: offset + rows.length
                    };
                }
            };
        }
    });

    const result = await client.getChapters("book-1", true, { maxRows: 45 });
    assert.deepEqual(
        result.rows.map((row) => row.chapter_id),
        chapters
    );
    assert.deepEqual(
        calls.map(({ offset, limit }) => ({ offset, limit })),
        [
            { offset: 0, limit: 20 },
            { offset: 20, limit: 20 },
            { offset: 40, limit: 5 }
        ]
    );
    assert.ok(calls.every((call) => call.url.includes("includeContent=1")));
});

test("bot client forwards the stable book review operation key", async () => {
    let captured = null;
    const client = new PgBotClient({
        baseUrl: "http://bot.test",
        botToken: "test-token",
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return {
                ok: true,
                async json() {
                    return { success: true };
                }
            };
        }
    });
    await client.publishBookReview("book-1", "100", "这是一条可重试书评。", "telegram:book-review:chat:9");
    assert.equal(captured.url, "http://bot.test/bot-api/books/book-1/reviews");
    assert.deepEqual(JSON.parse(captured.options.body), {
        telegram_id: "100",
        content: "这是一条可重试书评。",
        source: "telegram_bot",
        idempotency_key: "telegram:book-review:chat:9"
    });
    assert.equal(captured.options.headers["X-Bot-Token"], "test-token");
});
