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
    assert.deepEqual(result.rows.map((row) => row.chapter_id), chapters);
    assert.deepEqual(calls.map(({ offset, limit }) => ({ offset, limit })), [
        { offset: 0, limit: 20 },
        { offset: 20, limit: 20 },
        { offset: 40, limit: 5 }
    ]);
    assert.ok(calls.every((call) => call.url.includes("includeContent=1")));
});
