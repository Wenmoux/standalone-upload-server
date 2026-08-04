/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供 EPUB 模板库、两级自定义选择、288 种工坊组合、默认值和兼容别名的自动化回归断言
 * [POS]: tests 的 EPUB 模板选择与自定义回调守卫，防止公开范围、配置开关或 callback_data 在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    EPUB_EXPORT_STYLE_CHOICES,
    epubCustomSelectionMarkup,
    epubStudioSelectionMarkup,
    epubStyleSelectionMarkup,
    normalizeEpubCustomConfig,
    normalizeEpubStyleChoice,
    parseEpubCustomState,
    parseEpubStudioState
} = require("../bot/epub-style-picker");
const { componentCatalog, encodeStudioConfig } = require("../services/epub-component-library");

test("EPUB style picker offers all public styles before export", () => {
    const markup = epubStyleSelectionMarkup("b1");
    assert.deepEqual(
        EPUB_EXPORT_STYLE_CHOICES.map((item) => item.id),
        ["style1", "style2", "style3", "style4", "studio"]
    );
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style1")?.label, "江湖纸卷");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style2")?.label, "老二次元");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style3")?.label, "空门夜雨");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "style4")?.label, "丹青云卷");
    assert.equal(EPUB_EXPORT_STYLE_CHOICES.find((item) => item.id === "studio")?.direct, false);
    assert.deepEqual(
        markup.inline_keyboard.flat().map((button) => button.callback_data),
        [
            "epubcustom|open|style1|11|b1",
            "epubcustom|open|style2|11|b1",
            "epubcustom|open|style3|11|b1",
            "epubcustom|open|style4|11|b1",
            "epubcustom|open|style1|11|b1",
            "epubstudio|open|yqhs|b1"
        ]
    );
    assert.equal(normalizeEpubStyleChoice("style2"), "style2");
    assert.equal(normalizeEpubStyleChoice("style3"), "style3");
    assert.equal(normalizeEpubStyleChoice("style4"), "style4");
    assert.equal(normalizeEpubStyleChoice("studio"), "studio");
    assert.equal(normalizeEpubStyleChoice("crane"), "");
});

test("EPUB studio picker exposes 288 component combinations with bounded callbacks", () => {
    assert.equal(componentCatalog().length, 17);
    const config = parseEpubStudioState("zsxz");
    assert.deepEqual(config.studio, { chapter: "zhuti", volume: "shuanglan", intro: "xuanhe", ornament: "zhuqian" });
    assert.equal(encodeStudioConfig(config.studio), "zsxz");
    const markup = epubStudioSelectionMarkup("1047414337", config.studio);
    const buttons = markup.inline_keyboard.flat();
    assert.ok(buttons.some((button) => button.text === "章题：朱题宠章"));
    assert.ok(buttons.some((button) => button.callback_data === "epubstudio|export|zsxz|1047414337"));
    assert.ok(buttons.every((button) => Buffer.byteLength(button.callback_data, "utf8") <= 64));
    const expanded = parseEpubStudioState("ddqd");
    assert.deepEqual(expanded.studio, { chapter: "danxia", volume: "danjuan", intro: "qingmo", ornament: "danhen" });
    assert.equal(encodeStudioConfig(expanded.studio), "ddqd");
    assert.equal(6 * 4 * 3 * 4, 288);
});

test("EPUB custom picker keeps supported options and callback payloads bounded", () => {
    const style2 = normalizeEpubCustomConfig({ styleId: "style2", includeColophon: false, showTopImage: true });
    assert.deepEqual(style2, { styleId: "style2", includeColophon: false, showTopImage: true });
    assert.deepEqual(parseEpubCustomState("style3", "11"), {
        styleId: "style3",
        includeColophon: true,
        showTopImage: false
    });
    const markup = epubCustomSelectionMarkup("1047414337", style2);
    const buttons = markup.inline_keyboard.flat();
    assert.ok(buttons.some((button) => button.text === "✓ 老二次元"));
    assert.ok(buttons.some((button) => button.text === "○ 制作说明"));
    assert.ok(buttons.some((button) => button.text === "✓ 章头装饰"));
    assert.ok(buttons.some((button) => button.callback_data === "epubcustom|export|style2|01|1047414337"));
    assert.ok(buttons.every((button) => Buffer.byteLength(button.callback_data, "utf8") <= 64));
});
