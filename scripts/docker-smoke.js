#!/usr/bin/env node

const { spawnSync } = require("child_process");

const suffix = `${Date.now()}-${process.pid}`;
const network = `po18-smoke-${suffix}`;
const pgName = `${network}-pg`;
const appName = `${network}-app`;
const image = process.env.PO18_TEST_APP_IMAGE || "wenmoux/reader:v2.0";
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
    run("docker", [
        "run", "-d", "--name", pgName, "--network", network,
        "-e", "POSTGRES_USER=po18", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=po18",
        pgImage
    ], { capture: true });
    await waitUntil(() => succeeds("docker", ["exec", pgName, "pg_isready", "-U", "po18", "-d", "po18"]), "PostgreSQL");

    run("docker", [
        "run", "-d", "--name", appName, "--network", network, "--tmpfs", "/config",
        "-e", "NODE_ENV=production",
        "-e", `PO18_PG_URL=postgres://po18:${password}@${pgName}:5432/po18`,
        "-e", "PO18_UPLOAD_ADMIN_USER=smoke-admin",
        "-e", "PO18_UPLOAD_ADMIN_PASSWORD=smoke-admin-password",
        "-e", "PO18_UPLOAD_SESSION_SECRET=smoke-session-secret-with-sufficient-length",
        "-e", "PO18_UPLOAD_API_TOKEN=smoke-upload-token",
        "-e", "PO18_BOT_API_TOKEN=smoke-bot-token",
        "-e", "PO18_CORS_ORIGINS=http://127.0.0.1:3100,http://127.0.0.1:3200",
        image
    ], { capture: true });
    await waitUntil(
        () => succeeds("docker", ["exec", appName, "wget", "-qO-", "http://127.0.0.1:3100/health/ready"]),
        "application"
    );

    const browserCheck = `
      const base = "http://127.0.0.1:3100";
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
        if (login.status !== 200 || !cookie || rejected.status !== 403 || payload.user?.username !== "smoke-admin" || logout.status !== 200) process.exit(1);
      })().catch(() => process.exit(1));
    `;
    run("docker", ["exec", appName, "node", "-e", browserCheck]);

    const databaseState = run("docker", [
        "exec", pgName, "psql", "-U", "po18", "-d", "po18", "-Atc",
        "SELECT (SELECT COUNT(*) FROM schema_migrations) || '|' || (SELECT COUNT(*) FROM admin_audit_logs);"
    ], { capture: true });
    const [migrationCount, auditCount] = databaseState.split("|").map(Number);
    if (migrationCount < 9 || auditCount < 2) throw new Error(`unexpected smoke database state: ${databaseState}`);
    const immutable = spawnSync("docker", [
        "exec", pgName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "po18", "-d", "po18", "-c",
        "UPDATE admin_audit_logs SET reason='tampered' WHERE id=(SELECT MIN(id) FROM admin_audit_logs);"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (immutable.status === 0 || !/append-only/.test(`${immutable.stdout || ""}${immutable.stderr || ""}`)) {
        throw new Error("admin audit immutability check failed");
    }
    console.log(`Docker smoke passed: migrations=${migrationCount}, audit_rows=${auditCount}`);
}

main()
    .catch((error) => {
        try { run("docker", ["logs", "--tail", "160", appName]); } catch {}
        console.error(error.message || String(error));
        process.exitCode = 1;
    })
    .finally(cleanup);
