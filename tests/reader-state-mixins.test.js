/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 Reader 组合根及章节 mixin 源码
 * [OUTPUT]: 提供章节职责下沉、死状态清理、加载失败反馈及跨章节迟到响应隔离的自动化回归断言
 * [POS]: tests 的 Reader 章节组合边界守卫，确保只展示后端真实支持的阅读交互且领域状态不回流页面根
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function source(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadChapterMixin(overrides = {}) {
    const transformed = source("cirno-src/src/mixins/reader-chapter.js")
        .replace(/^import PerfectScrollbar[^\n]*\n/m, "")
        .replace(/^import \{[^\n]*\} from ['"]\.\.\/utils\/reader-offline['"]\n/m, "")
        .replace(/^import \{ cachedReaderUser \} from ['"]\.\.\/utils\/reader-session['"]\n/m, "")
        .replace("export default", "return");
    return Function(
        "PerfectScrollbar",
        "listOfflineBookChapters",
        "pinOfflineChapter",
        "rememberRecentChapter",
        "cachedReaderUser",
        transformed
    )(
        overrides.PerfectScrollbar || class {},
        overrides.listOfflineBookChapters || (() => Promise.resolve([])),
        overrides.pinOfflineChapter || (() => Promise.resolve()),
        overrides.rememberRecentChapter || (() => Promise.resolve()),
        overrides.cachedReaderUser || (() => null)
    );
}

function bindMixin(mixin, overrides = {}) {
    const context = { ...mixin.data() };
    for (const [name, method] of Object.entries(mixin.methods)) context[name] = method.bind(context);
    return Object.assign(context, overrides);
}

test("Reader delegates chapter state and removes unsupported legacy interactions", () => {
    const reader = source("cirno-src/src/views/Reader.vue");
    const readerScript = reader.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
    const chapter = source("cirno-src/src/mixins/reader-chapter.js");

    assert.match(reader, /import readerChapterMixin from ['"]\.\.\/mixins\/reader-chapter['"]/);
    assert.match(reader, /mixins:\s*\[[^\]]*readerChapterMixin[^\]]*readerTtsMixin[^\]]*\]/s);
    assert.doesNotMatch(reader, /\b(?:getContent|pinCurrentChapterOffline)\s*\([^)]*\)\s*\{/);
    assert.doesNotMatch(reader, /(?:Tsukkomi|Tickets|showTsukkomi|giveTickets|buyChapter)/);
    assert.doesNotMatch(readerScript, /\b(?:chapterCache|cataMarginLeft|contentWidth):/);
    assert.match(chapter, /async created\(\)\s*\{/);
    assert.match(chapter, /async getContent\(cid\)\s*\{/);
    assert.match(chapter, /async pinCurrentChapterOffline\(\)\s*\{/);
    assert.doesNotMatch(chapter, /chapter_buy|refreshTsukkomi|auth:\s*true/);
    assert.doesNotMatch(chapter, /book_chapterids/);
});

test("chapter loading exposes decode failures and cancels queued rendering after unmount", async () => {
    let scrollbarCreations = 0;
    const queuedTicks = [];
    const chapterMixin = loadChapterMixin({
        PerfectScrollbar: class {
            constructor() {
                scrollbarCreations += 1;
            }
        }
    });
    const base = {
        bid: "book",
        book_chapters: [{ chapter_id: 7, chapter_order: 3 }],
        flushReadingTime() {},
        isVolumeChapter: () => false,
        isIhuabenChapterInfo: () => false,
        normalizeParagraphLine: (line) => line,
        rebuildChapterDisplayContent: async () => {},
        setLastRead() {},
        markReadingStart() {},
        windowSizeHandler() {},
        applyReaderTheme() {},
        $refs: { book: {} },
        $nextTick: (callback) => queuedTicks.push(callback)
    };

    const broken = bindMixin(chapterMixin, {
        ...base,
        $get: async () => ({ data: { chapter_info: { chapter_id: "7", txt_content: "broken" } } }),
        decrypt: async () => {
            throw new Error("正文解密失败");
        }
    });
    await broken.getContent("7");
    assert.equal(broken.loading, -1);
    assert.equal(broken.loadError, "正文解密失败");
    assert.equal(broken.findChapterIndex("7"), 0);

    const ready = bindMixin(chapterMixin, {
        ...base,
        $get: async () => ({
            data: { chapter_info: { chapter_id: "7", chapter_order: 3, is_local_plain: true, txt_content: "正文" } }
        })
    });
    await ready.getContent("7");
    assert.equal(ready.loading, 1);
    assert.equal(queuedTicks.length, 1);
    chapterMixin.beforeUnmount.call(ready);
    queuedTicks[0]();
    assert.equal(scrollbarCreations, 0);
});
