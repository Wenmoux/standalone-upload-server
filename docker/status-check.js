#!/usr/bin/env node

const fs = require("fs");

const CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const DEFAULT_TIMEOUT_MS = Number(process.env.STATUS_TIMEOUT_MS || 5000);

function parseEnvLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return null;
    let value = match[2] || "";
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    return [match[1], value];
}

function loadConfig(file) {
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        const [key, value] = parsed;
        if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
    return true;
}

function timeoutSignal(ms = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function checkHttp(name, url) {
    const started = Date.now();
    const timer = timeoutSignal();
    try {
        const response = await fetch(url, { signal: timer.signal });
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            body = { raw: text.slice(0, 300) };
        }
        return {
            name,
            ok: response.ok && body.ok !== false,
            status: response.status,
            latency_ms: Date.now() - started,
            url,
            body
        };
    } catch (err) {
        return {
            name,
            ok: false,
            latency_ms: Date.now() - started,
            url,
            error: err.message || String(err)
        };
    } finally {
        timer.done();
    }
}

async function checkPostgres(name, connectionString) {
    const started = Date.now();
    if (!connectionString) {
        return { name, ok: false, error: "PO18_PG_URL is empty" };
    }
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: DEFAULT_TIMEOUT_MS });
    try {
        await pool.query("SELECT 1");
        return { name, ok: true, latency_ms: Date.now() - started };
    } catch (err) {
        return { name, ok: false, latency_ms: Date.now() - started, error: err.message || String(err) };
    } finally {
        await pool.end().catch(() => {});
    }
}

function defaults(mode) {
    if (mode === "local") {
        return {
            server: process.env.SERVER_PG_HEALTH_URL || "http://127.0.0.1:3100/health/deep",
            reader: process.env.READER_HEALTH_URL || "http://127.0.0.1:3200/health/ready",
            bot: process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready"
        };
    }
    return {
        server: process.env.SERVER_PG_HEALTH_URL || "http://server-pg:3100/health/deep",
        reader: process.env.READER_HEALTH_URL || "http://reader:3200/health/ready",
        bot: process.env.BOT_HEALTH_URL || "http://bot:3300/health/ready"
    };
}

function printResults(results) {
    for (const result of results) {
        const status = result.ok ? "OK" : "FAIL";
        const detail = result.error || `status=${result.status || "n/a"} latency=${result.latency_ms || 0}ms`;
        console.log(`${status} ${result.name}: ${detail}`);
    }
}

async function main() {
    loadConfig(CONFIG_FILE);
    const mode = process.argv[2] || "compose";

    if (mode === "http") {
        const url = process.argv[3];
        const name = process.argv[4] || "http";
        if (!url) throw new Error("Usage: status-check.js http <url> [name]");
        const result = await checkHttp(name, url);
        console.log(JSON.stringify(result));
        process.exit(result.ok ? 0 : 1);
    }

    if (mode === "pg") {
        const result = await checkPostgres(process.argv[4] || "postgres", process.argv[3] || process.env.PO18_PG_URL || "");
        console.log(JSON.stringify(result));
        process.exit(result.ok ? 0 : 1);
    }

    const urls = defaults(mode);
    const checks = [
        checkHttp("server-pg", urls.server),
        checkHttp("reader", urls.reader),
        checkPostgres("database", process.env.PO18_PG_URL || "")
    ];
    if (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) {
        checks.push(checkHttp("bot", urls.bot));
    } else {
        checks.push(Promise.resolve({ name: "bot", ok: true, error: "skipped: TELEGRAM_BOT_TOKEN is empty" }));
    }
    const results = await Promise.all(checks);
    printResults(results);
    process.exit(results.every((result) => result.ok) ? 0 : 1);
}

main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
});
