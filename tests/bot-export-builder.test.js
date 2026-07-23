/**
 * [INPUT]: 依赖 node:test、assert、fs/path 与 bot/export-builder 的缓存/PO18 合并及 TXT 流式序列化
 * [OUTPUT]: 提供部分缓存补全、章节去重排序、合法顺序缺口与源标题保持的自动化回归断言
 * [POS]: tests 的 Bot 导出完整性守卫，防止局部缓存生成缺章文件或按数组位置篡改来源目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const path = require("path");
const test = require("node:test");
const { createExportBuilder, mergeExportChapters } = require("../bot/export-builder");

function streamChunk(stream, chunk) {
    return new Promise((resolve, reject) => {
        stream.write(chunk, "utf8", (error) => (error ? reject(error) : resolve()));
    });
}

function finishStream(stream) {
    return new Promise((resolve, reject) => {
        stream.once("error", reject);
        stream.end(resolve);
    });
}

function builder(overrides = {}) {
    return createExportBuilder({
        client: {
            getChapters: async () => ({ rows: [] }),
            po18Account: async () => null
        },
        exportMaxChapters: 100,
        isVolumeChapter: (chapter) => !!chapter.is_volume,
        hasPo18Auth: () => false,
        fetchPo18PurchasedChapters: async () => [],
        asExportError: (code, message) => Object.assign(new Error(message), { code }),
        safeFileName: (value) => String(value).replace(/[^\w-]+/g, "_"),
        writeStreamChunk: streamChunk,
        finishWriteStream: finishStream,
        yieldToEventLoop: async () => {},
        chapterPlainText: (chapter) => String(chapter.text || chapter.html || "").replace(/<[^>]+>/g, ""),
        paidExportChapterCount: () => 0,
        makeEpubFiles: async () => [],
        buildZip: async () => Buffer.alloc(0),
        ...overrides
    });
}

test("export chapter merge fills only missing bodies and keeps source order", () => {
    const rows = mergeExportChapters(
        [
            { chapter_id: "c1", chapter_order: 45, title: "第45章 原题", text: "cached" },
            { chapter_id: "c2", chapter_order: 47, title: "", text: "" }
        ],
        [
            { chapter_id: "c2", chapter_order: 47, title: "补回标题", text: "fetched" },
            { chapter_id: "c3", chapter_order: 49, title: "第49章", text: "extra" }
        ]
    );

    assert.deepEqual(rows.map((row) => row.chapter_id), ["c1", "c2", "c3"]);
    assert.equal(rows[1].text, "fetched");
    assert.equal(rows[1].title, "补回标题");
});

test("TXT export supplements a partial PO18 cache without renumbering titles or gaps", async () => {
    const fetchCalls = [];
    const service = builder({
        client: {
            getChapters: async () => ({
                rows: [{ chapter_id: "c45", chapter_order: 45, title: "第45章 原题", text: "缓存正文" }]
            }),
            po18Account: async () => ({ cookies: ["po18_auth=ok"] })
        },
        hasPo18Auth: () => true,
        fetchPo18PurchasedChapters: async (bookId, cookies, options) => {
            fetchCalls.push({ bookId, cookies, options });
            return [{ chapter_id: "c47", chapter_order: 47, title: "", text: "已购正文" }];
        }
    });

    const result = await service.buildExport(
        { book_id: "book-1", title: "测试书", author: "作者", platform: "po18", total_chapters: 2, free_chapters: 1 },
        "txt",
        { id: "telegram-1" }
    );
    try {
        const content = await fs.readFile(result.filePath, "utf8");
        assert.match(content, /第45章 原题\n\n缓存正文/);
        assert.match(content, /第 47 章\n\n已购正文/);
        assert.doesNotMatch(content, /第 1 章 第45章/);
        assert.equal(result.chapters, 2);
        assert.deepEqual(fetchCalls[0].options.skipChapterIds, ["c45"]);
    } finally {
        await fs.rm(path.dirname(result.filePath), { recursive: true, force: true });
    }
});
