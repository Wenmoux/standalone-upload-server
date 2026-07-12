/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供搜索平台参数和别名解析的自动化回归断言
 * [POS]: tests 的搜索平台参数和别名解析守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { DEFAULT_RECOMMEND_PLATFORM, SEARCH_PLATFORM_SUFFIXES, parsePlatformSuffix, platformLabel } = require("../bot/search-platforms");

test("bot search platform helpers parse suffix shortcuts", () => {
    assert.equal(SEARCH_PLATFORM_SUFFIXES.qd, "qidian");
    assert.deepEqual(parsePlatformSuffix("狐魅 -qd"), { query: "狐魅", platform: "qidian", suffix: "-qd" });
    assert.deepEqual(parsePlatformSuffix("#古言 -fanqie"), { query: "#古言", platform: "fanqie", suffix: "-fanqie" });
    assert.deepEqual(parsePlatformSuffix("狐魅"), { query: "狐魅", platform: "", suffix: "" });
    assert.deepEqual(parsePlatformSuffix("狐魅 -unknown"), { query: "狐魅 -unknown", platform: "", suffix: "" });
    assert.deepEqual(parsePlatformSuffix("", { defaultPlatform: DEFAULT_RECOMMEND_PLATFORM }), { query: "", platform: "po18", suffix: "" });
    assert.equal(platformLabel("qidian"), "起点");
    assert.equal(platformLabel(""), "全部站点");
});
