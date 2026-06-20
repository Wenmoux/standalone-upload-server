const assert = require("assert/strict");
const test = require("node:test");
const {
    createRankService,
    normalizePlatformKey,
    originalBookUrl,
    rankHeat,
    rankSnippet,
    rankTags
} = require("../services/rank");

test("rank helpers normalize platform, tags, snippets and original urls", () => {
    assert.equal(normalizePlatformKey(" PO-18 "), "po18");
    assert.deepEqual(rankTags("古言，甜文 / 完结|PO18"), ["古言", "甜文", "完结", "PO18"]);
    assert.equal(rankSnippet("<p>第一段</p><p>第二段</p>", 10), "第一段 第二段");
    assert.equal(originalBookUrl({ platform: "po18", book_id: "123" }), "https://www.po18.tw/books/123/articles");
    assert.equal(originalBookUrl({ platform: "qidian", book_id: "456" }), "https://book.qidian.com/info/456/");
});

test("rank heat weights engagement signals", () => {
    const base = rankHeat({ total_popularity: 10 });
    const boosted = rankHeat({ total_popularity: 10, like_count: 2, supporter_count: 1, crowd_silver: 20 });
    assert.equal(base, 10);
    assert.equal(boosted, 82);
});

test("rank service builds cached reader payload with filters and limits", async () => {
    let queryCount = 0;
    const rank = createRankService({
        cacheTtlMs: 60_000,
        refreshIntervalMs: 0,
        labelsProvider: async () => ({ po18: "PO18", qidian: "起点" }),
        query: async () => {
            queryCount += 1;
            return {
                rows: [
                    {
                        id: 1,
                        book_id: "a",
                        title: "热书",
                        author: "作者A",
                        platform: "po18",
                        tags: "古言,甜文",
                        total_popularity: 100,
                        like_count: 5,
                        total_count: 2,
                        updated_at: "2026-01-02T00:00:00Z"
                    },
                    {
                        id: 2,
                        book_id: "b",
                        title: "长篇",
                        author: "作者B",
                        platform: "qidian",
                        tags: "玄幻",
                        word_count: 500000,
                        total_chapters: 200,
                        cache_count: 150,
                        total_count: 2,
                        updated_at: "2026-01-01T00:00:00Z"
                    }
                ]
            };
        }
    });

    const payload = await rank.readerPayload({ sort: "cache", site: "qidian", limit: 1 });
    assert.equal(payload.success, true);
    assert.equal(payload.active.sort, "cache");
    assert.equal(payload.active.total, 1);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].book_id, "b");
    assert.equal(payload.rows[0].platform_label, "起点");
    assert.equal(payload.meta.total, 2);

    const cached = await rank.getPayload();
    assert.equal(cached.rows.length, 2);
    assert.equal(queryCount, 1);
});
