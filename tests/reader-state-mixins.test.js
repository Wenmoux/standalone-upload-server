/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 Reader 组合根、章节及间贴 mixin 源码
 * [OUTPUT]: 提供章节/间贴职责下沉、死状态清理、章节失败反馈及跨段落/章节迟到响应隔离的自动化回归断言
 * [POS]: tests 的 Reader 组合边界守卫，以结构与异步行为回归防止领域状态重新泄漏到页面根
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

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function loadTsukkomiMixin(PerfectScrollbar = class {}) {
    const transformed = source("cirno-src/src/mixins/reader-tsukkomi.js")
        .replace(/^import PerfectScrollbar[^\n]*\n/m, "")
        .replace("export default", "return");
    return Function("PerfectScrollbar", transformed)(PerfectScrollbar);
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

test("Reader delegates chapter and tsukkomi state without keeping dead data", () => {
    const reader = source("cirno-src/src/views/Reader.vue");
    const readerScript = reader.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
    const chapter = source("cirno-src/src/mixins/reader-chapter.js");
    const tsukkomi = source("cirno-src/src/mixins/reader-tsukkomi.js");

    assert.match(reader, /import readerChapterMixin from ['"]\.\.\/mixins\/reader-chapter['"]/);
    assert.match(reader, /import readerTsukkomiMixin from ['"]\.\.\/mixins\/reader-tsukkomi['"]/);
    assert.match(reader, /mixins:\s*\[[^\]]*readerChapterMixin[^\]]*readerTsukkomiMixin[^\]]*\]/s);
    assert.doesNotMatch(reader, /\b(?:getContent|pinCurrentChapterOffline|getTsukkomiList|showTsu)\s*\([^)]*\)\s*\{/);
    assert.doesNotMatch(readerScript, /\b(?:chapterCache|cataMarginLeft|contentWidth):/);
    assert.match(chapter, /async created\(\)\s*\{/);
    assert.match(chapter, /async getContent\(cid\)\s*\{/);
    assert.match(chapter, /async pinCurrentChapterOffline\(\)\s*\{/);
    assert.match(tsukkomi, /tsukkomiRequestId:\s*0/);
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
        refreshTsukkomiNums: async () => {},
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

test("tsukkomi list ignores an older response after the user switches paragraphs", async () => {
    const pending = [deferred(), deferred()];
    let call = 0;
    const mixin = loadTsukkomiMixin();
    const context = {
        ...mixin.data(),
        cid: "chapter",
        showTsukkomi: true,
        $refs: { tsukkomi: {} },
        $get: () => pending[call++].promise,
        $nextTick: (callback) => callback()
    };
    for (const [name, method] of Object.entries(mixin.methods)) context[name] = method.bind(context);

    context.tsukkomiIndex = 1;
    const older = context.getTsukkomiList(1);
    context.tsukkomiIndex = 2;
    const newer = context.getTsukkomiList(2);
    pending[1].resolve({ data: { tsukkomi_list: ["new"] } });
    await newer;
    pending[0].resolve({ data: { tsukkomi_list: ["old"] } });
    await older;

    assert.deepEqual(context.tsukkomi_list, ["new"]);
    assert.equal(context.tsukkomiLoading, false);
});

test("tsukkomi invalidation closes stale chapter work and exposes current request failures", async () => {
    const pending = deferred();
    let destroyed = 0;
    const mixin = loadTsukkomiMixin();
    const context = bindMixin(mixin, {
        cid: "chapter-1",
        showTsukkomi: true,
        tsukkomiIndex: 0,
        tsukkomi_list: ["existing"],
        tsukkomiScroll: { destroy: () => (destroyed += 1) },
        $refs: { tsukkomi: {} },
        $get: () => pending.promise,
        $nextTick: (callback) => callback()
    });

    const stale = context.getTsukkomiList(0);
    context.cid = "chapter-2";
    context.invalidateTsukkomiList({ close: true, clear: true });
    pending.resolve({ data: { tsukkomi_list: ["old chapter"] } });
    await stale;
    assert.deepEqual(context.tsukkomi_list, []);
    assert.equal(context.tsukkomiLoading, false);
    assert.equal(context.showTsukkomi, false);
    assert.equal(destroyed, 1);

    context.showTsukkomi = true;
    context.tsukkomiIndex = 0;
    context.$get = async () => {
        throw new Error("间贴网络失败");
    };
    await context.getTsukkomiList(0);
    assert.equal(context.tsukkomiLoading, false);
    assert.equal(context.tsukkomiError, "间贴网络失败");
});
