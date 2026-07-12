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
