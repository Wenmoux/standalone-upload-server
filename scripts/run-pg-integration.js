#!/usr/bin/env node

/**
 * [INPUT]: 依赖 Docker、PostgreSQL 16、候选应用镜像、PG 集成测试与搜索基准配置
 * [OUTPUT]: 启动/清理隔离数据库并执行 migration、领域流和查询计划验证，输出可读失败尾部
 * [POS]: scripts 的真实数据库验收编排器，补足替身测试对 SQL/锁/计划行为的盲区
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const { spawnSync } = require("child_process");
const path = require("path");

const network = `po18-pg-test-${Date.now()}`;
const pgName = `${network}-db`;
const image = process.env.PO18_TEST_APP_IMAGE || "wenmoux/reader:v2.0";
const pgImage = process.env.PO18_TEST_PG_IMAGE || "postgres:16-alpine";
const password = "po18-test-pass";
const database = "po18";
const pgUrl = `postgres://postgres:${password}@${pgName}:5432/${database}`;
const cwd = process.cwd();

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
        encoding: "utf8",
        shell: false
    });
    if (result.status !== 0) {
        const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
        throw new Error(output || `${command} ${args.join(" ")} failed with ${result.status}`);
    }
    if (options.capture && options.print) {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
    }
    return result.stdout || "";
}

function githubCommandEscape(value) {
    return String(value || "")
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
}

function pgFailureSummary(value = "") {
    const lines = String(value || "")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    return lines.slice(-60).join("\n").slice(-9000) || "PostgreSQL integration failed without diagnostic output";
}

function cleanup() {
    spawnSync("docker", ["rm", "-f", pgName], { stdio: "ignore" });
    spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
}

async function main() {
    try {
        run("docker", ["image", "inspect", image], { capture: true });
    } catch {
        throw new Error(`Docker image ${image} not found. Run npm run docker:build first or set PO18_TEST_APP_IMAGE.`);
    }

    cleanup();
    run("docker", ["network", "create", network]);
    run("docker", [
        "run",
        "-d",
        "--name",
        pgName,
        "--network",
        network,
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "-e",
        `POSTGRES_DB=${database}`,
        pgImage
    ]);

    let ready = false;
    for (let i = 0; i < 60; i++) {
        const result = spawnSync("docker", ["exec", pgName, "pg_isready", "-U", "postgres", "-d", database], {
            stdio: "ignore"
        });
        if (result.status === 0) {
            ready = true;
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("temporary PostgreSQL did not become ready");

    const mount = `${path.resolve(cwd)}:/src`;
    run(
        "docker",
        [
            "run",
            "--rm",
            "--network",
            network,
            "-v",
            mount,
            "-w",
            "/src",
            "-e",
            "NODE_PATH=/app/node_modules",
            "-e",
            `PO18_TEST_PG_URL=${pgUrl}`,
            "-e",
            `PO18_PG_URL=${pgUrl}`,
            "-e",
            "PO18_BACKUP_DIR=/tmp/po18-backups",
            image,
            "sh",
            "-lc",
            "node --test tests/pg-flows.test.js"
        ],
        { capture: true, print: true }
    );
    run(
        "docker",
        [
            "run",
            "--rm",
            "--network",
            network,
            "-v",
            mount,
            "-w",
            "/src",
            "-e",
            "NODE_PATH=/app/node_modules",
            "-e",
            `PO18_TEST_PG_URL=${pgUrl}`,
            image,
            "sh",
            "-lc",
            "node scripts/search-benchmark.js --output tmp/search-benchmark-result.json"
        ],
        { capture: true, print: true }
    );
}

if (require.main === module) {
    main()
        .catch((err) => {
            const message = err.message || String(err);
            console.error(message);
            if (String(process.env.GITHUB_ACTIONS || "").toLowerCase() === "true") {
                console.error(`::error title=PostgreSQL integration failed::${githubCommandEscape(pgFailureSummary(message))}`);
            }
            process.exitCode = 1;
        })
        .finally(cleanup);
}

module.exports = { cleanup, githubCommandEscape, main, pgFailureSummary, run };
