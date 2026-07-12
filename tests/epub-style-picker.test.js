const assert = require("assert/strict");
const test = require("node:test");
const { EPUB_EXPORT_STYLE_CHOICES, epubStyleSelectionMarkup, normalizeEpubStyleChoice } = require("../bot/epub-style-picker");

test("EPUB style picker offers style1 and style2 before export", () => {
    const markup = epubStyleSelectionMarkup("b1");
    assert.deepEqual(EPUB_EXPORT_STYLE_CHOICES.map((item) => item.id), ["style1", "style2"]);
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style2")?.label, "老二次元");
    assert.deepEqual(markup.inline_keyboard.map((row) => row[0].callback_data), [
        "epubstyle|style1|b1",
        "epubstyle|style2|b1"
    ]);
    assert.equal(normalizeEpubStyleChoice("style2"), "style2");
    assert.equal(normalizeEpubStyleChoice("crane"), "");
});
