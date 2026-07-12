const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { createEpubBuilder } = require("../bot/epub-builder");
const styleOne = require("../bot/epub-styles/style-one");

function contentOf(files, name) {
    return files.find((file) => file.name === name)?.content.toString("utf8") || "";
}

test("style1 admin preview CSS stays identical to the EPUB style", () => {
    const previewCss = fs.readFileSync(path.join(__dirname, "..", "ui", "epub-style1.css"), "utf8").trim();
    assert.equal(previewCss, styleOne.css.trim());
});

test("style1 EPUB builds cover matter, intro, volume and chapter templates", async () => {
    const coverBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64"
    );
    const { makeEpubFiles, buildZip, listEpubStyles } = createEpubBuilder({
        fetchImpl: async () => ({
            ok: true,
            headers: { get: () => "image/png" },
            arrayBuffer: async () => coverBytes
        }),
        styleOneTopImageBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        yieldToEventLoop: async () => {}
    });
    const files = await makeEpubFiles(
        { book_id: "b1", title: "书名 & <测试>", author: "作者", description: "第一段\n第二段", cover: "https://example.test/cover.png" },
        [
            { chapter_id: "v1", title: "第一卷 寒池金鳞", type: "volume" },
            { chapter_id: "c1", title: "第一章 一人一刀一只鸟", text: "正文一\n正文二" }
        ],
        {
            epub: {
                styleId: "style1",
                includeColophon: true,
                colophonTitle: "制作说明",
                colophonText: "说明一\n\n说明二",
                introTitle: "作品简介",
                showTopImage: true
            }
        }
    );

    assert.equal(files[0].name, "mimetype");
    assert.equal(files[0].store, true);
    assert.ok(files.some((file) => file.name === "OEBPS/Images/cover.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/cover.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style-one-top.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/colophon.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/intro.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/volume_0001.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/chapter_0001.xhtml"));

    const coverPage = contentOf(files, "OEBPS/Text/cover.xhtml");
    const mainCss = contentOf(files, "OEBPS/Styles/main.css");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    assert.match(coverPage, /html class="cover-document"/);
    assert.match(coverPage, /body class="cover-page"/);
    assert.match(coverPage, /class="cover-svg"/);
    assert.match(coverPage, /width=device-width,height=device-height/);
    assert.match(mainCss, /html\.cover-document,html\.cover-document body\.cover-page/);
    assert.match(packageFile, /po18-epub-style" content="style1"/);
    assert.match(packageFile, /reference type="cover" title="Cover" href="Text\/cover\.xhtml"/);
    assert.match(contentOf(files, "OEBPS/Text/colophon.xhtml"), /class="design-box"/);
    assert.match(contentOf(files, "OEBPS/Text/intro.xhtml"), /class="introduction-title">作品简介/);
    assert.match(contentOf(files, "OEBPS/Text/volume_0001.xhtml"), /class="volume-sequence-number">第一卷/);
    assert.match(contentOf(files, "OEBPS/Text/volume_0001.xhtml"), /寒<br\/>池<br\/>金<br\/>鳞/);
    assert.match(contentOf(files, "OEBPS/Text/chapter_0001.xhtml"), /class="chapter-sequence-number">第一章/);
    assert.match(contentOf(files, "OEBPS/Text/chapter_0001.xhtml"), /一人一刀一只鸟/);
    assert.ok(listEpubStyles().some((style) => style.id === "style1"));

    const zip = await buildZip(files);
    assert.ok(Buffer.isBuffer(zip));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
});

test("crane EPUB style remains available", async () => {
    const { makeEpubFiles } = createEpubBuilder({
        fetchImpl: null,
        craneHeaderImageBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        yieldToEventLoop: async () => {}
    });
    const files = await makeEpubFiles(
        { book_id: "b2", title: "兼容测试", author: "作者", description: "简介" },
        [{ chapter_id: "c1", title: "第184章 回国", text: "hello" }],
        { epub: { styleId: "crane", includeColophon: false } }
    );

    assert.ok(files.some((file) => file.name === "OEBPS/Images/reader-crane-header.png"));
    const chapter = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    assert.match(chapter, /class="chapter-header"/);
    assert.match(chapter, /reader-crane-header\.png/);
    assert.match(chapter, /class="chapter-header-number">第184章/);
    assert.match(chapter, /class="chapter-header-name">回国/);
});

