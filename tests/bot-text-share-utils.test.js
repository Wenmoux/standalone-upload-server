const assert = require("assert/strict");
const test = require("node:test");
const {
    cleanText,
    chapterToSharePayload,
    extractCacheIds,
    textToParagraphs
} = require("../bot/text-share-utils");

test("bot text/share utils clean html and build upload payloads", () => {
    assert.equal(cleanText("<p>Hello&nbsp;<b>world</b></p><script>x</script>"), "Hello world");
    assert.equal(textToParagraphs("a\nb"), "<p>a</p><p>b</p>");

    const payload = chapterToSharePayload(
        { book_id: "b1", platform: "po18" },
        { chapter_id: "c1", title: "T", text: "正文", chapter_order: 4 },
        1,
        "uploader",
        "42"
    );
    assert.equal(payload.bookId, "b1");
    assert.equal(payload.chapterId, "c1");
    assert.equal(payload.html, "<p>正文</p>");
    assert.equal(payload.chapterOrder, 4);

    assert.deepEqual([...extractCacheIds({ data: [{ chapterId: "1" }, { chapter_id: "2" }, "3"] })].sort(), ["1", "2", "3"]);
});
