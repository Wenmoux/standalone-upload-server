#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");

const network = `po18-pg-test-${Date.now()}`;
const pgName = `${network}-db`;
const image = process.env.PO18_TEST_APP_IMAGE || "wenmoux/reader:v1.0";
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
    return result.stdout || "";
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
    run("docker", [
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
    ]);
}

main()
    .catch((err) => {
        console.error(err.message || String(err));
        process.exitCode = 1;
    })
    .finally(cleanup);
