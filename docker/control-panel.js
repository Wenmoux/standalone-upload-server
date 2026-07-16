/**
 * [INPUT]: 依赖 Node.js 文件系统与加密能力、统一限流器、运行诊断服务、页面渲染器及 /config/app.env
 * [OUTPUT]: 对外提供 Setup/Admin 控制面板请求处理、配置导入导出、鉴权组合、状态诊断与版本信息
 * [POS]: docker 运行面的控制面组合根，把首次初始化和运维路由连接到配置、诊断与页面边界，不内联界面实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { createControlPanelPages } = require("./control-panel-pages");
const { createControlPanelRuntime } = require("./control-panel-runtime");
const { createRateWindow } = require("../services/rate-limit");
const { URL, URLSearchParams } = require("url");

const DEFAULT_CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const DEFAULT_RUNTIME_LOG_FILE = process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
const MAX_BODY_BYTES = 1024 * 1024;
const RESTART_DELAY_MS = Number(process.env.PO18_SETUP_RESTART_DELAY_MS || 3000);
const defaultSecrets = {
    session: randomSecret(),
    bot: randomSecret(),
    upload: randomSecret(),
    metrics: randomSecret()
};

let generatedSetupToken = "";
let designTokensCache = "";
const REQUIRED_TABLES = ["book_metadata", "chapter_cache", "admin_users", "admin_config", "reader_users", "upload_events"];
const setupAuthRateWindow = createRateWindow({
    windowMs: Number(process.env.PO18_SETUP_AUTH_RATE_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.PO18_SETUP_AUTH_RATE_MAX || 20)
});

function setupClientKey(req) {
    return String(req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown").trim() || "unknown";
}

function rateLimitHeaders(result) {
    return {
        "RateLimit-Limit": String(result.limit),
        "RateLimit-Remaining": String(result.remaining),
        "RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        ...(result.allowed ? {} : { "Retry-After": String(result.retryAfter) })
    };
}
const CONFIG_KEYS = [
    "PO18_SETUP_TOKEN",
    "PO18_PG_URL",
    "PO18_UPLOAD_ADMIN_USER",
    "PO18_UPLOAD_ADMIN_PASSWORD",
    "PO18_UPLOAD_SESSION_SECRET",
    "PO18_UPLOAD_API_TOKEN",
    "PO18_METRICS_TOKEN",
    "PO18_BOT_API_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "BOT_TOKEN",
    "TELEGRAM_API_BASE",
    "PO18_SERVER_URL",
    "PO18_API_BASE",
    "PO18_SHARE_API_URL",
    "PIKPAK_WEBDAV_URL",
    "PIKPAK_WEBDAV_USERNAME",
    "PIKPAK_WEBDAV_PASSWORD",
    "PIKPAK_WEBDAV_ROOT"
];
const CONFIG_KEY_SET = new Set(CONFIG_KEYS);
const SENSITIVE_CONFIG_KEY =
    /(?:PASSWORD|PASSWD|SECRET|TOKEN|COOKIE|CREDENTIAL|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL|PG_URL|ACCESS_KEY)/i;

function packageVersion() {
    try {
        const pkg = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function designTokensCss() {
    if (designTokensCache) return designTokensCache;
    try {
        designTokensCache = fsSync
            .readFileSync(path.join(__dirname, "..", "ui", "design-tokens.css"), "utf8")
            .replace(/<\/style/gi, "<\\/style");
    } catch {
        designTokensCache =
            ':root{--po18-bg:#eef2f7;--po18-surface:#fff;--po18-surface-alt:#f8fafc;--po18-text:#162033;--po18-muted:#65748b;--po18-line:#d8e1ea;--po18-accent:#2563eb;--po18-accent-dark:#1d4ed8;--po18-success:#15803d;--po18-danger:#be123c;--po18-warning:#a16207;--po18-shadow:0 18px 44px rgba(15,23,42,.11);--po18-radius-lg:12px;--po18-font-sans:Inter,Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif}';
    }
    return designTokensCache;
}

function imageBuildInfo() {
    try {
        return JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", ".po18-build.json"), "utf8"));
    } catch {
        return {};
    }
}

function versionPayload(service = "po18-reader") {
    const build = imageBuildInfo();
    const runtimeVersion = process.env.PO18_APP_VERSION || "";
    const revision = build.build_revision || build.revision || process.env.PO18_BUILD_REVISION || "";
    const immutableImage = build.immutable_image || process.env.PO18_IMMUTABLE_IMAGE_TAG || "";
    const sourceHash = build.source_hash || process.env.PO18_SOURCE_HASH || "";
    const imageDigest = process.env.PO18_IMAGE_DIGEST || build.image_digest || "";
    return {
        ok: true,
        service,
        version: build.version || runtimeVersion || packageVersion(),
        runtime_version: runtimeVersion,
        image: build.image || process.env.PO18_IMAGE_TAG || "wenmoux/reader:v2.0",
        immutable_image: immutableImage,
        image_tags: Array.isArray(build.image_tags) ? build.image_tags : [],
        image_digest: imageDigest,
        build_date: build.build_date || process.env.PO18_BUILD_DATE || "",
        build_revision: revision,
        revision,
        source_hash: sourceHash,
        dirty: build.dirty === true || process.env.PO18_BUILD_DIRTY === "true",
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        uptime_seconds: Math.round(process.uptime())
    };
}

function randomSecret(bytes = 24) {
    return crypto.randomBytes(bytes).toString("base64url");
}

function htmlEscape(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function parseEnvLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return null;
    const value = normalizeEnvSecret(match[2] || "");
    return [match[1], value];
}

function normalizeEnvSecret(value) {
    let text = String(value ?? "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1);
    }
    return text.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function sanitizeConfigExport(content = "") {
    const omitted = [];
    const lines = String(content || "").split(/\r?\n/);
    const safe = [];
    for (const line of lines) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (match && SENSITIVE_CONFIG_KEY.test(match[1])) {
            omitted.push(match[1]);
            continue;
        }
        safe.push(line);
    }
    const header = [
        "# PO18 safe configuration export",
        "# Sensitive values were intentionally omitted. Re-enter them through Setup on the target server.",
        `# Omitted keys: ${omitted.sort().join(", ") || "none"}`,
        ""
    ];
    return { content: `${header.join("\n")}${safe.join("\n").replace(/^\s+/, "")}`, omitted };
}

function readEnvFileSync(file = DEFAULT_CONFIG_FILE) {
    const values = {};
    if (!fsSync.existsSync(file)) return values;
    const text = fsSync.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (parsed) values[parsed[0]] = parsed[1];
    }
    return values;
}

function loadConfigIntoEnv(file = DEFAULT_CONFIG_FILE) {
    const values = readEnvFileSync(file);
    for (const [key, value] of Object.entries(values)) {
        if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
    return Object.keys(values).length > 0;
}

function quoteEnv(value) {
    const text = String(value ?? "");
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function parseCookies(header = "") {
    const cookies = {};
    for (const part of String(header || "").split(";")) {
        const index = part.indexOf("=");
        if (index === -1) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
    }
    return cookies;
}

function timingSafeEqualText(a, b) {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function setupToken(configFile = DEFAULT_CONFIG_FILE) {
    const config = readEnvFileSync(configFile);
    const existing = normalizeEnvSecret(process.env.PO18_SETUP_TOKEN || config.PO18_SETUP_TOKEN || generatedSetupToken);
    if (existing) {
        process.env.PO18_SETUP_TOKEN = existing;
        return existing;
    }
    generatedSetupToken = randomSecret(24);
    process.env.PO18_SETUP_TOKEN = generatedSetupToken;
    return generatedSetupToken;
}

function logSetupToken({ host = "0.0.0.0", port = 3100, configFile = DEFAULT_CONFIG_FILE } = {}) {
    const token = setupToken(configFile);
    const hostForUrl = host === "0.0.0.0" ? "SERVER_IP" : host;
    console.log("[setup] protected setup token:");
    console.log(`[setup] ${token}`);
    console.log(`[setup] open http://${hostForUrl}:${port}/setup?token=${token}`);
}

function authTokenFromRequest(req, url) {
    const authHeader = String(req.headers.authorization || "");
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    const candidates = [
        ["query", url.searchParams.get("token")],
        ["header", req.headers["x-po18-setup-token"]],
        ["cookie", parseCookies(req.headers.cookie).po18_setup_token],
        ["bearer", bearer]
    ];
    const found = candidates.find(([, value]) => normalizeEnvSecret(value));
    return {
        source: found?.[0] || "",
        token: normalizeEnvSecret(found?.[1] || "")
    };
}

function authorize(req, url, configFile = DEFAULT_CONFIG_FILE) {
    if (process.env.PO18_SETUP_AUTH_DISABLED === "1") return { ok: true, token: "", setCookie: false };
    const token = setupToken(configFile);
    const credential = authTokenFromRequest(req, url);
    const supplied = credential.token;
    const ok = supplied && timingSafeEqualText(supplied, token);
    return {
        ok,
        token: ok && credential.source !== "cookie" ? token : "",
        setCookie: ok && credential.source !== "cookie"
    };
}

function authCookie(token) {
    const secure = process.env.PO18_SETUP_COOKIE_SECURE === "1" ? "; Secure" : "";
    return `po18_setup_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`;
}

function authPath(pathname, token, params = {}) {
    const query = new URLSearchParams(params);
    if (token) query.set("token", token);
    const suffix = query.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
}

function write(res, status, body, contentType = "text/html; charset=utf-8", extraHeaders = {}) {
    res.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        ...extraHeaders
    });
    res.end(body);
}

function writeJson(res, status, payload, extraHeaders = {}) {
    write(res, status, JSON.stringify(payload), "application/json; charset=utf-8", extraHeaders);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function currentValues(configFile = DEFAULT_CONFIG_FILE) {
    const config = readEnvFileSync(configFile);
    const value = (key, fallback = "") => process.env[key] || config[key] || fallback;
    return {
        PO18_SETUP_TOKEN: value("PO18_SETUP_TOKEN", setupToken(configFile)),
        PO18_PG_URL: value("PO18_PG_URL"),
        PO18_UPLOAD_ADMIN_USER: value("PO18_UPLOAD_ADMIN_USER", "admin"),
        PO18_UPLOAD_ADMIN_PASSWORD: value("PO18_UPLOAD_ADMIN_PASSWORD"),
        PO18_UPLOAD_SESSION_SECRET: value("PO18_UPLOAD_SESSION_SECRET", defaultSecrets.session),
        PO18_UPLOAD_API_TOKEN: value("PO18_UPLOAD_API_TOKEN", defaultSecrets.upload),
        PO18_METRICS_TOKEN: value("PO18_METRICS_TOKEN", defaultSecrets.metrics),
        PO18_BOT_API_TOKEN: value("PO18_BOT_API_TOKEN", defaultSecrets.bot),
        TELEGRAM_BOT_TOKEN: value("TELEGRAM_BOT_TOKEN") || value("BOT_TOKEN"),
        TELEGRAM_API_BASE: value("TELEGRAM_API_BASE", "https://api.telegram.org"),
        PO18_SERVER_URL: value("PO18_SERVER_URL", "http://127.0.0.1:3100"),
        PO18_API_BASE: value("PO18_API_BASE", "http://127.0.0.1:3100"),
        PO18_SHARE_API_URL: value("PO18_SHARE_API_URL"),
        PIKPAK_WEBDAV_URL: value("PIKPAK_WEBDAV_URL"),
        PIKPAK_WEBDAV_USERNAME: value("PIKPAK_WEBDAV_USERNAME"),
        PIKPAK_WEBDAV_PASSWORD: value("PIKPAK_WEBDAV_PASSWORD"),
        PIKPAK_WEBDAV_ROOT: value("PIKPAK_WEBDAV_ROOT", "/")
    };
}

function valuesFromParams(params, configFile = DEFAULT_CONFIG_FILE) {
    const current = currentValues(configFile);
    const normalized = (key) => String(params.get(key) || "").trim();
    return {
        PO18_SETUP_TOKEN: normalized("PO18_SETUP_TOKEN") || current.PO18_SETUP_TOKEN,
        PO18_PG_URL: normalized("PO18_PG_URL"),
        PO18_UPLOAD_ADMIN_USER: normalized("PO18_UPLOAD_ADMIN_USER") || "admin",
        PO18_UPLOAD_ADMIN_PASSWORD: String(params.get("PO18_UPLOAD_ADMIN_PASSWORD") || ""),
        PO18_UPLOAD_SESSION_SECRET: normalized("PO18_UPLOAD_SESSION_SECRET"),
        PO18_UPLOAD_API_TOKEN: normalized("PO18_UPLOAD_API_TOKEN"),
        PO18_METRICS_TOKEN: normalized("PO18_METRICS_TOKEN"),
        PO18_BOT_API_TOKEN: normalized("PO18_BOT_API_TOKEN"),
        TELEGRAM_BOT_TOKEN: normalized("TELEGRAM_BOT_TOKEN"),
        TELEGRAM_API_BASE: normalized("TELEGRAM_API_BASE") || "https://api.telegram.org",
        PO18_SERVER_URL: normalized("PO18_SERVER_URL") || current.PO18_SERVER_URL || "http://127.0.0.1:3100",
        PO18_API_BASE: normalized("PO18_API_BASE") || current.PO18_API_BASE || "http://127.0.0.1:3100",
        PO18_SHARE_API_URL: normalized("PO18_SHARE_API_URL"),
        PIKPAK_WEBDAV_URL: normalized("PIKPAK_WEBDAV_URL"),
        PIKPAK_WEBDAV_USERNAME: normalized("PIKPAK_WEBDAV_USERNAME"),
        PIKPAK_WEBDAV_PASSWORD: String(params.get("PIKPAK_WEBDAV_PASSWORD") || ""),
        PIKPAK_WEBDAV_ROOT: normalized("PIKPAK_WEBDAV_ROOT") || "/"
    };
}

function importedValuesFromText(text, configFile = DEFAULT_CONFIG_FILE) {
    const imported = {};
    for (const line of String(text || "").split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (parsed && CONFIG_KEY_SET.has(parsed[0])) imported[parsed[0]] = parsed[1];
    }
    if (imported.BOT_TOKEN && !imported.TELEGRAM_BOT_TOKEN) {
        imported.TELEGRAM_BOT_TOKEN = imported.BOT_TOKEN;
    }
    const current = currentValues(configFile);
    return {
        values: {
            PO18_SETUP_TOKEN: imported.PO18_SETUP_TOKEN || current.PO18_SETUP_TOKEN,
            PO18_PG_URL: imported.PO18_PG_URL || "",
            PO18_UPLOAD_ADMIN_USER: imported.PO18_UPLOAD_ADMIN_USER || "",
            PO18_UPLOAD_ADMIN_PASSWORD: imported.PO18_UPLOAD_ADMIN_PASSWORD || "",
            PO18_UPLOAD_SESSION_SECRET: imported.PO18_UPLOAD_SESSION_SECRET || "",
            PO18_UPLOAD_API_TOKEN: imported.PO18_UPLOAD_API_TOKEN || "",
            PO18_METRICS_TOKEN: imported.PO18_METRICS_TOKEN || current.PO18_METRICS_TOKEN,
            PO18_BOT_API_TOKEN: imported.PO18_BOT_API_TOKEN || "",
            TELEGRAM_BOT_TOKEN: imported.TELEGRAM_BOT_TOKEN || "",
            TELEGRAM_API_BASE: imported.TELEGRAM_API_BASE || current.TELEGRAM_API_BASE || "https://api.telegram.org",
            PO18_SERVER_URL: imported.PO18_SERVER_URL || current.PO18_SERVER_URL || "http://127.0.0.1:3100",
            PO18_API_BASE: imported.PO18_API_BASE || current.PO18_API_BASE || "http://127.0.0.1:3100",
            PO18_SHARE_API_URL: imported.PO18_SHARE_API_URL || "",
            PIKPAK_WEBDAV_URL: imported.PIKPAK_WEBDAV_URL || "",
            PIKPAK_WEBDAV_USERNAME: imported.PIKPAK_WEBDAV_USERNAME || "",
            PIKPAK_WEBDAV_PASSWORD: imported.PIKPAK_WEBDAV_PASSWORD || "",
            PIKPAK_WEBDAV_ROOT: imported.PIKPAK_WEBDAV_ROOT || current.PIKPAK_WEBDAV_ROOT || "/"
        },
        importedCount: Object.keys(imported).filter((key) => key !== "BOT_TOKEN").length
    };
}

function validate(values) {
    if (!values.PO18_SETUP_TOKEN || values.PO18_SETUP_TOKEN.length < 16) return "Setup Token 至少需要 16 个字符。";
    if (!/^postgres(?:ql)?:\/\//i.test(values.PO18_PG_URL)) return "PostgreSQL 连接地址必须以 postgres:// 或 postgresql:// 开头。";
    if (!values.PO18_UPLOAD_ADMIN_USER) return "后台管理员账号不能为空。";
    if (!values.PO18_UPLOAD_ADMIN_PASSWORD) return "后台管理员密码不能为空。";
    if (!values.PO18_UPLOAD_SESSION_SECRET || values.PO18_UPLOAD_SESSION_SECRET.length < 16) return "Session Secret 至少需要 16 个字符。";
    if (!values.PO18_UPLOAD_API_TOKEN || values.PO18_UPLOAD_API_TOKEN.length < 16) return "上传写入 API Token 至少需要 16 个字符。";
    if (!values.PO18_METRICS_TOKEN || values.PO18_METRICS_TOKEN.length < 16) return "Prometheus Metrics Token 至少需要 16 个字符。";
    if (!values.PO18_BOT_API_TOKEN || values.PO18_BOT_API_TOKEN.length < 16) return "服务端与 Bot 通信 Token 至少需要 16 个字符。";
    return "";
}

function envFile(values) {
    const rows = [
        "# Generated by PO18 setup panel.",
        `PO18_SETUP_TOKEN=${quoteEnv(values.PO18_SETUP_TOKEN)}`,
        `PO18_PG_URL=${quoteEnv(values.PO18_PG_URL)}`,
        `PO18_UPLOAD_ADMIN_USER=${quoteEnv(values.PO18_UPLOAD_ADMIN_USER)}`,
        `PO18_UPLOAD_ADMIN_PASSWORD=${quoteEnv(values.PO18_UPLOAD_ADMIN_PASSWORD)}`,
        `PO18_UPLOAD_SESSION_SECRET=${quoteEnv(values.PO18_UPLOAD_SESSION_SECRET)}`,
        `PO18_UPLOAD_API_TOKEN=${quoteEnv(values.PO18_UPLOAD_API_TOKEN)}`,
        `PO18_METRICS_TOKEN=${quoteEnv(values.PO18_METRICS_TOKEN)}`,
        `PO18_BOT_API_TOKEN=${quoteEnv(values.PO18_BOT_API_TOKEN)}`,
        `TELEGRAM_BOT_TOKEN=${quoteEnv(values.TELEGRAM_BOT_TOKEN)}`,
        `BOT_TOKEN=${quoteEnv(values.TELEGRAM_BOT_TOKEN)}`,
        `TELEGRAM_API_BASE=${quoteEnv(values.TELEGRAM_API_BASE || "https://api.telegram.org")}`,
        `PO18_SERVER_URL=${quoteEnv(values.PO18_SERVER_URL || "http://127.0.0.1:3100")}`,
        `PO18_API_BASE=${quoteEnv(values.PO18_API_BASE || "http://127.0.0.1:3100")}`,
        `PO18_SHARE_API_URL=${quoteEnv(values.PO18_SHARE_API_URL)}`,
        `PIKPAK_WEBDAV_URL=${quoteEnv(values.PIKPAK_WEBDAV_URL)}`,
        `PIKPAK_WEBDAV_USERNAME=${quoteEnv(values.PIKPAK_WEBDAV_USERNAME)}`,
        `PIKPAK_WEBDAV_PASSWORD=${quoteEnv(values.PIKPAK_WEBDAV_PASSWORD)}`,
        `PIKPAK_WEBDAV_ROOT=${quoteEnv(values.PIKPAK_WEBDAV_ROOT || "/")}`
    ];
    return `${rows.join("\n")}\n`;
}

async function saveConfig(values, configFile = DEFAULT_CONFIG_FILE) {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, envFile(values), { mode: 0o600 });
}

const panelRuntime = createControlPanelRuntime({
    currentValues,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    defaultRuntimeLogFile: DEFAULT_RUNTIME_LOG_FILE,
    loadConfigIntoEnv,
    readEnvFileSync,
    requiredTables: REQUIRED_TABLES,
    versionPayload
});
const { collectDiagnostics, collectStatus, filterLogText, readLogTail, testDatabase } = panelRuntime;
const { adminPanelPage, formPage, gatePage, logsPage, statusPage, successPage } = createControlPanelPages({
    authCookie,
    authPath,
    collectDiagnostics,
    collectStatus,
    configKeys: CONFIG_KEYS,
    currentValues,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    defaultRuntimeLogFile: DEFAULT_RUNTIME_LOG_FILE,
    designTokensCss,
    filterLogText,
    htmlEscape,
    readLogTail,
    restartDelayMs: RESTART_DELAY_MS
});

async function handleSetupPost(req, res, { configFile, auth, onSave }) {
    try {
        const body = await parseBody(req);
        const values = valuesFromParams(new URLSearchParams(body), configFile);
        const error = validate(values);
        if (error) {
            Object.assign(process.env, values);
            const page = formPage({ configFile, auth, error });
            write(res, 400, page.html, "text/html; charset=utf-8", page.headers);
            return;
        }
        await saveConfig(values, configFile);
        Object.assign(process.env, values);
        const nextAuth = { ...auth, token: "", cookieToken: values.PO18_SETUP_TOKEN, setCookie: true };
        const page = successPage({ values, auth: nextAuth, configFile, restarting: typeof onSave === "function" });
        write(res, 200, page.html, "text/html; charset=utf-8", page.headers);
        if (typeof onSave === "function") onSave();
    } catch (err) {
        const page = formPage({ configFile, auth, error: err.message || String(err) });
        write(res, 500, page.html, "text/html; charset=utf-8", page.headers);
    }
}

async function handleImportPost(req, res, { configFile, auth, onSave }) {
    try {
        const body = await parseBody(req);
        const configText = new URLSearchParams(body).get("config") || "";
        const { values, importedCount } = importedValuesFromText(configText, configFile);
        if (!importedCount) {
            writeJson(
                res,
                400,
                { ok: false, error: "没有识别到可导入的配置项" },
                auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
            );
            return;
        }
        const error = validate(values);
        if (error) {
            writeJson(res, 400, { ok: false, error }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
            return;
        }
        await saveConfig(values, configFile);
        Object.assign(process.env, values);
        const nextAuth = { ...auth, token: "", cookieToken: values.PO18_SETUP_TOKEN, setCookie: true };
        writeJson(
            res,
            200,
            {
                ok: true,
                imported: importedCount,
                restarting: typeof onSave === "function",
                next: "/setup/status"
            },
            { "Set-Cookie": authCookie(nextAuth.cookieToken) }
        );
        if (typeof onSave === "function") onSave();
    } catch (err) {
        writeJson(
            res,
            500,
            { ok: false, error: err.message || String(err) },
            auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
        );
    }
}

async function handleTestDb(req, res, configFile, auth) {
    try {
        const body = await parseBody(req);
        const values = valuesFromParams(new URLSearchParams(body), configFile);
        if (!/^postgres(?:ql)?:\/\//i.test(values.PO18_PG_URL)) {
            writeJson(
                res,
                400,
                { ok: false, error: "PostgreSQL 连接地址格式不正确" },
                auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
            );
            return;
        }
        writeJson(res, 200, await testDatabase(values.PO18_PG_URL), auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
    } catch (err) {
        writeJson(
            res,
            400,
            { ok: false, error: err.message || String(err) },
            auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
        );
    }
}

async function handleBackup(res, configFile, auth, options = {}) {
    try {
        const content = await fs.readFile(configFile, "utf8");
        const includeSecrets = options.includeSecrets === true;
        const exported = includeSecrets
            ? { content: `# SENSITIVE CONFIGURATION BACKUP - encrypt at rest and restrict access\n${content}`, omitted: [] }
            : sanitizeConfigExport(content);
        write(res, 200, exported.content, "text/plain; charset=utf-8", {
            "Content-Disposition": includeSecrets ? 'attachment; filename="app.secrets.env"' : 'attachment; filename="app.safe.env"',
            "Cache-Control": "no-store",
            "X-PO18-Contains-Secrets": includeSecrets ? "true" : "false",
            "X-PO18-Omitted-Keys": includeSecrets ? "" : String(exported.omitted.length),
            ...(auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {})
        });
    } catch {
        write(
            res,
            404,
            "config file not found",
            "text/plain; charset=utf-8",
            auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
        );
    }
}

function restartLater(onRestart) {
    setTimeout(() => {
        if (typeof onRestart === "function") {
            onRestart();
            return;
        }
        process.exit(0);
    }, RESTART_DELAY_MS).unref();
}

async function handlePanelRequest(req, res, options = {}) {
    const configFile = options.configFile || DEFAULT_CONFIG_FILE;
    const url = new URL(req.url, `http://${req.headers.host || "setup.local"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "GET" && pathname === "/health/live") {
        writeJson(res, 200, { ok: true, service: "setup-panel", uptime_seconds: Math.round(process.uptime()) });
        return;
    }
    if (req.method === "GET" && pathname === "/health/ready") {
        writeJson(res, 200, { ok: true, service: "setup-panel", config_file: configFile });
        return;
    }
    if (req.method === "GET" && pathname === "/health/version") {
        writeJson(res, 200, versionPayload("setup-panel"));
        return;
    }
    const auth = authorize(req, url, configFile);
    const clientKey = setupClientKey(req);
    const authRateWindow = options.setupAuthRateWindow || setupAuthRateWindow;
    if (!auth.ok) {
        const limit = authRateWindow.consume(clientKey);
        const page = gatePage({ auth, error: limit.allowed ? "" : "尝试次数过多，请稍后再试。" });
        write(res, limit.allowed ? 401 : 429, page.html, "text/html; charset=utf-8", {
            ...page.headers,
            ...rateLimitHeaders(limit)
        });
        return;
    }
    authRateWindow.reset(clientKey);
    if (req.method === "GET" && auth.setCookie) {
        url.searchParams.delete("token");
        const location = `${url.pathname}${url.search}` || "/setup";
        write(res, 302, "", "text/plain; charset=utf-8", {
            Location: location,
            "Set-Cookie": authCookie(auth.token)
        });
        return;
    }
    if (req.method === "GET" && (pathname === "/" || pathname === "/setup")) {
        const page = formPage({ configFile, auth });
        write(res, 200, page.html, "text/html; charset=utf-8", page.headers);
        return;
    }
    if (req.method === "GET" && pathname === "/setup/admin") {
        const page = await adminPanelPage({ auth, available: options.adminAvailable === true });
        write(res, 200, page.html, "text/html; charset=utf-8", page.headers);
        return;
    }
    if (req.method === "GET" && pathname === "/setup/status") {
        const page = await statusPage({ configFile, auth });
        write(res, 200, page.html, "text/html; charset=utf-8", page.headers);
        return;
    }
    if (req.method === "GET" && pathname === "/setup/logs") {
        const page = logsPage({ auth, filter: url.searchParams.get("filter") || "all" });
        write(res, 200, page.html, "text/html; charset=utf-8", page.headers);
        return;
    }
    if (req.method === "GET" && pathname === "/setup/diagnostics.json") {
        writeJson(res, 200, await collectDiagnostics(configFile), auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
        return;
    }
    if (req.method === "GET" && pathname === "/setup/diagnostics") {
        const content = JSON.stringify(await collectDiagnostics(configFile), null, 2);
        write(res, 200, content, "text/plain; charset=utf-8", auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
        return;
    }
    if (req.method === "GET" && pathname === "/backup") {
        const requestedSecrets = /^(1|true|yes)$/i.test(String(url.searchParams.get("include_secrets") || ""));
        if (requestedSecrets && url.searchParams.get("confirm") !== "EXPORT_SECRETS") {
            writeJson(
                res,
                400,
                { ok: false, error: "full secret export requires confirm=EXPORT_SECRETS" },
                auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
            );
            return;
        }
        await handleBackup(res, configFile, auth, { includeSecrets: requestedSecrets });
        return;
    }
    if (req.method === "POST" && pathname === "/setup") {
        await handleSetupPost(req, res, {
            configFile,
            auth,
            onSave: options.restartOnSave === false ? null : () => restartLater(options.onRestart)
        });
        return;
    }
    if (req.method === "POST" && pathname === "/setup/import") {
        await handleImportPost(req, res, {
            configFile,
            auth,
            onSave: options.restartOnSave === false ? null : () => restartLater(options.onRestart)
        });
        return;
    }
    if (req.method === "POST" && pathname === "/setup/test-db") {
        await handleTestDb(req, res, configFile, auth);
        return;
    }
    if (req.method === "POST" && pathname === "/setup/restart") {
        writeJson(res, 200, { ok: true, restarting: true }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
        restartLater(options.onRestart);
        return;
    }
    write(res, 404, "not found", "text/plain; charset=utf-8", auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
}

function attachExpressPanel(app, options = {}) {
    const configFile = options.configFile || DEFAULT_CONFIG_FILE;
    const hadToken = !!process.env.PO18_SETUP_TOKEN || !!readEnvFileSync(configFile).PO18_SETUP_TOKEN;
    setupToken(configFile);
    if (!hadToken) {
        logSetupToken({
            host: process.env.PO18_UPLOAD_HOST || "0.0.0.0",
            port: process.env.PO18_UPLOAD_PORT || 3100,
            configFile
        });
    }
    app.use((req, res, next) => {
        const pathname = String(req.path || req.url || "");
        if (pathname === "/setup" || pathname.startsWith("/setup/") || pathname === "/backup") {
            handlePanelRequest(req, res, {
                ...options,
                configFile,
                adminAvailable: true,
                onRestart: options.onRestart || (() => process.exit(0))
            }).catch(next);
            return;
        }
        next();
    });
}

module.exports = {
    attachExpressPanel,
    collectDiagnostics,
    collectStatus,
    designTokensCss,
    filterLogText,
    handlePanelRequest,
    importedValuesFromText,
    loadConfigIntoEnv,
    logSetupToken,
    readLogTail,
    sanitizeConfigExport,
    setupToken,
    versionPayload
};
