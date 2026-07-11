#!/usr/bin/env node

const fs = require("fs");
const { createProcessSupervisor } = require("./process-supervisor");
let logEvent = () => {};
try {
    ({ logEvent } = require("./structured-log"));
} catch {
    // Structured logging is optional for compatibility with older images.
}

const CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const LOG_FILE = process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
const MAX_LOG_BYTES = Number(process.env.PO18_RUNTIME_LOG_MAX_BYTES || 1024 * 1024);

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

function setDefault(key, value) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
}

function prepareLogFile() {
    try {
        fs.mkdirSync(require("path").dirname(LOG_FILE), { recursive: true });
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
            fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
        }
        fs.appendFileSync(LOG_FILE, `\n[${new Date().toISOString()}] [run-all] starting\n`);
    } catch {
        // Logging must never prevent the app from starting.
    }
    logEvent("info", "run-all", "starting", { config_file: CONFIG_FILE, runtime_log_file: LOG_FILE });
}

function appendLog(name, chunk, stream) {
    const text = chunk.toString();
    stream.write(chunk);
    try {
        const prefix = `[${new Date().toISOString()}] [${name}] `;
        const formatted = text
            .split(/\r?\n/)
            .map((line, index, rows) => (index === rows.length - 1 && line === "" ? "" : `${prefix}${line}`))
            .filter(Boolean)
            .join("\n");
        if (formatted) fs.appendFileSync(LOG_FILE, `${formatted}\n`);
    } catch {
        // Ignore log file write failures.
    }
}

async function main() {
    const loaded = loadConfig(CONFIG_FILE);
    prepareLogFile();
    let shuttingDown = false;
    let supervisor;

    async function shutdown(code = 0) {
        if (shuttingDown) return;
        shuttingDown = true;
        await supervisor?.stopAll();
        process.exit(code);
    }

    supervisor = createProcessSupervisor({
        baseDelayMs: process.env.PO18_CHILD_RESTART_BASE_MS,
        maxDelayMs: process.env.PO18_CHILD_RESTART_MAX_MS,
        stableMs: process.env.PO18_CHILD_RESTART_STABLE_MS,
        maxRestarts: process.env.PO18_CHILD_RESTART_LIMIT,
        stopTimeoutMs: process.env.PO18_CHILD_STOP_TIMEOUT_MS,
        appendLog,
        logEvent,
        onFatal: ({ code }) => shutdown(code || 1)
    });

    if (!loaded && !process.env.PO18_PG_URL) {
        console.log(`[run-all] no config found at ${CONFIG_FILE}; starting setup wizard`);
        logEvent("warn", "run-all", "missing-config", { config_file: CONFIG_FILE });
        supervisor.start("setup", ["node", "docker/setup-wizard.js"], {
            PO18_SETUP_CONFIG_FILE: CONFIG_FILE,
            PO18_SETUP_HOST: process.env.PO18_SETUP_HOST || process.env.PO18_UPLOAD_HOST || "0.0.0.0",
            PO18_SETUP_PORT: process.env.PO18_SETUP_PORT || process.env.PO18_UPLOAD_PORT || "3100"
        }, { restart: false });
    } else {
        setDefault("PO18_UPLOAD_HOST", "0.0.0.0");
        setDefault("PO18_UPLOAD_PORT", "3100");
        setDefault("PO18_READER_HOST", "0.0.0.0");
        setDefault("PO18_READER_PORT", "3200");
        setDefault("PO18_API_BASE", "http://127.0.0.1:3100");
        setDefault("PO18_SERVER_URL", "http://127.0.0.1:3100");
        setDefault("BOT_HEALTH_HOST", "0.0.0.0");
        setDefault("BOT_HEALTH_PORT", "3300");

        supervisor.start("server-pg", ["node", "server-pg.js"]);
        supervisor.start("reader", ["node", "cirno-src/reader-server.js"]);

        if (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) {
            supervisor.start("bot", ["node", "bot/telegram-bot.js"]);
        } else {
            console.log("[run-all] TELEGRAM_BOT_TOKEN is empty; bot not started");
            logEvent("info", "run-all", "bot-skipped", { reason: "TELEGRAM_BOT_TOKEN is empty" });
        }
    }

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => shutdown(0));
    }
}

if (require.main === module) main().catch((err) => {
    console.error(err.stack || err.message || String(err));
    process.exit(1);
});

module.exports = { loadConfig, main, parseEnvLine };
