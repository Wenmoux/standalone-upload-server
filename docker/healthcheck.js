#!/usr/bin/env node

const fs = require("fs");

const CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const TIMEOUT_MS = Number(process.env.PO18_HEALTH_TIMEOUT_MS || 5000);

function parseEnvLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return null;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

async function checkHttp(name, url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            body = {};
        }
        if (!response.ok || body.ok === false) throw new Error(`${name} returned ${response.status}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function checkPostgres() {
    if (!process.env.PO18_PG_URL) throw new Error("PO18_PG_URL is empty");
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.PO18_PG_URL, max: 1, connectionTimeoutMillis: TIMEOUT_MS });
    try {
        await pool.query("SELECT 1");
    } finally {
        await pool.end().catch(() => {});
    }
}

async function main() {
    const loaded = loadConfig(CONFIG_FILE);
    if (!loaded && !process.env.PO18_PG_URL) {
        await checkHttp("setup", "http://127.0.0.1:3100/health/ready");
        return;
    }

    await checkHttp("server-pg", "http://127.0.0.1:3100/health/deep");
    await checkHttp("reader", "http://127.0.0.1:3200/health/ready");
    await checkPostgres();

    if ((process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) && process.env.PO18_HEALTH_REQUIRE_BOT !== "0") {
        await checkHttp("bot", "http://127.0.0.1:3300/health/ready");
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err.message || String(err));
        process.exit(1);
    });
