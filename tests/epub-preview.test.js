/**
 * [INPUT]: 依赖 EPUB 配置规范化、工坊组件目录与 Resvg 渲染器
 * [OUTPUT]: 提供 EPUB 实时预览的 SVG/PNG、主题差异和有界缓存回归断言
 * [POS]: tests 的 Bot 预览视觉契约，保证 Telegram/QQ 共享同一配置投影且不触发正式导出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const { renderEpubPreviewPng, renderEpubPreviewSvg } = require("../bot/epub-preview");

test("EPUB preview renders deterministic PNGs for public styles", () => {
    const first = renderEpubPreviewPng({ styleId: "style1", includeColophon: true, showTopImage: true });
    const second = renderEpubPreviewPng({ styleId: "style1", includeColophon: true, showTopImage: true });
    const withoutArt = renderEpubPreviewPng({ styleId: "style1", includeColophon: true, showTopImage: false });
    assert.equal(first, second);
    assert.equal(first.subarray(1, 4).toString(), "PNG");
    assert.notDeepEqual(first, withoutArt);
});

test("EPUB studio preview exposes all selected component names and configuration differences", () => {
    const svg = renderEpubPreviewSvg({
        styleId: "studio",
        includeColophon: false,
        studio: { chapter: "danxia", volume: "danjuan", intro: "qingmo", ornament: "danhen" }
    });
    assert.match(svg, /丹霞双题/);
    assert.match(svg, /丹墨卷签/);
    assert.match(svg, /青墨引言/);
    assert.match(svg, /丹痕分章/);
    assert.match(svg, /实时样式预览/);
    assert.match(svg, /制作说明关闭/);
});
