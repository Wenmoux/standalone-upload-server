/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供EPUB 内容结构、标题去重与样式注入的自动化回归断言
 * [POS]: tests 的EPUB 内容结构、标题去重与样式注入守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { createEpubBuilder } = require("../bot/epub-builder");
const styleOne = require("../bot/epub-styles/style-one");
const styleThree = require("../bot/epub-styles/style-three");
const styleFour = require("../bot/epub-styles/style-four");

function contentOf(files, name) {
    return files.find((file) => file.name === name)?.content.toString("utf8") || "";
}

test("style1 uses the standalone CSS template", () => {
    const templateCss = fs.readFileSync(path.join(__dirname, "..", "assets", "epub-templates", "style1.css"), "utf8").trim();
    assert.equal(templateCss, styleOne.css.trim());
    assert.doesNotMatch(templateCss, /body\s*\{[^}]*background(?:-color)?\s*:/s);
    assert.match(templateCss, /p\.intro-text\{[^}]*color:#000[^}]*text-indent:0/s);
    assert.doesNotMatch(templateCss, /p\.intro-text\{[^}]*background/s);
    assert.match(templateCss, /@font-face\{font-family:"Asheng"/);
});

test("style3 uses the standalone CSS template", () => {
    const templateCss = fs.readFileSync(path.join(__dirname, "..", "assets", "epub-templates", "style3.css"), "utf8").trim();
    assert.equal(templateCss, styleThree.css.trim());
});

test("style4 uses the standalone CSS template without a chapter image rule", () => {
    const templateCss = fs.readFileSync(path.join(__dirname, "..", "assets", "epub-templates", "style4.css"), "utf8").trim();
    assert.equal(templateCss, styleFour.css.trim());
    assert.doesNotMatch(templateCss, /logo\.png|guigui4|style4-chapter/);
});

test("style3 volume renders dynamic text as a plain typographic page", () => {
    const page = styleThree.renderVolume({
        header: { number: "第二部", name: "卷名示例" },
        rawHeader: { number: "第二部", name: "卷名示例" }
    });
    assert.equal(page, '<body><h1>第二部　卷名示例</h1></body>');
    assert.doesNotMatch(page, /svg|image|style3-volume|Part/);
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
    assert.ok(files.some((file) => file.name === "OEBPS/Images/cover~slim.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/cover.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style-one-top.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Fonts/style1-asheng.ttf"));
    assert.ok(files.some((file) => file.name === "OEBPS/Fonts/style1-source-han-serif-bold.otf"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/colophon.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/intro.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/volume_0001.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/chapter_0001.xhtml"));

    const coverPage = contentOf(files, "OEBPS/Text/cover.xhtml");
    const mainCss = contentOf(files, "OEBPS/Styles/main.css");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    assert.match(coverPage, /html class="fullscreen-document cover-document"/);
    assert.match(coverPage, /body class="cover-page"/);
    assert.match(coverPage, /class="cover-svg"/);
    assert.match(coverPage, /viewBox="0 0 1080 2400"/);
    assert.match(coverPage, /xlink:href="..\/Images\/cover~slim\.png"/);
    assert.match(coverPage, /width=device-width,height=device-height/);
    assert.match(mainCss, /html\.fullscreen-document,html\.fullscreen-document body\.cover-page/);
    assert.match(packageFile, /po18-epub-style" content="style1"/);
    assert.match(packageFile, /id="cover-image-slim" href="Images\/cover~slim\.png" media-type="image\/png"/);
    assert.match(packageFile, /href="Fonts\/style1-asheng\.ttf" media-type="application\/x-font-ttf"/);
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
            title: "示例书名",
            author: "示例作者",
            description: "第一段\n第二段",
            cover: "https://example.test/cover.png",
            platform: "ciweimao",
            category: "仙侠武侠",
            word_count: 3243000,
            status: "已完结"
        },
        [
            { chapter_id: "v1", title: "第一卷 正文", type: "volume" },
            { chapter_id: "c1", title: "第1章 示例章节", text: "正文一\n正文二" }
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
    assert.ok(!files.some((file) => file.name === "OEBPS/Images/cover~slim.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/title.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/colophon.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/intro.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style2-title-background.jpg"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style2-chapter.jpg"));
    assert.ok(!files.some((file) => /style2-(?:note|publisher|chapter-[23]|volume-2)/.test(file.name)));

    const css = contentOf(files, "OEBPS/Styles/main.css");
    const title = contentOf(files, "OEBPS/Text/title.xhtml");
    const colophon = contentOf(files, "OEBPS/Text/colophon.xhtml");
    const intro = contentOf(files, "OEBPS/Text/intro.xhtml");
    const volume = contentOf(files, "OEBPS/Text/volume_0001.xhtml");
    const chapter = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    const toc = contentOf(files, "OEBPS/toc.ncx");

    assert.match(css, /style2-title-background\.jpg/);
    assert.match(css, /\.babala\{background:#fff no-repeat center/);
    assert.doesNotMatch(css, /div\.frame\{[^}]*background:/s);
    assert.doesNotMatch(css, /div\.frame2\{[^}]*background:/s);
    assert.match(css, /\.head\{letter-spacing:0;\}/);
    assert.match(title, /body class="ver"/);
    assert.match(title, /内部群版/);
    assert.doesNotMatch(title, /chubanshe|publisher/);
    assert.match(colophon, /body class="bg"/);
    assert.match(colophon, /版本 v2/);
    assert.doesNotMatch(colophon, /duokan-footnote|style2-note/);
    assert.match(intro, /body class="babala"/);
    assert.match(intro, /Images\/cover\.png/);
    assert.match(intro, /324\.3万字/);
    assert.match(volume, /style2-volume\.jpg/);
    assert.match(volume, /<div class="cover"><div class="images image-single"><img alt="" class="logo"/);
    assert.match(chapter, /style2-chapter\.jpg/);
    assert.match(chapter, /class="num">第1章/);
    assert.match(packageFile, /po18-epub-style" content="style2"/);
    assert.doesNotMatch(packageFile, /reference type="cover"/);
    assert.match(toc, /content src="Text\/volume_0001\.xhtml"\/><navPoint[^>]+><navLabel><text>第1章 示例章节<\/text>/);
    assert.equal(listEpubStyles().find((style) => style.id === "style1")?.name, "江湖纸卷");
    assert.equal(listEpubStyles().find((style) => style.id === "style2")?.name, "老二次元");
});

test("style3 EPUB builds pure-type cover matter, real volumes and nested chapters", async () => {
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
            book_id: "b-style3",
            title: "示例书名",
            author: "示例作者",
            description: "门后藏着秘密。\n真相正沿着沉默的走廊逼近。",
            cover: "https://example.test/cover.png"
        },
        [
            { chapter_id: "v1", title: "第一部 卷名示例", type: "volume" },
            { chapter_id: "c1", title: "第1章 新工作", text: "第1章　新工作\n门铃响了两次。" }
        ],
        {
            epub: {
                styleId: "style3",
                includeColophon: true,
                colophonTitle: "制作说明",
                colophonText: "本书由 PO18 Reader 自动排版。",
                introTitle: "内容简介"
            }
        }
    );

    assert.ok(files.some((file) => file.name === "OEBPS/Text/cover.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/colophon.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/intro.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/volume_0001.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/chapter_0001.xhtml"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/style3-reader-mark.png"));
    assert.ok(files.some((file) => file.name === "OEBPS/Fonts/style3-stkaiti.ttf"));
    assert.ok(files.some((file) => file.name === "OEBPS/Fonts/style3-stsongti-bold.ttf"));
    assert.ok(!files.some((file) => /style3-volume-|style3-roboto/.test(file.name)));
    assert.ok(files.some((file) => file.name === "META-INF/com.apple.ibooks.display-options.xml"));

    const css = contentOf(files, "OEBPS/Styles/main.css");
    const colophon = contentOf(files, "OEBPS/Text/colophon.xhtml");
    const intro = contentOf(files, "OEBPS/Text/intro.xhtml");
    const volume = contentOf(files, "OEBPS/Text/volume_0001.xhtml");
    const chapter = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    const toc = contentOf(files, "OEBPS/toc.ncx");

    assert.match(css, /h1\{[^}]*margin-top:40%[^}]*border-bottom:1px solid #000/s);
    assert.match(css, /h2\{[^}]*margin-top:3em[^}]*font-family:"STSongti-TC-Bold"[^}]*text-align:center/s);
    assert.match(css, /div\.copyright-box,div\.design-box\{[^}]*margin-top:20%[^}]*border-width:1px[^}]*border-radius:25px[^}]*box-shadow:1px 1px 3px/s);
    assert.doesNotMatch(css, /roboto_medium_numbers|style3-volume/);
    assert.match(colophon, /class="design-box"/);
    assert.match(colophon, /class="design-content"/);
    assert.match(colophon, /class="design-icon-dk" src="..\/Images\/style3-reader-mark\.png"/);
    assert.match(intro, /<div class="copyright-box"><p class="copyright-title">内容简介<\/p>/);
    assert.match(intro, /<p class="copyright-text">门后藏着秘密。<\/p>/);
    assert.match(volume, /<body><h1>第一部　卷名示例<\/h1><\/body>/);
    assert.doesNotMatch(volume, /svg|image|style3-volume|Part/);
    assert.match(chapter, /<h2>第1章　新工作<\/h2>/);
    assert.doesNotMatch(chapter, /<p>第1章[\s　]*新工作<\/p>/);
    assert.match(chapter, /<p>门铃响了两次。<\/p>/);
    assert.match(packageFile, /po18-epub-style" content="style3"/);
    assert.match(packageFile, /idref="cover-page" properties="duokan-page-fullscreen"/);
    assert.match(packageFile, /<itemref idref="volume-1"\/>/);
    assert.doesNotMatch(packageFile, /Images\/style3-volume-|idref="volume-1" properties=/);
    assert.match(packageFile, /href="Fonts\/style3-stsongti-bold\.ttf" media-type="application\/x-font-ttf"/);
    assert.match(packageFile, /href="Images\/style3-reader-mark\.png" media-type="image\/png"/);
    assert.doesNotMatch(toc, /<text>书封<\/text>/);
    assert.match(toc, /content src="Text\/volume_0001\.xhtml"\/><navPoint[^>]+><navLabel><text>第1章 新工作<\/text>/);
    assert.equal(listEpubStyles().find((style) => style.id === "style3")?.name, "空门夜雨");
});

test("style4 EPUB reproduces illustrated front matter and omits the chapter header image", async () => {
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
            book_id: "b-style4",
            title: "示例书名",
            author: "示例作者",
            description: "云山深处，自有一卷新章。",
            cover: "https://example.test/cover.png",
            platform: "qidian",
            category: "仙侠",
            status: "已完结",
            word_count: 3243000
        },
        [
            { chapter_id: "v1", title: "第一卷", type: "volume" },
            { chapter_id: "c1", title: "第1章 入山", text: "第1章 入山\n山门在云海之后。" }
        ],
        {
            epub: {
                styleId: "style4",
                includeColophon: true,
                colophonTitle: "制作说明",
                colophonText: "本书由 PO18 Reader 自动排版。",
                introTitle: "简介"
            }
        }
    );

    const names = new Set(files.map((file) => file.name));
    assert.ok(names.has("OEBPS/Text/cover.xhtml"));
    assert.ok(names.has("OEBPS/Text/colophon.xhtml"));
    assert.ok(names.has("OEBPS/Text/book-info.xhtml"));
    assert.ok(names.has("OEBPS/Text/intro.xhtml"));
    assert.ok(names.has("OEBPS/Text/volume_0001.xhtml"));
    assert.ok(names.has("OEBPS/Text/chapter_0001.xhtml"));
    assert.ok(names.has("OEBPS/Images/style4-colophon.jpg"));
    assert.ok(names.has("OEBPS/Images/style4-info.jpg"));
    assert.ok(names.has("OEBPS/Images/style4-intro.png"));
    assert.ok(names.has("OEBPS/Images/style4-volume.jpg"));
    assert.ok(names.has("OEBPS/Fonts/style4-cc.ttf"));
    assert.ok(names.has("OEBPS/Fonts/style4-llf.ttf"));
    assert.ok(![...names].some((name) => /logo\.png|style4-chapter/i.test(name)));

    const css = contentOf(files, "OEBPS/Styles/main.css");
    const colophon = contentOf(files, "OEBPS/Text/colophon.xhtml");
    const info = contentOf(files, "OEBPS/Text/book-info.xhtml");
    const intro = contentOf(files, "OEBPS/Text/intro.xhtml");
    const volume = contentOf(files, "OEBPS/Text/volume_0001.xhtml");
    const chapter = contentOf(files, "OEBPS/Text/chapter_0001.xhtml");
    const packageFile = contentOf(files, "OEBPS/content.opf");
    const toc = contentOf(files, "OEBPS/toc.ncx");

    assert.match(css, /body\.bg\{[^}]*style4-colophon\.jpg/s);
    assert.match(css, /\.sjxx\{[^}]*style4-info\.jpg/s);
    assert.match(css, /\.biaotibody1\{[^}]*style4-volume\.jpg/s);
    assert.doesNotMatch(css, /logo\.png|guigui4|style4-chapter/);
    assert.match(colophon, /<body class="bg"><div class="ff">/);
    assert.match(colophon, /<p class="cc-pot"><b>示例书名<\/b><\/p>/);
    assert.match(info, /<body class="sjxx">/);
    assert.match(info, /<img alt="cover" class="cover" src="..\/Images\/cover\.png"/);
    assert.match(info, /<td class="p1">1章<\/td><td class="p1">324\.3万字<\/td>/);
    assert.match(intro, /class="tupianA" src="..\/Images\/style4-intro\.png"/);
    assert.match(volume, /<body class="biaotibody1"><h1 class="biaoti1">第<br\/>一<br\/>卷<br\/><\/h1><\/body>/);
    assert.match(chapter, /<h2 class="heav3">第1章<br\/><b>入山<\/b><\/h2>/);
    assert.doesNotMatch(chapter, /<img|logo|guigui4/);
    assert.match(chapter, /<p>山门在云海之后。<\/p>/);
    assert.match(packageFile, /po18-epub-style" content="style4"/);
    assert.match(packageFile, /idref="cover-page" properties="duokan-page-fullscreen"/);
    assert.match(packageFile, /<itemref idref="colophon-page"\/><itemref idref="book-info-page"\/><itemref idref="intro-page"\/>/);
    assert.doesNotMatch(packageFile, /logo\.png|style4-chapter/);
    assert.match(toc, /<text>封面<\/text>/);
    assert.match(toc, /<text>制作说明<\/text>.*<text>书籍信息<\/text>.*<text>简介<\/text>/s);
    assert.match(toc, /content src="Text\/volume_0001\.xhtml"\/><navPoint[^>]+><navLabel><text>第1章 入山<\/text>/);
    assert.equal(listEpubStyles().find((style) => style.id === "style4")?.name, "丹青云卷");
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
