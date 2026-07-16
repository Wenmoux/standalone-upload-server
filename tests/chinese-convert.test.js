/**
 * [INPUT]: 依赖 node:test、assert、fs/path/module、拆分后的转换报告模块与 Reader 使用的 opencc-js 运行时和繁简转换源码
 * [OUTPUT]: 提供报告边界、著/着、幺/么、台湾词汇、用户词表、占位碰撞、幂等、Reader 接线、双向兼容和实现收缩回归
 * [POS]: tests 的 Reader 中文转换与离线报告边界守卫，直接执行生产事实源而不复制转换规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const { createRequire } = require("module");
const path = require("path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "cirno-src", "src", "utils", "chinese-convert.js");
const reportAnalyzer = require("../cirno-src/scripts/conversion-report-analyzer");
const reportRenderer = require("../cirno-src/scripts/conversion-report-renderer");
const readerApiReport = require("../cirno-src/scripts/reader-api-conversion-report");
const { parseRounds } = require("../cirno-src/scripts/conversion-report");

function loadConverter() {
    const readerRequire = createRequire(path.join(ROOT, "cirno-src", "package.json"));
    const OpenCCT2CN = readerRequire("opencc-js/t2cn");
    const OpenCCCN2T = readerRequire("opencc-js/cn2t");
    let source = fs.readFileSync(SOURCE_PATH, "utf8");
    source = source
        .replace(/import \* as OpenCCT2CN[^\n]*\n/, "")
        .replace(/import \* as OpenCCCN2T[^\n]*\n/, "")
        .replace("export function convertText", "function convertText")
        .replace(/\nexport \{ t2sCharMap, s2tCharMap \}\s*$/, "");
    source += "\nreturn { convertText, t2sCharMap, s2tCharMap }";
    return Function("OpenCCT2CN", "OpenCCCN2T", source)(OpenCCT2CN, OpenCCCN2T);
}

test("conversion report composes analyzer, renderer and CLI without hidden side effects", () => {
    assert.equal(parseRounds(["--rounds", "2"]), 2);
    assert.equal(parseRounds(["--rounds=999"]), 20);
    const { convertText, t2sCharMap } = reportAnalyzer.loadConverter();
    const file = reportAnalyzer.builtInRegressionFile();
    const round = reportAnalyzer.runRound(1, [file], convertText, t2sCharMap);
    const summary = reportAnalyzer.buildSummary([file], [round]);
    const json = reportRenderer.buildJsonSummary(summary);
    const html = reportRenderer.renderReport(summary);

    assert.equal(summary.allPassed, true);
    assert.equal(json.allPassed, true);
    assert.equal(json.files.length, 1);
    assert.match(html, /Cirno Conversion Summary/);
    assert.equal(typeof readerApiReport.writeMarkdown, "function");
    assert.equal(typeof readerApiReport.writeHtml, "function");
});

test("traditional to simplified keeps novel context instead of repainting OpenCC output", () => {
    const { convertText, t2sCharMap } = loadConverter();
    const cases = [
        ["顯著", "显著"],
        ["卓著", "卓著"],
        ["著稱", "著称"],
        ["執著", "执着"],
        ["原著與編著", "原著与编著"],
        ["變徵之聲", "变徵之声"],
        ["瞭望", "了望"],
        ["拿著作業", "拿着作业"],
        ["看著作戰", "看着作战"],
        ["什幺 這幺 幺妹 幺蛾子", "什么 这么 幺妹 幺蛾子"],
        ["壹貳叁肆伍陸柒捌玖拾佰仟", "一二三四五六七八九十百千"]
    ];
    for (const [input, expected] of cases) {
        const output = convertText(input, "simplified");
        assert.equal(output, expected, input);
        assert.equal(convertText(output, "simplified"), output, `${input} should be idempotent`);
    }
    assert.ok(Object.keys(t2sCharMap).length < 50);
    assert.equal(Object.prototype.hasOwnProperty.call(t2sCharMap, "徵"), false);
});

test("taiwan phrase mode and glossary protection are explicit and collision safe", () => {
    const { convertText } = loadConverter();
    assert.equal(convertText("軟體 伺服器 計程車", "simplified"), "软件 服务器 出租车");
    assert.equal(convertText("軟體 伺服器 計程車", "simplified", { twPhrases: false }), "软体 伺服器 计程车");
    assert.equal(
        convertText("龍傲天與乾坤在軟體裡", "simplified", {
            glossary: "龙傲天=>龙傲天\n乾坤=>乾坤"
        }),
        "龙傲天与乾坤在软件里"
    );
    assert.equal(convertText("\uE000龍傲天\uE001", "simplified", { glossary: { 龍傲天: "龙傲天" } }), "\uE000龙傲天\uE001");
});

test("simplified to traditional remains available while the t2s source stays bounded", () => {
    const { convertText } = loadConverter();
    assert.equal(convertText("软件服务器 长发 干净 邻里", "traditional"), "軟體伺服器 長髮 乾淨 鄰里");
    const source = fs.readFileSync(SOURCE_PATH, "utf8");
    assert.ok(source.split(/\r?\n/).length <= 420);
    assert.doesNotMatch(source, /CONVERT_CACHE_LIMIT|replaceChars\(/);
});

test("Reader persists and forwards simplified conversion options", () => {
    const settings = fs.readFileSync(path.join(ROOT, "cirno-src", "src", "utils", "reader-settings.js"), "utf8");
    const mixin = fs.readFileSync(path.join(ROOT, "cirno-src", "src", "mixins", "reader-settings.js"), "utf8");
    const reader = fs.readFileSync(path.join(ROOT, "cirno-src", "src", "views", "Reader.vue"), "utf8");
    const settingsPanel = fs.readFileSync(path.join(ROOT, "cirno-src", "src", "components", "reader-settings-panel.vue"), "utf8");

    assert.match(settings, /convertTwPhrases:\s*true/);
    assert.match(settings, /convertGlossary:\s*['"]{2}/);
    assert.match(mixin, /twPhrases:\s*this\.readerSettings\.convertTwPhrases/);
    assert.match(mixin, /glossary:\s*this\.readerSettings\.convertGlossary/);
    assert.match(mixin, /scheduleConversionRebuild\(250\)/);
    assert.match(reader, /<reader-settings-panel/);
    assert.match(settingsPanel, /台湾用语转大陆用语/);
    assert.match(settingsPanel, /原词=&gt;目标|原词=>目标/);
});
