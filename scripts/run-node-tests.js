/**
 * [INPUT]: 依赖 tests 目录、Node.js test runner、可选 c8 和覆盖率门槛参数
 * [OUTPUT]: 提供跨平台测试文件发现/命令构造，并执行普通或覆盖率回归套件
 * [POS]: scripts 的根测试组合器，消除 shell glob 差异并确保 CI 与本地发现同一批测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function discoverTestFiles(root = projectRoot) {
    const testsDir = path.join(root, "tests");
    return fs
        .readdirSync(testsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
        .map((entry) => path.join(testsDir, entry.name))
        .sort((left, right) => left.localeCompare(right));
}

function buildTestCommand({ root = projectRoot, coverage = false, node = process.execPath } = {}) {
    const testArgs = ["--test", ...discoverTestFiles(root)];
    if (!coverage) return { command: node, args: testArgs };
    return {
        command: node,
        args: [
            path.join(root, "node_modules", "c8", "bin", "c8.js"),
            "--all",
            "--include",
            "services/**/*.js",
            "--include",
            "routes/**/*.js",
            "--exclude",
            "services/tts.js",
            "--check-coverage",
            "--lines",
            "35",
            "--functions",
            "35",
            "--branches",
            "30",
            "--statements",
            "35",
            node,
            ...testArgs
        ]
    };
}

function run(options = {}) {
    const root = options.root || projectRoot;
    const coverage = options.coverage ?? process.argv.includes("--coverage");
    const command = buildTestCommand({ root, coverage, node: options.node || process.execPath });
    const result = (options.spawnSyncImpl || spawnSync)(command.command, command.args, {
        cwd: root,
        stdio: "inherit",
        env: options.env || process.env
    });
    if (result.error) throw result.error;
    return result.status === null ? 1 : result.status || 0;
}

if (require.main === module) {
    try {
        process.exitCode = run();
    } catch (error) {
        console.error(`[test-runner] ${error.message || String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { buildTestCommand, discoverTestFiles, run };
