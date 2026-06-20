#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");

const DEFAULT_CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const DEFAULT_BACKUP_DIR = process.env.PO18_BACKUP_DIR || "/config/backups";
const DEFAULT_KEEP = positiveInt(process.env.PO18_BACKUP_KEEP, 8);
const DEFAULT_TIMEOUT_MS = positiveInt(process.env.PO18_BACKUP_TIMEOUT_MS, 30 * 60 * 1000);
const DEFAULT_UPLOAD_MAX_BYTES = positiveInt(process.env.PO18_BACKUP_UPLOAD_MAX_BYTES, 1024 * 1024 * 1024);

function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        "-",
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds())
    ].join("");
}

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

function loadConfigIntoEnv(configFile = DEFAULT_CONFIG_FILE) {
    if (!fs.existsSync(configFile)) return false;
    const text = fs.readFileSync(configFile, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        const [key, value] = parsed;
        if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
    return true;
}

function redactPgUrl(connectionString) {
    const text = String(connectionString || "");
    try {
        const url = new URL(text);
        if (url.password) url.password = "***";
        return url.toString();
    } catch {
        return text.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:***@");
    }
}

function pgDumpConnection(connectionString) {
    const env = { ...process.env };
    try {
        const url = new URL(connectionString);
        if (url.password) {
            env.PGPASSWORD = decodeURIComponent(url.password);
            url.password = "";
        }
        return { arg: url.toString(), env };
    } catch {
        return { arg: connectionString, env };
    }
}

function safeBackupUploadName(value = "") {
    const base = path.basename(String(value || "upload.dump")).replace(/[^0-9A-Za-z._-]+/g, "_").slice(0, 80);
    return base && !base.endsWith(".json") ? base : "upload.dump";
}

function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const timeoutMs = positiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
        const child = spawn(command, args, {
            env: options.env || process.env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            if (err.code === "ENOENT") {
                reject(new Error(`${command} not found. Install postgresql-client in the image.`));
                return;
            }
            reject(err);
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(`${command} failed${signal ? ` by ${signal}` : ` with ${code}`}: ${stderr || stdout}`.slice(0, 1200)));
        });
    });
}

