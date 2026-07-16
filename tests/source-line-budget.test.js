/**
 * [INPUT]: 依赖 node:test、assert、项目源码树与明确的生成/历史目录排除表
 * [OUTPUT]: 提供维护源码单文件不超过 800 行的全仓回归门禁
 * [POS]: tests 的可维护性预算守卫，把 AGENTS/CLAUDE 规模约束变成 CI 可执行事实，不扫描备份或生成产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const fs = require("fs/promises");
const path = require("path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const MAX_LINES = 800;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".css", ".less", ".py", ".ps1", ".sh"]);
const EXCLUDED_DIRECTORIES = new Set([
    ".codex",
    ".git",
    "backups",
    "coverage",
    "dist",
    "dist-reader",
    "node_modules",
    "public",
    "test-results",
    "tmp"
]);

async function collectSourceFiles(directory, files = []) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRECTORIES.has(entry.name)) await collectSourceFiles(path.join(directory, entry.name), files);
            continue;
        }
        if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(path.join(directory, entry.name));
        }
    }
    return files;
}

function lineCount(text) {
    const lines = String(text).split(/\r?\n/);
    return lines.length - (lines.at(-1) === "" ? 1 : 0);
}

test("maintained source files stay within the 800 line budget", async () => {
    const files = await collectSourceFiles(ROOT);
    const oversized = [];
    for (const file of files) {
        const lines = lineCount(await fs.readFile(file, "utf8"));
        if (lines > MAX_LINES) oversized.push(`${path.relative(ROOT, file)} (${lines})`);
    }
    assert.deepEqual(oversized, [], `split oversized maintained sources:\n${oversized.join("\n")}`);
});
