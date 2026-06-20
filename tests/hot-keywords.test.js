const assert = require("assert/strict");
const test = require("node:test");
const { createHotKeywordService, normalizeHotKeyword } = require("../services/hot-keywords");

test("hot keyword service normalizes, sorts and writes merged keywords", async () => {
    const stored = {
        bot_hot_keywords: JSON.stringify([
            { keyword: " beta ", type: "search", count: 2, result_count: 8, last_searched_at: "2026-01-01T00:00:00Z" },
            { keyword: "alpha", search_type: "author", count: 5, total_results: 1, updated_at: "2026-01-02T00:00:00Z" },
            { keyword: "", count: 100 }
        ])
    };
    const writes = [];
    const service = createHotKeywordService({
        configGet: async (key) => stored[key] || "",
        configSet: async (key, value) => {
            writes.push({ key, value });
            stored[key] = value;
        }
    });

    assert.equal(normalizeHotKeyword("  a   b  "), "a b");
    const rows = await service.getHotKeywords(10);
    assert.deepEqual(rows.map((row) => row.keyword), ["alpha", "beta"]);

    const added = await service.addHotKeyword(" beta ", "search", 3, 4, "2026-01-03T00:00:00Z");
    assert.equal(added.keyword, "beta");
    assert.equal(added.count, 6);
    assert.equal(added.result_count, 11);
    assert.equal(writes.length, 1);

    const saved = JSON.parse(writes[0].value);
    assert.deepEqual(saved.map((row) => row.keyword), ["beta", "alpha"]);
});
