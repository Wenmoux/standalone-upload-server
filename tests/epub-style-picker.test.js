/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供EPUB 样式选择、默认值和兼容别名的自动化回归断言
 * [POS]: tests 的EPUB 样式选择、默认值和兼容别名守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { EPUB_EXPORT_STYLE_CHOICES, epubStyleSelectionMarkup, normalizeEpubStyleChoice } = require("../bot/epub-style-picker");

test("EPUB style picker offers all public styles before export", () => {
    const markup = epubStyleSelectionMarkup("b1");
    assert.deepEqual(EPUB_EXPORT_STYLE_CHOICES.map((item) => item.id), ["style1", "style2", "style3", "style4"]);
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style1")?.label, "江湖纸卷");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style2")?.label, "老二次元");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style3")?.label, "空门夜雨");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style4")?.label, "丹青云卷");
    assert.deepEqual(markup.inline_keyboard.map((row) => row[0].callback_data), [
        "epubstyle|style1|b1",
        "epubstyle|style2|b1",
        "epubstyle|style3|b1",
        "epubstyle|style4|b1"
    ]);
    assert.equal(normalizeEpubStyleChoice("style2"), "style2");
    assert.equal(normalizeEpubStyleChoice("style3"), "style3");
    assert.equal(normalizeEpubStyleChoice("style4"), "style4");
    assert.equal(normalizeEpubStyleChoice("crane"), "");
});