test("style2 EPUB reproduces title, colophon, intro, volume and chapter pages", async () => {
    const coverBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64"
    );
    const { makeEpubFiles, listEpubStyles } = createEpubBuilder({
        fetchImpl: async () => ({
            ok: true,
            headers: { get: () => "image/png" },
            arrayBuffer: async () => coverBytes
        }),
        yieldToEventLoop: async () => {}
    });
    const files = await makeEpubFiles(
        {
            book_id: "b3",
            title: "原来，她们才是主角",
            author: "ccc",
            description: "第一段\n第二段",
            cover: "https://example.test/cover.png",
            platform: "ciweimao",
            category: "仙侠武侠",
            word_count: 3243000,
            status: "已完结"
        },
        [
            { chapter_id: "v1", title: "第一卷 正文", type: "volume" },
            { chapter_id: "c1", title: "第1章 配角竟是我自己", text: "正文一\n正文二" }
        ],
        {
            epub: {
                styleId: "style2",
                includeColophon: true,
                colophonTitle: "制作说明",
                introTitle: "内容简介",
                style2: {
                    subtitle: "内部群版",
                    versionText: "版本 v2",
                    customCss: ".head{letter-spacing:0;}"
                }
            }
        }
    );

    assert.ok(!files.some((file) => file.name === "OEBPS/Text/cover.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/title.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/colophon.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/intro.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style2-title-background.jpg"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style2-chapter-1.jpg"));

    const css = contentOf(files, "OEBPS/Styles/main.css");
    const title = contentOf(files, "OEBPS/Text/title.xhtml");
    const colophon = contentOf(files, "OEBPS/Text/colophon.xhtml");
    const intro = contentOf(files, "OEBPS/Text/intro.xhtml");
    const volume = contentOf(files, "OEBPS/Text/volume_0001.xhtml");
    const chapter = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    const toc = contentOf(files, "OEBPS/toc.ncx");

    assert.match(css, /style2-title-background\.jpg/);
    assert.match(css, /\.head\{letter-spacing:0;\}/);
    assert.match(title, /body class="ver"/);
    assert.match(title, /内部群版/);
    assert.match(colophon, /body class="bg"/);
    assert.match(colophon, /版本 v2/);
    assert.match(intro, /body class="babala"/);
    assert.match(intro, /Images\/cover\.png/);
    assert.match(intro, /324\.3万字/);
    assert.match(volume, /style2-volume-1\.jpg/);
    assert.match(chapter, /style2-chapter-1\.jpg/);
    assert.match(chapter, /class="num">第1章/);
    assert.match(packageFile, /po18-epub-style" content="style2"/);
    assert.doesNotMatch(packageFile, /reference type="cover"/);
    assert.match(toc, /content src="Text\/volume_0001\.xhtml"\/><navPoint[^>]+><navLabel><text>第1章 配角竟是我自己<\/text>/);
    assert.equal(listEpubStyles().find((style) => style.id === "style2")?.name, "老二次元");
});

test("style2 EPUB does not add a volume page when chapter data has no volume row", async () => {
    const { makeEpubFiles } = createEpubBuilder({ fetchImpl: null, yieldToEventLoop: async () => {} });
    const files = await makeEpubFiles(
        { book_id: "b4", title: "无分卷书", author: "作者", description: "简介" },
        [{ chapter_id: "c1", title: "第一章 开始", text: "正文" }],
        { epub: { styleId: "style2", includeColophon: false } }
    );
    assert.ok(!files.some((file) => file.name === "OEBPS/Text/volume_0001.xhtml"));
    const toc = contentOf(files, "OEBPS/toc.ncx");
    assert.match(toc, /<navLabel><text>第一章 开始<\/text><\/navLabel><content src="Text\/chapter_0001\.xhtml"\/>/);
    assert.doesNotMatch(toc, />正文<\/text>/);
});

test("style2 EPUB ignores an empty volume marker instead of inventing a title", async () => {
    const { makeEpubFiles } = createEpubBuilder({ fetchImpl: null, yieldToEventLoop: async () => {} });
    const files = await makeEpubFiles(
        { book_id: "b5", title: "空分卷标记", author: "作者", description: "简介" },
        [
            { chapter_id: "volume-placeholder", title: "  ", type: "volume" },
            { chapter_id: "c1", title: "第一章 开始", text: "正文" }
        ],
        { epub: { styleId: "style2", includeColophon: false } }
    );
    assert.ok(!files.some((file) => file.name === "OEBPS/Text/volume_0001.xhtml"));
    assert.doesNotMatch(contentOf(files, "OEBPS/toc.ncx"), /volume-placeholder|>正文<\/text>/);
});

test("EPUB removes only an exact duplicated chapter title from the first body line", async () => {
    const { makeEpubFiles } = createEpubBuilder({ fetchImpl: null, yieldToEventLoop: async () => {} });
    const files = await makeEpubFiles(
        { book_id: "b6", title: "正文标题去重", author: "作者", description: "简介" },
        [
            { chapter_id: "c1", title: "第七章 电影院", text: "第七章　电影院\n美妇将换下的衣物提在店里。" },
            { chapter_id: "c2", title: "第八章 回家", text: "第八章 回家。\n这是正常正文。" }
        ],
        { epub: { styleId: "style2", includeColophon: false } }
    );
    const first = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    const second = contentOf(files, "OEBPS/Text/chapter_0002.xhtml");
    assert.match(first, /class="num">第七章/);
    assert.doesNotMatch(first, /<p>第七章[\s　]*电影院<\/p>/);
    assert.match(first, /<p>美妇将换下的衣物提在店里。<\/p>/);
    assert.match(second, /<p>第八章 回家。<\/p>/);
});
