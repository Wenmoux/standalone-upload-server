const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

function loadMixin() {
    const source = fs.readFileSync(path.resolve(__dirname, "../cirno-src/src/mixins/reader-navigation.js"), "utf8");
    return Function(source.replace("export default", "return"))();
}

function context(overrides = {}) {
    const mixin = loadMixin();
    const ctx = {
        book_chapters: [
            { chapter_id: "v1", is_volume: true },
            { chapter_id: "1" },
            { chapter_id: "v2", isVolume: true },
            { chapter_id: "3" }
        ],
        cid: "1",
        ...overrides
    };
    for (const [name, method] of Object.entries(mixin.methods)) {
        if (!Object.prototype.hasOwnProperty.call(overrides, name)) ctx[name] = method.bind(ctx);
    }
    Object.defineProperty(ctx, "readableChapters", {
        get: () => mixin.computed.readableChapters.call(ctx)
    });
    return ctx;
}

test("reader navigation skips volume rows in both directions", () => {
    const ctx = context();
    assert.equal(ctx.firstReadableChapterId(), "1");
    assert.equal(ctx.prevReadableChapterId(), null);
    assert.equal(ctx.nextReadableChapterId(), "3");
    ctx.cid = "3";
    assert.equal(ctx.prevReadableChapterId(), "1");
    assert.equal(ctx.nextReadableChapterId(), null);
    assert.equal(ctx.nearestReadableChapterId("v2"), "3");
});

test("reader progress flush sends accumulated seconds once", () => {
    let flushed = null;
    const ctx = context({
        bid: "book",
        cid: "1",
        readingStartedAt: 0,
        readingAccumulatedSeconds: 12,
        setLastRead(seconds) {
            flushed = seconds;
        }
    });
    ctx.flushReadingTime();
    assert.equal(flushed, 12);
    assert.equal(ctx.readingAccumulatedSeconds, 0);
});
