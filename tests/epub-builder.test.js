const assert = require("assert/strict");
const test = require("node:test");
const { createEpubBuilder } = require("../bot/epub-builder");

test("epub builder creates required files and a zip buffer", async () => {
    const { makeEpubFiles, buildZip } = createEpubBuilder({
        fetchImpl: null,
        craneHeaderImageBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        yieldToEventLoop: async () => {}
    });
    const files = await makeEpubFiles(
        { book_id: "b1", title: "Title & <Name>", author: "Author", description: "Intro" },
        [{ chapter_id: "c1", title: "第184章 回国", text: "hello\nworld" }]
    );

    assert.equal(files[0].name, "mimetype");
    assert.equal(files[0].store, true);
    assert.ok(files.some((file) => file.name === "OEBPS/content.opf"));
    assert.ok(files.some((file) => file.name === "OEBPS/Text/chapter_2.html"));
    assert.ok(files.some((file) => file.name === "OEBPS/Images/reader-crane-header.png"));

    const opf = files.find((file) => file.name === "OEBPS/content.opf").content.toString("utf8");
    assert.match(opf, /chapter-header-crane/);
    assert.match(opf, /reader-crane-header\.png/);

    const chapter = files.find((file) => file.name === "OEBPS/Text/chapter_2.html").content.toString("utf8");
    assert.match(chapter, /class="chapter-header"/);
    assert.match(chapter, /src="\.\.\/Images\/reader-crane-header\.png"/);
    assert.match(chapter, /class="chapter-header-number">第184章/);
    assert.match(chapter, /class="chapter-header-name">回国/);

    const zip = await buildZip(files);
    assert.ok(Buffer.isBuffer(zip));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
});
