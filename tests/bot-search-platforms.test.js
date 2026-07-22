/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供搜索平台参数和别名解析的自动化回归断言
 * [POS]: tests 的搜索平台参数和别名解析守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    DEFAULT_RECOMMEND_PLATFORM,
    SEARCH_PLATFORM_SUFFIXES,
    createSearchPlatformRegistry,
    parsePlatformSuffix,
    platformLabel
} = require("../bot/search-platforms");
const { canonicalPlatformKey, platformQueryValues } = require("../services/platforms");

test("bot search platform helpers parse suffix shortcuts", () => {
    assert.equal(SEARCH_PLATFORM_SUFFIXES.qd, "qidian");
    assert.deepEqual(parsePlatformSuffix("狐魅 -qd"), { query: "狐魅", platform: "qidian", suffix: "-qd" });
    assert.deepEqual(parsePlatformSuffix("#古言 -fanqie"), { query: "#古言", platform: "fanqie", suffix: "-fanqie" });
    assert.deepEqual(parsePlatformSuffix("#古言 -hetu"), { query: "#古言", platform: "hetu", suffix: "-hetu" });
    assert.deepEqual(parsePlatformSuffix("狐魅"), { query: "狐魅", platform: "", suffix: "" });
    assert.deepEqual(parsePlatformSuffix("狐魅 -unknown"), { query: "狐魅 -unknown", platform: "", suffix: "" });
    assert.deepEqual(parsePlatformSuffix("", { defaultPlatform: DEFAULT_RECOMMEND_PLATFORM }), { query: "", platform: "po18", suffix: "" });
    assert.equal(platformLabel("qidian"), "起点");
    assert.equal(platformLabel(""), "全部站点");
});

test("bot search platform registry absorbs configured custom platforms", () => {
    const registry = createSearchPlatformRegistry({
        labels: { custom_site: "自定义站" },
        platforms: [{ value: "custom_site", label: "自定义站" }]
    });
    assert.deepEqual(registry.parsePlatformSuffix("测试 -custom_site"), {
        query: "测试",
        platform: "custom_site",
        suffix: "-custom_site"
    });
    assert.equal(registry.platformLabel("custom_site"), "自定义站");
});

test("shared platform aliases preserve historical database values", () => {
    assert.equal(canonicalPlatformKey("tomato"), "fanqie");
    assert.deepEqual(platformQueryValues("fanqie"), ["fanqie", "fq", "tomato"]);
    assert.deepEqual(platformQueryValues("qd"), ["qidian", "qd"]);
});
