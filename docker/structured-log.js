const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.PO18_LOG_DIR || "/config/logs";
const REQUEST_LOG_FILE = process.env.PO18_REQUEST_LOG_FILE || path.join(LOG_DIR, "requests.jsonl");
const SLOW_LOG_FILE = process.env.PO18_SLOW_LOG_FILE || path.join(LOG_DIR, "slow-requests.jsonl");
const EVENT_LOG_FILE = process.env.PO18_EVENT_LOG_FILE || path.join(LOG_DIR, "events.jsonl");
const MAX_JSONL_BYTES = Number(process.env.PO18_JSONL_LOG_MAX_BYTES || 5 * 1024 * 1024);
const SECRET_PARAM_RE = /(token|password|passwd|pwd|secret|key|cookie|authorization|pg_url|database_url)/i;

function positiveMs(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function ensureDir(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}

function rotateIfLarge(file, maxBytes = MAX_JSONL_BYTES) {
    if (!maxBytes || maxBytes <= 0) return;
    try {
        if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
            fs.rmSync(`${file}.1`, { force: true });
            fs.renameSync(file, `${file}.1`);
        }
    } catch {
        // Logging must not affect application traffic.
    }
}

function appendJsonLine(file, payload) {
    try {
        ensureDir(file);
        rotateIfLarge(file);
        fs.appendFileSync(file, `${JSON.stringify(payload)}\n`);
    } catch {
        // Ignore log write failures.
    }
}

function redactPath(input) {
    const text = String(input || "");
    try {
        const url = new URL(text, "http://local");
        for (const key of [...url.searchParams.keys()]) {
            if (SECRET_PARAM_RE.test(key)) url.searchParams.set(key, "<redacted>");
        }
        const search = url.searchParams.toString();
        return `${url.pathname}${search ? `?${search}` : ""}`;
    } catch {
        return text
            .replace(/([?&][^=]*(?:token|password|passwd|pwd|secret|key|cookie)[^=]*=)[^&\s]+/gi, "$1<redacted>")
            .slice(0, 800);
    }
}

function levelFor(statusCode, durationMs, slowMs) {
    if (statusCode >= 500) return "error";
    if (statusCode >= 400 || durationMs >= slowMs) return "warn";
    return "info";
}

function requestActor(req) {
    if (req.session?.adminUser?.username) return { type: "admin", id: String(req.session.adminUser.username) };
    if (req.session?.readerUser?.id) return { type: "reader", id: String(req.session.readerUser.id) };
    if (req.readerUser?.id) return { type: "reader", id: String(req.readerUser.id) };
    if (req.headers["x-bot-api-token"]) return { type: "bot-api", id: "<token-present>" };
    return { type: "anonymous", id: "" };
}

function createRequestLogger(options = {}) {
    const service = options.service || "app";
    const slowMs = positiveMs(options.slowMs ?? process.env.PO18_SLOW_REQUEST_MS, 800);
    const requestLogFile = options.requestLogFile || REQUEST_LOG_FILE;
    const slowLogFile = options.slowLogFile || SLOW_LOG_FILE;
    const enabled = String(process.env.PO18_REQUEST_LOG_ENABLED || "1") !== "0";
    const skip = typeof options.skip === "function" ? options.skip : null;

    return function requestLogger(req, res, next) {
        const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
        const startedAt = Date.now();
        req.requestId = requestId;
        res.setHeader("X-Request-Id", requestId);
        res.on("finish", () => {
            if (!enabled || (skip && skip(req, res))) return;
            const durationMs = Date.now() - startedAt;
            const entry = {
                ts: new Date().toISOString(),
                type: "http_request",
                level: levelFor(res.statusCode || 0, durationMs, slowMs),
                service,
                request_id: requestId,
                method: req.method,
                path: redactPath(req.originalUrl || req.url || ""),
                status: res.statusCode || 0,
                duration_ms: durationMs,
                actor: requestActor(req)
            };
            appendJsonLine(requestLogFile, entry);
            if (slowMs > 0 && durationMs >= slowMs) appendJsonLine(slowLogFile, entry);
        });
        next();
    };
}

function logEvent(level, service, event, fields = {}) {
    appendJsonLine(EVENT_LOG_FILE, {
        ts: new Date().toISOString(),
        type: "event",
        level: level || "info",
        service: service || "app",
        event: event || "event",
        ...fields
    });
}

function readJsonLinesTail(file, options = {}) {
    const maxBytes = Number(options.maxBytes || 256000);
    const limit = Number(options.limit || 200);
    try {
        if (!fs.existsSync(file)) return [];
        const stat = fs.statSync(file);
        const length = Math.min(stat.size, maxBytes);
        const fd = fs.openSync(file, "r");
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
        fs.closeSync(fd);
        return buffer
            .toString("utf8")
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function topSlowRequests(file = SLOW_LOG_FILE, limit = 20) {
    return readJsonLinesTail(file, { limit: Math.max(limit * 8, 100), maxBytes: 512000 })
        .filter((item) => Number.isFinite(Number(item.duration_ms)))
        .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
        .slice(0, limit)
        .map((item) => ({
            ms: Number(item.duration_ms),
            method: item.method || "",
            path: item.path || "",
            status: item.status || 0,
            service: item.service || "",
            request_id: item.request_id || "",
            actor: item.actor || {},
            ts: item.ts || ""
        }));
}

module.exports = {
    EVENT_LOG_FILE,
    LOG_DIR,
    REQUEST_LOG_FILE,
    SLOW_LOG_FILE,
    appendJsonLine,
    createRequestLogger,
    logEvent,
    readJsonLinesTail,
    redactPath,
    topSlowRequests
};
