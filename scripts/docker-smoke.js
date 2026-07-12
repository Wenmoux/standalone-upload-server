#!/usr/bin/env node

const { spawnSync } = require("child_process");

const suffix = `${Date.now()}-${process.pid}`;
const network = `po18-smoke-${suffix}`;
const pgName = `${network}-pg`;
const appName = `${network}-app`;
const image = process.env.PO18_TEST_APP_IMAGE || "wenmoux/reader:v2.0";
const expectedDigest = process.env.PO18_EXPECTED_IMAGE_DIGEST || "";
const pgImage = process.env.PO18_TEST_PG_IMAGE || "postgres:16-alpine";
const password = "po18-smoke-db-pass";

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
    return String(result.stdout || "").trim();
}

function succeeds(command, args) {
    return spawnSync(command, args, { stdio: "ignore", shell: false }).status === 0;
}

function githubCommandEscape(value) {
    return String(value || "")
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
}

function smokeFailureSummary(value = "") {
    const lines = String(value || "")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    return lines.slice(-60).join("\n").slice(-9000) || "Docker smoke failed without diagnostic output";
}

function smokeApplicationEnvironment() {
    return [
        "NODE_ENV=production",
        `PO18_PG_URL=postgres://po18:${password}@${pgName}:5432/po18`,
        "PO18_UPLOAD_ADMIN_USER=smoke-admin",
        "PO18_UPLOAD_ADMIN_PASSWORD=smoke-admin-password",
        "PO18_UPLOAD_SESSION_SECRET=smoke-session-secret-with-sufficient-length",
        "PO18_UPLOAD_API_TOKEN=smoke-upload-token",
        "PO18_BOT_API_TOKEN=smoke-bot-token",
        "PO18_METRICS_TOKEN=smoke-metrics-token",
        "PO18_CORS_ORIGINS=http://127.0.0.1:3100,http://127.0.0.1:3200"
    ];
}

function containerLogs() {
    const result = spawnSync("docker", ["logs", "--tail", "160", appName], {
        encoding: "utf8",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
    });
    return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function cleanup() {
    spawnSync("docker", ["rm", "-f", appName, pgName], { stdio: "ignore" });
    spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
}

async function waitUntil(check, label, attempts = 90) {
    for (let index = 0; index < attempts; index += 1) {
        if (check()) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`${label} did not become ready`);
}

async function main() {
    run("docker", ["image", "inspect", image], { capture: true });
    cleanup();
    run("docker", ["network", "create", network]);
    run(
        "docker",
        [
            "run",
            "-d",
            "--name",
            pgName,
            "--network",
            network,
            "-e",
            "POSTGRES_USER=po18",
            "-e",
            `POSTGRES_PASSWORD=${password}`,
            "-e",
            "POSTGRES_DB=po18",
            pgImage
        ],
        { capture: true }
    );
    await waitUntil(() => succeeds("docker", ["exec", pgName, "pg_isready", "-U", "po18", "-d", "po18"]), "PostgreSQL");

    const appArgs = ["run", "-d", "--name", appName, "--network", network, "--tmpfs", "/config"];
    for (const value of smokeApplicationEnvironment()) appArgs.push("-e", value);
    if (expectedDigest) appArgs.push("-e", `PO18_IMAGE_DIGEST=${expectedDigest}`);
    appArgs.push(image);
    run("docker", appArgs, { capture: true });
    await waitUntil(() => succeeds("docker", ["exec", appName, "wget", "-qO-", "http://127.0.0.1:3100/health/ready"]), "application");

    const browserCheck = `
      const base = "http://127.0.0.1:3100";
      const expectedDigest = ${JSON.stringify(expectedDigest)};
      (async () => {
        const login = await fetch(base + "/admin-api/auth/login", {
          method: "POST", headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ username: "smoke-admin", password: "smoke-admin-password" })
        });
        const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
        const rejected = await fetch(base + "/admin-api/auth/logout", { method: "POST", headers: { cookie, origin: "https://invalid.example" } });
        const me = await fetch(base + "/admin-api/auth/me", { headers: { cookie } });
        const logout = await fetch(base + "/admin-api/auth/logout", { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ reason: "smoke test" }) });
        const payload = await me.json();
        const versionResponse = await fetch(base + "/health/version");
        const version = await versionResponse.json();
        const identityOk = /^[a-f0-9]{64}$/i.test(version.source_hash || "") && Boolean(version.immutable_image);
        const digestOk = !expectedDigest || version.image_digest === expectedDigest;
        const checks = {
          login_status: login.status,
          cookie: Boolean(cookie),
          rejected_origin_status: rejected.status,
          username: payload.user?.username || "",
          logout_status: logout.status,
          version_status: versionResponse.status,
          identity_ok: identityOk,
          digest_ok: digestOk
        };
        if (login.status !== 200 || !cookie || rejected.status !== 403 || payload.user?.username !== "smoke-admin" || logout.status !== 200 || !identityOk || !digestOk) {
          console.error(JSON.stringify({ checks, version }));
          process.exit(1);
        }
      })().catch((error) => {
        console.error(error?.stack || error?.message || String(error));
        process.exit(1);
      });
    `;
    run("docker", ["exec", appName, "node", "-e", browserCheck], { capture: true });

    const databaseStateArgs = [
        "exec",
        pgName,
        "psql",
        "-U",
        "po18",
        "-d",
        "po18",
        "-Atc",
        "SELECT (SELECT COUNT(*) FROM schema_migrations) || '|' || (SELECT COUNT(*) FROM admin_audit_logs);"
    ];
    let databaseState = "";
    let migrationCount = 0;
    let auditCount = 0;
    await waitUntil(
        () => {
            try {
                databaseState = run("docker", databaseStateArgs, { capture: true });
                [migrationCount, auditCount] = databaseState.split("|").map(Number);
                return migrationCount >= 9 && auditCount >= 2;
            } catch {
                return false;
            }
        },
        "smoke database audit state",
        20
    );
    const immutable = spawnSync(
        "docker",
        [
            "exec",
            pgName,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "po18",
            "-d",
            "po18",
            "-c",
            "UPDATE admin_audit_logs SET reason='tampered' WHERE id=(SELECT MIN(id) FROM admin_audit_logs);"
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (immutable.status === 0 || !/append-only/.test(`${immutable.stdout || ""}${immutable.stderr || ""}`)) {
        throw new Error("admin audit immutability check failed");
    }
    console.log(`Docker smoke passed: migrations=${migrationCount}, audit_rows=${auditCount}`);
}

if (require.main === module) {
    main()
        .catch((error) => {
            const message = error.message || String(error);
            const logs = containerLogs();
            if (logs) console.error(logs);
            console.error(message);
            if (String(process.env.GITHUB_ACTIONS || "").toLowerCase() === "true") {
                console.error(`::error title=Docker smoke failed::${githubCommandEscape(smokeFailureSummary(`${message}\n${logs}`))}`);
            }
            process.exitCode = 1;
        })
        .finally(cleanup);
}

module.exports = {
    githubCommandEscape,
    smokeApplicationEnvironment,
    smokeFailureSummary
};
