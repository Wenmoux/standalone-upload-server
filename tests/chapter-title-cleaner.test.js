/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供标题清洗规则与幂等性的自动化回归断言
 * [POS]: tests 的标题清洗规则与幂等性守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供标题清洗规则与幂等性的自动化回归断言
 * [POS]: tests 的标题清洗规则与幂等性守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
    assert.deepEqual(
        result.removed.map((item) => item.ruleId),
        ["word-count-note", "ask-ticket"]
    );
});

test("chapter title cleaner covers one-time library cleanup semantics", () => {
    const cases = [
        ["第1章 标题（8/10求月票）", "第1章 标题"],
        ["第2章 标题（1更保底）", "第2章 标题"],
        ["第2章 标题（月票1600）", "第2章 标题"],
        ["第2章 标题（均订4000）", "第2章 标题"],
        ["第3章 标题（求追读！）", "第3章 标题"],
        ["第4章 标题（盟主加更）", "第4章 标题"],
        ["第5章 标题（5k求月票）", "第5章 标题"],
        ["第6章 标题（4k）", "第6章 标题"],
        ["第7章 标题（二合一）", "第7章 标题"],
        ["第8章 标题（第二更）", "第8章 标题"],
        ["第9章 标题（感谢某某盟主）", "第9章 标题"],
        ["第10章 标题（国庆快乐）", "第10章 标题"],
        ["第11章 标题（明天请假）", "第11章 标题"],
        ["第11章 标题（前一章被审核）", "第11章 标题"],
        ["第12章 标题（免费章节）", "第12章 标题"],
        ["第13章 标题（感谢某某盟主", "第13章 标题"]
    ];
    for (const [input, expected] of cases) assert.equal(cleanChapterTitle(input).title, expected, input);
});

test("chapter title cleaner normalizes whitespace, colon spacing and edge connectors", () => {
    assert.equal(cleanChapterTitle("  — 第14章\t标题：  测试\u00a0  — ").title, "第14章 标题：测试");
    assert.equal(cleanChapterTitle("第15章（  标题  ）").title, "第15章（标题）");
});

test("chapter title cleaner applies custom regexes after built-in rules", () => {
    const result = cleanChapterTitle("第16章 正文 [作者注：临时说明]（求月票）", {
        customRegexes: [{ regex: /\s*\[作者注：[^\]]+\]/gu }]
    });
    assert.equal(result.title, "第16章 正文");
    assert.ok(result.removed.some((item) => item.ruleId === "custom-regex"));
});

test("chapter title cleaner restores the original when all content would be removed", () => {
    const original = "（求月票）";
    const result = cleanChapterTitle(original);
    assert.equal(result.title, original);
    assert.equal(result.changed, false);
});
