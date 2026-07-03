const assert = require("assert/strict");
const test = require("node:test");
const { cleanChapterTitle } = require("../services/chapter-title-cleaner");

test("chapter title cleaner removes confirmed bracket notes", () => {
    const cases = [
        ["第63章 归来（求月票）", "第63章 归来"],
        ["第64章 归来(5k求月票)", "第64章 归来"],
        ["第65章 归来【二合一】", "第65章 归来"],
        ["第66章 归来[第二更]", "第66章 归来"],
        ["第67章 归来（感谢某某盟主", "第67章 归来"],
        ["第68章 归来（为某某白银盟加更", "第68章 归来"]
    ];
    for (const [input, expected] of cases) {
        const result = cleanChapterTitle(input);
        assert.equal(result.title, expected, input);
        assert.equal(result.changed, true, input);
        assert.ok(result.removed.length >= 1, input);
    }
});

test("chapter title cleaner keeps unconfirmed bracket notes", () => {
    const cases = [
        "第63章 标题（上）",
        "第63章 标题（本卷完）",
        "第63章 标题（大结局）",
        "第63章 标题【道生一】",
        "第63章 标题【绝对冰封】",
        "第63章 标题（蓝）",
        "第63章 标题【已修改】",
        "第63章 标题【三连更，第一弹】",
        "第63章 标题（修）",
        "第63章 标题（改）"
    ];
    for (const input of cases) {
        const result = cleanChapterTitle(input);
        assert.equal(result.title, input, input);
        assert.equal(result.changed, false, input);
    }
});

test("chapter title cleaner removes multiple confirmed notes and normalizes spaces", () => {
    const result = cleanChapterTitle("第70章  风起  （4k） 【求月票】");
    assert.equal(result.title, "第70章 风起");
    assert.deepEqual(result.removed.map((item) => item.ruleId), ["word-count-note", "ask-ticket"]);
});