async function writeMeta(file, meta) {
    await fsp.writeFile(`${file}.json`, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function readMeta(file) {
    try {
        return JSON.parse(await fsp.readFile(`${file}.json`, "utf8"));
    } catch {
        return null;
    }
}

async function pruneBackups({ backupDir = DEFAULT_BACKUP_DIR, prefix = "po18-pg-", keep = DEFAULT_KEEP } = {}) {
    const entries = await fsp.readdir(backupDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || entry.name.endsWith(".json") || !entry.name.startsWith(prefix)) continue;
        const file = path.join(backupDir, entry.name);
        const stat = await fsp.stat(file).catch(() => null);
        if (stat) files.push({ file, mtimeMs: stat.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const removed = [];
    for (const item of files.slice(Math.max(keep, 0))) {
        await fsp.rm(item.file, { force: true }).catch(() => {});
        await fsp.rm(`${item.file}.json`, { force: true }).catch(() => {});
        removed.push(path.basename(item.file));
    }
    return removed;
}

async function createPostgresBackup(options = {}) {
    const configFile = options.configFile || DEFAULT_CONFIG_FILE;
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    const keep = positiveInt(options.keep, DEFAULT_KEEP);
    loadConfigIntoEnv(configFile);
    const connectionString = options.connectionString || process.env.PO18_PG_URL || "";
    if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("PO18_PG_URL is empty or invalid");

    await fsp.mkdir(backupDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const file = path.join(backupDir, `po18-pg-${timestamp()}.dump`);
    const { arg, env } = pgDumpConnection(connectionString);
    await runProcess("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", file, arg], {
        env,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
    });
    const stat = await fsp.stat(file);
    const meta = {
        type: "postgres",
        created_at: createdAt,
        file: path.basename(file),
        path: file,
        bytes: stat.size,
        database: redactPgUrl(connectionString),
        format: "custom",
        keep
    };
    await writeMeta(file, meta);
    meta.removed = await pruneBackups({ backupDir, prefix: "po18-pg-", keep });
    return meta;
}

async function createUploadedPostgresBackup(readable, options = {}) {
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    const maxBytes = positiveInt(options.maxBytes, DEFAULT_UPLOAD_MAX_BYTES);
    await fsp.mkdir(backupDir, { recursive: true });
    const originalName = safeBackupUploadName(options.originalName);
    const file = path.join(backupDir, `po18-pg-upload-${timestamp()}-${originalName}`);
    let written = 0;
    const limiter = new Transform({
        transform(chunk, encoding, callback) {
            written += chunk.length;
            if (written > maxBytes) {
                callback(new Error(`backup upload exceeds ${maxBytes} bytes`));
                return;
            }
            callback(null, chunk);
        }
    });
    try {
        await pipeline(readable, limiter, fs.createWriteStream(file, { flags: "wx" }));
    } catch (err) {
        await fsp.rm(file, { force: true }).catch(() => {});
        throw err;
    }
    const stat = await fsp.stat(file);
    if (!stat.size) {
        await fsp.rm(file, { force: true }).catch(() => {});
        throw new Error("uploaded backup is empty");
    }
    const meta = {
        type: "postgres",
        source: "upload",
        created_at: new Date().toISOString(),
        file: path.basename(file),
        path: file,
        bytes: stat.size,
        database: "",
        format: "custom",
        original_name: originalName
    };
    await writeMeta(file, meta);
    return meta;
}

async function restorePostgresBackup(options = {}) {
    const configFile = options.configFile || DEFAULT_CONFIG_FILE;
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    loadConfigIntoEnv(configFile);
    const connectionString = options.connectionString || process.env.PO18_PG_URL || "";
    if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("PO18_PG_URL is empty or invalid");

    const file = resolveBackupFile(options.file || options.fileName, backupDir);
    await fsp.access(file);
    const stat = await fsp.stat(file);
    const meta = (await readMeta(file)) || {};
    if (meta.type && meta.type !== "postgres") throw new Error("only postgres backups can be restored");

    const before = options.skipPreBackup
        ? null
        : await createPostgresBackup({
              configFile,
              backupDir,
              keep: options.keep,
              timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
          });
    const { arg, env } = pgDumpConnection(connectionString);
    const result = await runProcess(
        "pg_restore",
        ["--clean", "--if-exists", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", arg, file],
        { env, timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS }
    );
    return {
        success: true,
        restored_at: new Date().toISOString(),
        file: path.basename(file),
        bytes: stat.size,
        database: redactPgUrl(connectionString),
        pre_restore_backup: before,
        stderr: String(result.stderr || "").slice(-2000)
    };
}

async function createConfigBackup(options = {}) {
    const configFile = options.configFile || DEFAULT_CONFIG_FILE;
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    await fsp.mkdir(backupDir, { recursive: true });
    await fsp.access(configFile);
    const file = path.join(backupDir, `po18-config-${timestamp()}.env`);
    await fsp.copyFile(configFile, file);
    const stat = await fsp.stat(file);
    const meta = {
        type: "config",
        created_at: new Date().toISOString(),
        file: path.basename(file),
        path: file,
        bytes: stat.size
    };
    await writeMeta(file, meta);
    await pruneBackups({ backupDir, prefix: "po18-config-", keep: positiveInt(options.keep, DEFAULT_KEEP) });
    return meta;
}

async function createDiagnosticsBackup(diagnostics, options = {}) {
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    await fsp.mkdir(backupDir, { recursive: true });
    const file = path.join(backupDir, `po18-diagnostics-${timestamp()}.json`);
    await fsp.writeFile(file, `${JSON.stringify(diagnostics || {}, null, 2)}\n`, "utf8");
    const stat = await fsp.stat(file);
    const meta = {
        type: "diagnostics",
        created_at: new Date().toISOString(),
        file: path.basename(file),
        path: file,
        bytes: stat.size
    };
    await writeMeta(file, meta);
    await pruneBackups({ backupDir, prefix: "po18-diagnostics-", keep: positiveInt(options.keep, DEFAULT_KEEP) });
    return meta;
}

async function listBackups(options = {}) {
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    const entries = await fsp.readdir(backupDir, { withFileTypes: true }).catch(() => []);
    const rows = [];
    for (const entry of entries) {
        if (!entry.isFile() || entry.name.endsWith(".json") || !entry.name.startsWith("po18-")) continue;
        const file = path.join(backupDir, entry.name);
        const stat = await fsp.stat(file).catch(() => null);
        if (!stat) continue;
        const meta = (await readMeta(file)) || {};
        rows.push({
            type: meta.type || (entry.name.includes("-pg-") ? "postgres" : entry.name.includes("-config-") ? "config" : "diagnostics"),
            file: entry.name,
            bytes: stat.size,
            created_at: meta.created_at || stat.mtime.toISOString(),
            database: meta.database || "",
            format: meta.format || "",
            removed: meta.removed || []
        });
    }
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows;
}

function resolveBackupFile(fileName, backupDir = DEFAULT_BACKUP_DIR) {
    const safeName = path.basename(String(fileName || ""));
    if (!safeName || safeName !== String(fileName || "") || !safeName.startsWith("po18-") || safeName.endsWith(".json")) {
        throw new Error("invalid backup file");
    }
    const resolved = path.resolve(backupDir, safeName);
    const root = path.resolve(backupDir);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("invalid backup path");
    return resolved;
}

async function cli() {
    const command = process.argv[2] || "create";
    if (command === "list") {
        console.log(JSON.stringify(await listBackups(), null, 2));
        return;
    }
    if (command === "config") {
        console.log(JSON.stringify(await createConfigBackup(), null, 2));
        return;
    }
    if (command === "restore") {
        console.log(JSON.stringify(await restorePostgresBackup({ file: process.argv[3] || "" }), null, 2));
        return;
    }
    if (command === "create" || command === "pg") {
        console.log(JSON.stringify(await createPostgresBackup(), null, 2));
        return;
    }
    throw new Error("Usage: backup-pg.js [create|pg|config|list|restore FILE]");
}

if (require.main === module) {
    cli().catch((err) => {
        console.error(err.message || String(err));
        process.exit(1);
    });
}

module.exports = {
    DEFAULT_BACKUP_DIR,
    createConfigBackup,
    createDiagnosticsBackup,
    createPostgresBackup,
    createUploadedPostgresBackup,
    listBackups,
    loadConfigIntoEnv,
    redactPgUrl,
    restorePostgresBackup,
    resolveBackupFile
};
