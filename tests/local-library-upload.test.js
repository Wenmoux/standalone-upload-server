/**
 * [INPUT]: 依赖 node:test、assert、fs/os/path、拆分后的扫描/传输模块、兼容门面、独立 UI HTTP 资源及受控替身/夹具
 * [OUTPUT]: 提供本地书库模块边界、上传解析、批次状态、页面资产拆分与安全默认值注入的自动化回归断言
 * [POS]: tests 的本地书库扫描/传输/CLI 组合与 UI 边界守卫，防止拆分后协议或独立工作台资源静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const libraryCore = require("../scripts/local-library-core");
const uploadService = require("../scripts/local-library-upload-service");
const { buildChapterPayload, scanLibrary, splitTitleAuthor, uploadManifestDirect } = require("../scripts/upload-local-library");
const { createApp, scanOptions: uiScanOptions } = require("../scripts/local-library-upload-ui");

function options(root) {
    return {
        root,
        platform: "alice",
        uploader: "tester",
        uploaderId: "tester",
        idPrefix: "test",
        defaultTags: ["成人"],
        defaultCategory: "成人",
        status: "已完结",
        overrides: "",
        limit: 0,
        splitSingleFile: true
    };
}

async function withLibrary(fn) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-library-"));
    try {
        await fs.mkdir(path.join(root, "测试书-作者甲"));
        await fs.writeFile(
            path.join(root, "测试书-作者甲", "0000-第一章 起.txt"),
            "标签：短篇,测试\n第一章 起\n\n这里是第一章正文。",
            "utf8"
        );
        await fs.writeFile(path.join(root, "测试书-作者甲", "0001-第二章 承.txt"), "第二章 承\n\n这里是第二章正文。", "utf8");
        await fs.writeFile(
            path.join(root, "单本-作者乙.txt"),
            "第一章 开始\n\n单文件第一章正文。\n\n第二章 后续\n\n单文件第二章正文。",
            "utf8"
        );
        await fn(root);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

test("local library facade composes independent scan and upload modules", () => {
    assert.equal(scanLibrary, libraryCore.scanLibrary);
    assert.equal(splitTitleAuthor, libraryCore.splitTitleAuthor);
    assert.equal(buildChapterPayload, uploadService.buildChapterPayload);
    assert.equal(uploadManifestDirect, uploadService.uploadManifestDirect);
});

test("local library scanner builds stable metadata and chapters", async () => {
    await withLibrary(async (root) => {
        const manifest = await scanLibrary(options(root));
        assert.equal(manifest.summary.books, 2);
        assert.equal(manifest.summary.chapters, 4);
        assert.equal(new Set(manifest.books.map((book) => book.metadata.bookId)).size, 2);

        const multi = manifest.books.find((book) => book.metadata.title === "测试书");
        const single = manifest.books.find((book) => book.metadata.title === "单本");
        assert.equal(multi.metadata.author, "作者甲");
        assert.equal(multi.metadata.tags.split(",").includes("成人"), true);
        assert.equal(multi.metadata.chapterCount, 2);
        assert.equal(single.mode, "single-file-split");
        assert.equal(single.metadata.chapterCount, 2);
    });
});

test("local library upload payload matches upload API field names", async () => {
    await withLibrary(async (root) => {
        const manifest = await scanLibrary(options(root));
        const book = manifest.books[0];
        const payload = await buildChapterPayload(book, book.chapters[0], {});
        assert.equal(payload.bookId, book.metadata.bookId);
        assert.equal(payload.chapterId, "1");
        assert.equal(payload.fromUserScript, true);
        assert.equal(payload.platform, "alice");
        assert.match(payload.html, /<p>/);
    });
});

test("local library direct upload calls metadata and chapter writers", async () => {
    await withLibrary(async (root) => {
        const manifest = await scanLibrary({ ...options(root), limit: 1 });
        const metadata = [];
        const chapters = [];
        const stats = await uploadManifestDirect(manifest, {
            upsertBook: async (book) => metadata.push(book),
            saveChapter: async (chapter) => chapters.push(chapter)
        });
        assert.equal(stats.metadataSuccess, 1);
        assert.equal(stats.chaptersUploaded, manifest.summary.chapters);
        assert.equal(metadata[0].tags.split(",").includes("成人"), true);
        assert.equal(chapters[0].fromUserScript, true);
    });
});

test("title parser uses the last separator as author boundary", () => {
    assert.deepEqual(splitTitleAuthor("长标题-副标题-作者名"), {
        title: "长标题-副标题",
        author: "作者名"
    });
});

test("standalone upload UI scan options keep adult default tag", () => {
    const parsed = uiScanOptions({ root: "D:\\books", defaultTags: "同人", platform: "local" });
    assert.equal(parsed.root, "D:\\books");
    assert.equal(parsed.platform, "local");
    assert.deepEqual(parsed.defaultTags, ["同人", "成人"]);
});

test("standalone upload UI serves split assets and safely injects defaults", async () => {
    const server = createApp({
        root: "D:\\books",
        baseUrl: "http://127.0.0.1:3100",
        token: "</script><script>alert(1)</script>"
    }).listen(0, "127.0.0.1");
    try {
        await new Promise((resolve, reject) => {
            server.once("listening", resolve);
            server.once("error", reject);
        });
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}`;
        const [page, shell, workspace, client] = await Promise.all([
            fetch(`${baseUrl}/`),
            fetch(`${baseUrl}/assets/local-library-upload-shell.css`),
            fetch(`${baseUrl}/assets/local-library-upload-workspace.css`),
            fetch(`${baseUrl}/assets/local-library-upload-client.js`)
        ]);
        const [pageText, shellText, workspaceText, clientText] = await Promise.all([
            page.text(),
            shell.text(),
            workspace.text(),
            client.text()
        ]);

        assert.equal(page.status, 200);
        assert.equal(shell.status, 200);
        assert.equal(workspace.status, 200);
        assert.equal(client.status, 200);
        assert.match(pageText, /local-library-upload-shell\.css/);
        assert.match(pageText, /local-library-upload-workspace\.css/);
        assert.match(pageText, /local-library-upload-client\.js/);
        assert.doesNotMatch(pageText, /<style>/);
        assert.doesNotMatch(pageText, /<script>alert\(1\)<\/script>/);
        assert.match(pageText, /\\u003c\/script>/);
        assert.match(shellText, /--primary:/);
        assert.match(workspaceText, /\.workspace\s*\{/);
        assert.match(clientText, /window\.__LOCAL_LIBRARY_DEFAULTS__/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
