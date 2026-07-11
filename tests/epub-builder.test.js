const assert = require("assert/strict");
const test = require("node:test");
const { createEpubBuilder } = require("../bot/epub-builder");

function contentOf(files, name) {
    return files.find((file) => file.name === name)?.content.toString("utf8") || "";
}

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
