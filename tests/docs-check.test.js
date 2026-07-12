/**
 * [INPUT]: 依赖 node:test、临时文件系统与 scripts/check-docs 的链接/L3 校验函数
 * [OUTPUT]: 提供 Markdown 目标解析、断链检测和源码契约完整性的自动化回归断言
 * [POS]: tests 的 GEB 门禁守卫，防止文档检查器自身退化后给出虚假绿色结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { localLinkTarget, markdownLinks, validateFile, validateSourceContract } = require("../scripts/check-docs");

function withTempDirectory(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "po18-docs-check-"));
    try {
        return run(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test("documentation checker separates local links from external and anchor links", () => {
    assert.equal(localLinkTarget("docs/README.md#current"), "docs/README.md");
    assert.equal(localLinkTarget("<docs/My%20Guide.md>"), "docs/My Guide.md");
    assert.equal(localLinkTarget("https://example.com/page"), "");
    assert.equal(localLinkTarget("#section"), "");
    assert.deepEqual(
        markdownLinks("[local](docs/README.md) ![image](assets/readme-hero.svg)").map((item) => item.target),
        ["docs/README.md", "assets/readme-hero.svg"]
    );
});

test("documentation checker reports broken relative links", () => {
    withTempDirectory((directory) => {
        const file = path.join(directory, "README.md");
        fs.writeFileSync(file, "[missing](missing.md)\n", "utf8");
        const failures = validateFile(file);
        assert.equal(failures.length, 1);
        assert.match(failures[0], /missing\.md/);
    });
});

test("documentation checker requires every L3 marker", () => {
    withTempDirectory((directory) => {
        const file = path.join(directory, "example.js");
        fs.writeFileSync(file, "/** [INPUT]: x [OUTPUT]: y [POS]: z */\n", "utf8");
        assert.match(validateSourceContract(file)[0], /\[PROTOCOL\]/);
        fs.writeFileSync(file, "/** [INPUT]: x [OUTPUT]: y [POS]: z [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md */\n", "utf8");
        assert.deepEqual(validateSourceContract(file), []);
    });
});
