/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供热词聚合、停用词和 SVG/图片输出的自动化回归断言
 * [POS]: tests 的热词聚合、停用词和 SVG/图片输出守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createWordCloudService, mergeCloudRows, normalizeCloudWord, splitCloudTags } = require("../services/word-cloud");
const { layoutWordCloud, renderWordCloudPngBuffer, renderWordCloudSvg } = require("../bot/word-cloud");

test("word cloud helpers normalize and merge weighted words", () => {
    assert.equal(normalizeCloudWord("  #仙侠   修真  "), "仙侠 修真");
    assert.deepEqual(splitCloudTags("玄幻，都市/ 轻小说#女性向"), ["玄幻", "都市", "轻小说", "女性向"]);
    const rows = mergeCloudRows(
        [{ text: "玄幻", weight: 10, type: "tag" }],
        [{ keyword: "玄幻", weight: 5, type: "search" }, { text: "都市", count: 3 }]
    );
    assert.deepEqual(rows.map((row) => [row.text, row.weight]), [["玄幻", 15], ["都市", 3]]);
    assert.deepEqual(rows[0].sources.sort(), ["search", "tag"]);
});

test("word cloud service combines hot keywords and hot book tags", async () => {
    const sqlCalls = [];
    const service = createWordCloudService({
        getHotKeywords: async () => [{ keyword: "修仙", count: 3, result_count: 16 }],
        query: async (sql, params) => {
            sqlCalls.push({ sql, params });
            return { rows: [{ text: "玄幻", type: "tag", count: 2, weight: 80 }] };
        }
    });
    const payload = await service.wordCloudPayload({ limit: 5, platform: "qidian", sourceLimit: 50 });
    assert.deepEqual(payload.rows.map((row) => row.text), ["修仙", "玄幻"]);
    assert.equal(payload.platform, "qidian");
    assert.equal(sqlCalls[0].params[0], "qidian");
    assert.equal(sqlCalls[0].params[1], 50);
});

test("word cloud service caches repeated payload requests", async () => {
    let calls = 0;
    const service = createWordCloudService({
        cacheTtlMs: 60000,
        getHotKeywords: async () => [{ keyword: "修仙", count: 3, result_count: 16 }],
        query: async () => {
            calls += 1;
            return { rows: [{ text: "玄幻", type: "tag", count: 2, weight: 80 }] };
        }
    });
    const first = await service.wordCloudPayload({ limit: 5, platform: "qidian", sourceLimit: 50 });
    const second = await service.wordCloudPayload({ limit: 5, platform: "qidian", sourceLimit: 50 });
    assert.equal(calls, 1);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.deepEqual(second.rows.map((row) => row.text), first.rows.map((row) => row.text));
});

test("word cloud renderer produces non-empty svg layout", () => {
    const rows = [
        { text: "修仙", weight: 100 },
        { text: "都市", weight: 80 },
        { text: "轻小说", weight: 70 },
        { text: "女性向", weight: 60 }
    ];
    const layout = layoutWordCloud(rows, { width: 900, height: 520, top: 90, minFont: 18, maxFont: 62, limit: 4 });
    assert.ok(layout.placed.length >= 3);
    const svg = renderWordCloudSvg(rows, { width: 900, height: 520, top: 90, minFont: 18, maxFont: 62, title: "测试词云" });
    assert.match(svg, /<svg/);
    assert.match(svg, /修仙/);
});

test("word cloud renderer produces png bytes for telegram photo", () => {
    const rows = [
        { text: "修仙", weight: 100 },
        { text: "都市", weight: 80 },
        { text: "轻小说", weight: 70 }
    ];
    const png = renderWordCloudPngBuffer(rows, { width: 640, height: 380, top: 80, minFont: 18, maxFont: 54, title: "测试词云" });
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
