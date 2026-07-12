/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供根测试发现器和覆盖率门槛的自动化回归断言
 * [POS]: tests 的根测试发现器和覆盖率门槛守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const path = require("path");
const test = require("node:test");
const { buildTestCommand, discoverTestFiles } = require("../scripts/run-node-tests");

const root = path.join(__dirname, "..");

test("test runner expands test files before invoking Node on every platform", () => {
    const files = discoverTestFiles(root);
    assert.ok(files.length >= 70);
    assert.ok(files.every((file) => path.isAbsolute(file) && file.endsWith(".test.js")));
    assert.ok(files.some((file) => file.endsWith(`${path.sep}test-runner-script.test.js`)));

    const command = buildTestCommand({ root, coverage: false, node: "node-runtime" });
    assert.equal(command.command, "node-runtime");
    assert.equal(command.args[0], "--test");
    assert.equal(command.args.includes("tests/*.test.js"), false);
    assert.equal(command.args.length, files.length + 1);
});

test("coverage runner uses the same explicit file list behind c8", () => {
    const command = buildTestCommand({ root, coverage: true, node: "node-runtime" });
    assert.equal(command.command, "node-runtime");
    assert.ok(command.args[0].endsWith(path.join("node_modules", "c8", "bin", "c8.js")));
    assert.ok(command.args.includes("--check-coverage"));
    assert.ok(command.args.includes("node-runtime"));
    assert.ok(command.args.includes("--test"));
    assert.equal(command.args.includes("tests/*.test.js"), false);
});
