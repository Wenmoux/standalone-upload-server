/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 Reader 首页、书库、详情视图及其独立 Less 源码
 * [OUTPUT]: 提供页面规模、样式归属、L3 契约、非阻塞举报表单和核心选择器的自动化回归断言
 * [POS]: tests 的 Reader 页面结构守卫，阻止业务组合页重新吸收大段视觉规则或突破 800 行阈值
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const VIEW_BOUNDARIES = [
    {
        view: "cirno-src/src/views/BookDetail.vue",
        style: "cirno-src/src/styles/book-detail.less",
        styleRef: "../styles/book-detail.less",
        selector: /\.detail-page\s*\{/
    },
    {
        view: "cirno-src/src/views/BookLibrary.vue",
        style: "cirno-src/src/styles/book-library.less",
        styleRef: "../styles/book-library.less",
        selector: /\.library-page\s*\{/
    },
    {
        view: "cirno-src/src/views/Index.vue",
        style: "cirno-src/src/styles/reader-home.less",
        styleRef: "../styles/reader-home.less",
        selector: /\.index-wrapper\s*\{/
    }
];

test("Reader page roots keep business orchestration separate from private styles", () => {
    for (const boundary of VIEW_BOUNDARIES) {
        const view = source(boundary.view);
        const style = source(boundary.style);
        const escapedRef = boundary.styleRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        assert.ok(view.split(/\r?\n/).length < 800, `${boundary.view} should stay below 800 lines`);
        assert.match(view, new RegExp(`<style src=["']${escapedRef}["'] lang=["']less["'] scoped><\\/style>`));
        assert.doesNotMatch(view, /<style lang=["']less["'] scoped>/);
        assert.match(style, boundary.selector);

        for (const marker of ["[INPUT]", "[OUTPUT]", "[POS]", "[PROTOCOL]"]) {
            assert.match(view, new RegExp(`\\${marker}`));
            assert.match(style, new RegExp(`\\${marker}`));
        }
    }
});

test("Reader review reporting uses a bounded non-blocking dialog", () => {
    const view = source("cirno-src/src/views/BookDetail.vue");
    const style = source("cirno-src/src/styles/book-detail.less");

    assert.doesNotMatch(view, /window\.prompt/);
    assert.match(view, /v-model:open="reportDialogOpen"/);
    assert.match(view, /:maxlength="2000"/);
    assert.match(view, /submitReviewReport/);
    assert.match(view, /写书评/);
    assert.match(style, /\.review-report-dialog\s*\{/);
    for (const reason of ["spam", "abuse", "spoiler", "illegal", "other"]) {
        assert.match(view, new RegExp(`value: ['"]${reason}['"]`));
    }
});
