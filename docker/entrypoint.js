#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const args = process.argv.slice(2);

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
        if (process.env[key] === undefined || process.env[key] === "") {
            process.env[key] = value;
        }
    }
    return true;
}

function isServerCommand(commandArgs) {
    return commandArgs.some((arg) => /(^|[\\/])server-pg\.js$/.test(arg));
}

function shouldRunSetup(commandArgs, configLoaded) {
    if (process.env.PO18_SETUP_MODE === "1") return true;
    if (process.env.PO18_SETUP_MODE === "0") return false;
    return isServerCommand(commandArgs) && (!configLoaded || !process.env.PO18_PG_URL);
}

function run(commandArgs) {
    if (!commandArgs.length) commandArgs = ["node", "server-pg.js"];
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
        stdio: "inherit",
        env: process.env
    });
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => child.kill(signal));
    }
    child.on("exit", (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code || 0);
    });
}

const configLoaded = loadConfig(CONFIG_FILE);
if (shouldRunSetup(args, configLoaded)) {
    process.env.PO18_SETUP_CONFIG_FILE = CONFIG_FILE;
    run(["node", "docker/setup-wizard.js"]);
} else {
    run(args);
}
