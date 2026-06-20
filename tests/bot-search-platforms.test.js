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
