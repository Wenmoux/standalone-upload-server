const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");

const DEFAULT_CONFIG_FILE = process.env.PO18_CONFIG_FILE || "/config/app.env";
const DEFAULT_RUNTIME_LOG_FILE = process.env.PO18_RUNTIME_LOG_FILE || "/config/runtime.log";
const MAX_BODY_BYTES = 1024 * 1024;
const RESTART_DELAY_MS = Number(process.env.PO18_SETUP_RESTART_DELAY_MS || 3000);
const defaultSecrets = {
    session: randomSecret(),
    bot: randomSecret(),
    upload: randomSecret()
};

let generatedSetupToken = "";
let adminIndexCache = { file: "", mtimeMs: 0, html: "" };
const REQUIRED_TABLES = ["book_metadata", "chapter_cache", "admin_users", "admin_config", "reader_users", "upload_events"];
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

function packageVersion() {
    try {
        const pkg = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function versionPayload(service = "po18-reader") {
    return {
        ok: true,
        service,
        version: process.env.PO18_APP_VERSION || packageVersion(),
        image: process.env.PO18_IMAGE_TAG || "wenmoux/reader:v1.0",
        build_date: process.env.PO18_BUILD_DATE || "",
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
    return normalizeEnvSecret(
        url.searchParams.get("token") ||
        req.headers["x-po18-setup-token"] ||
        parseCookies(req.headers.cookie).po18_setup_token ||
        bearer ||
        ""
    );
}

function authorize(req, url, configFile = DEFAULT_CONFIG_FILE) {
    if (process.env.PO18_SETUP_AUTH_DISABLED === "1") return { ok: true, token: "", setCookie: false };
    const token = setupToken(configFile);
    const supplied = authTokenFromRequest(req, url);
    const ok = supplied && timingSafeEqualText(supplied, token);
    return { ok, token: ok ? token : "", setCookie: ok && url.searchParams.get("token") === supplied };
}

function authCookie(token) {
    return `po18_setup_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`;
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
        PO18_METRICS_TOKEN: value("PO18_METRICS_TOKEN"),
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

function field({
    id,
    label,
    type = "text",
    value = "",
    placeholder = "",
    helper = "",
    required = false,
    wide = false,
    autocomplete = "",
    secret = false,
    generator = false
}) {
    const toggle = secret ? `<button class="input-action" type="button" data-toggle-target="${id}">显示</button>` : "";
    const generate = generator ? `<button class="input-action" type="button" data-generate-target="${id}">生成</button>` : "";
    return `<label class="field ${wide ? "field-wide" : ""}" for="${id}">
      <span class="field-label">${htmlEscape(label)}${required ? '<b aria-hidden="true">*</b>' : ""}</span>
      <span class="input-wrap">
        <input id="${id}" name="${id}" type="${type}" ${required ? "required" : ""} ${autocomplete ? `autocomplete="${autocomplete}"` : ""} value="${htmlEscape(value)}" placeholder="${htmlEscape(placeholder)}">
        ${toggle}${generate}
      </span>
      ${helper ? `<span class="field-helper">${helper}</span>` : ""}
    </label>`;
}

function sharedStyles() {
    return `<style>
    :root{color-scheme:light;--bg:#f7f9fd;--surface:#fff;--surface-2:#f9fbff;--text:#172033;--muted:#64748b;--line:#d9e2ef;--primary:#2563eb;--primary-dark:#1d4ed8;--success:#15803d;--danger:#be123c;--warn:#a16207;--shadow:0 18px 44px rgba(15,23,42,.10);--radius:12px}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;letter-spacing:0}
    .topbar{position:sticky;top:0;z-index:2;min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 28px;background:rgba(255,255,255,.92);border-bottom:1px solid rgba(217,226,239,.92);backdrop-filter:saturate(140%) blur(14px)}
    .brand{display:flex;align-items:center;gap:12px;min-width:0}.mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#e8f0ff;color:var(--primary);font-weight:800;box-shadow:inset 0 0 0 1px #c8d9ff}.brand strong{display:block;font-size:16px;line-height:1.15}.brand span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
    .chip{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border-radius:999px;color:#285347;background:#e7f6ee;border:1px solid #c7ead5;font-size:13px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#16a34a}
    main{width:min(1120px,100%);margin:0 auto;padding:34px 20px 54px}.layout{display:grid;grid-template-columns:minmax(240px,310px) minmax(0,1fr);gap:22px;align-items:start}
    .summary,.panel,.success-card{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.summary{padding:22px;box-shadow:0 10px 28px rgba(15,23,42,.07)}
    h1{font-size:28px;line-height:1.18;margin:0 0 10px;font-weight:780}.lead{margin:0;color:var(--muted);line-height:1.72;font-size:14px}
    .path{margin-top:18px;padding:12px 13px;border-radius:10px;background:#eef4ff;color:#1e3a8a;border:1px solid #d5e3ff;word-break:break-all;font-family:"SFMono-Regular",Consolas,monospace;font-size:12px}
    .nav{display:grid;gap:8px;margin-top:18px}.nav a{display:flex;align-items:center;min-height:38px;padding:0 12px;border-radius:8px;color:#315071;text-decoration:none;font-weight:700;font-size:13px}.nav a:hover{background:#eef4ff;color:var(--primary)}
    .panel{overflow:hidden}.notice{margin:0;padding:14px 18px;border-bottom:1px solid var(--line);font-size:14px;line-height:1.5}.notice-ok{background:#effaf3;color:var(--success)}.notice-error{background:#fff1f2;color:var(--danger)}
    form{margin:0}.section{padding:22px 24px;border-top:1px solid var(--line)}.section:first-of-type{border-top:0}.section-head{margin:0 0 16px}.section-title{font-size:15px;font-weight:760;margin:0}.section-desc{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{display:block;min-width:0}.field-wide{grid-column:1/-1}.field-label{display:flex;gap:4px;align-items:center;min-height:22px;margin-bottom:7px;color:#26344d;font-size:13px;font-weight:700}.field-label b{color:var(--danger);font-weight:800}
    .input-wrap{display:flex;align-items:center;gap:8px}input{width:100%;min-height:46px;padding:11px 13px;border:1px solid #cbd6e5;border-radius:8px;background:var(--surface-2);color:var(--text);font:inherit;font-size:14px;outline:none;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}input:hover{border-color:#9fb3ce;background:#fff}input:focus{border-color:var(--primary);background:#fff;box-shadow:0 0 0 4px rgba(37,99,235,.12)}input::placeholder{color:#94a3b8}
    .input-action,.ghost-button{min-height:38px;border:1px solid #cbd6e5;border-radius:8px;background:#fff;color:#315071;padding:0 12px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.input-action:hover,.ghost-button:hover{border-color:#8fb2e8;color:var(--primary)}
    .field-helper{display:block;margin-top:6px;color:var(--muted);font-size:12px;line-height:1.48}.import-area{width:100%;min-height:150px;padding:12px 13px;border:1px solid #cbd6e5;border-radius:8px;background:#f8fafc;color:#24324a;font:12px/1.55 "SFMono-Regular",Consolas,monospace;resize:vertical;outline:none}.import-area:focus{border-color:var(--primary);background:#fff;box-shadow:0 0 0 4px rgba(37,99,235,.12)}code{padding:2px 5px;border-radius:5px;background:rgba(15,23,42,.06);color:#1e293b;font-family:"SFMono-Regular",Consolas,monospace;font-size:11px}
    .inline-status{display:flex;align-items:center;gap:8px;min-height:28px;margin-top:10px;color:var(--muted);font-size:13px}.inline-status.ok{color:var(--success)}.inline-status.err{color:var(--danger)}
    .actions{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px 24px;background:#fbfcff;border-top:1px solid var(--line)}.actions small{color:var(--muted);line-height:1.45}
    .primary-button,button[type=submit]{min-height:44px;border:0;border-radius:8px;padding:0 18px;background:var(--primary);color:#fff;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 8px 18px rgba(37,99,235,.24);transition:transform .16s ease,box-shadow .16s ease,background .16s ease;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.primary-button:hover,button[type=submit]:hover{background:var(--primary-dark);box-shadow:0 11px 24px rgba(37,99,235,.28)}.primary-button:active,button[type=submit]:active{transform:translateY(1px)}
    .success-wrap{width:min(780px,100%);margin:0 auto}.success-card{padding:28px}.success-title{font-size:24px;margin:0 0 8px}.status-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.status-box{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fbfcff}.status-box.ok{border-color:#bbebce}.status-box.fail{border-color:#fecdd3}.status-box.optional-fail{border-color:#fed7aa;background:#fff7ed}.status-box.skip{border-color:#fde68a}.status-box strong{display:block;font-size:13px;margin-bottom:6px}.status-box span{display:block;color:var(--muted);font-size:13px;word-break:break-all}
    .countdown{font-weight:800;color:var(--primary)}.button-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.logbox{margin:0;padding:16px;min-height:360px;max-height:620px;overflow:auto;background:#101827;color:#dbeafe;border-radius:10px;font:12px/1.55 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap}.diagbox{width:100%;min-height:220px;resize:vertical;margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:#24324a;font:12px/1.55 "SFMono-Regular",Consolas,monospace}.filter-row{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.filter-row a{min-height:34px;padding:0 11px;border:1px solid #cbd6e5;border-radius:8px;background:#fff;color:#315071;text-decoration:none;font-weight:700;font-size:12px;display:inline-flex;align-items:center}.filter-row a.active{background:#e8f0ff;border-color:#8fb2e8;color:var(--primary)}
    @media (max-width:880px){.layout{grid-template-columns:1fr}.summary{box-shadow:none}main{padding-top:22px}}@media (max-width:640px){.topbar{height:auto;align-items:flex-start;padding:14px 16px;flex-direction:column}.chip{white-space:normal}.grid,.status-grid{grid-template-columns:1fr}.section{padding:20px 16px}.actions{align-items:stretch;flex-direction:column;padding:18px 16px 20px}.input-wrap{align-items:stretch;flex-direction:column}.input-action,.ghost-button,button[type=submit],.primary-button{width:100%}}
    </style>`;
}

function pageShell({ title = "PO18 Reader Setup", chip = "受保护面板", body = "", auth = {} }) {
    const headers = auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {};
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(title)}</title>${sharedStyles()}</head><body>
    <header class="topbar"><div class="brand"><div class="mark">P</div><div><strong>PO18 Reader Setup</strong><span>初始化与运行配置面板</span></div></div><div class="chip"><span class="dot"></span><span>${htmlEscape(chip)}</span></div></header>
    ${body}</body></html>`;
    return { html, headers };
}

function gatePage({ auth = {}, error = "" } = {}) {
    const body = `<main><div class="success-wrap"><section class="success-card">
      <h1 class="success-title">需要安装 Token</h1>
      <p class="lead">初始化和配置面板已保护。请在服务器执行 <code>docker logs po18-app</code>，复制日志里的 setup token，然后访问 <code>/setup?token=TOKEN</code>。</p>
      ${error ? `<p class="notice notice-error">${htmlEscape(error)}</p>` : ""}
      <form method="get" action="/setup" class="button-row" style="margin-top:22px">
        <input name="token" type="password" placeholder="setup token" autocomplete="off" required>
        <button type="submit">进入面板</button>
      </form>
    </section></div></main>`;
    return pageShell({ chip: "等待验证", body, auth });
}

function nav(token) {
    return `<nav class="nav">
      <a href="${authPath("/setup", token)}">配置</a>
      <a href="${authPath("/setup/admin", token)}">后台面板</a>
      <a href="${authPath("/setup/status", token)}">状态</a>
      <a href="${authPath("/setup/logs", token)}">日志</a>
      <a href="${authPath("/backup", token)}">导出配置</a>
      <a href="${authPath("/setup", token)}#import-config">导入配置</a>
    </nav>`;
}

function formPage({ configFile = DEFAULT_CONFIG_FILE, auth = {}, message = "", error = "" } = {}) {
    const values = currentValues(configFile);
    const token = auth.token || "";
    const backupLink = fsSync.existsSync(configFile) ? `<a class="ghost-button" href="${authPath("/backup", token)}">下载当前配置</a>` : "";
    const body = `<main><div class="layout">
      <aside class="summary">
        <h1>${fsSync.existsSync(configFile) ? "运行配置" : "部署前配置"}</h1>
        <p class="lead">配置 PostgreSQL、后台账号、Bot 和 WebDAV。保存后会写入持久化目录，并让容器重启进入最新配置。</p>
        <div class="path">${htmlEscape(configFile)}</div>
        ${nav(token)}
      </aside>
      <section class="panel" aria-label="安装配置表单">
        ${message ? `<p class="notice notice-ok">${htmlEscape(message)}</p>` : ""}
        ${error ? `<p class="notice notice-error">${htmlEscape(error)}</p>` : ""}
        <form id="setupForm" method="post" action="${authPath("/setup", token)}">
          <div class="section"><div class="section-head"><p class="section-title">安全</p><p class="section-desc">这个 Token 用于保护初始化面板、二次配置、状态和日志。可以重新生成；保存后请使用新 Token 访问面板。</p></div>
            <div class="grid">${field({ id: "PO18_SETUP_TOKEN", label: "Setup Token", value: values.PO18_SETUP_TOKEN, required: true, wide: true, secret: true, generator: true })}</div>
          </div>
          <div id="import-config" class="section"><div class="section-head"><p class="section-title">导入配置</p><p class="section-desc">支持导入从本面板下载的 <code>app.env</code>。可以先填入表单检查，也可以直接保存并重启服务。</p></div>
            <div class="grid">
              <label class="field field-wide" for="configImportFile">
                <span class="field-label">配置文件</span>
                <input id="configImportFile" type="file" accept=".env,.txt,text/plain">
                <span class="field-helper">只在浏览器本地读取文件内容；后端导入时只接收白名单配置项。</span>
              </label>
              <label class="field field-wide" for="configImportText">
                <span class="field-label">配置内容</span>
                <textarea id="configImportText" class="import-area" placeholder="把 app.env 内容粘贴到这里，或选择文件自动读取。"></textarea>
              </label>
              <div class="field field-wide"><div class="button-row"><button id="previewImport" class="ghost-button" type="button">填入表单</button><button id="submitImport" class="ghost-button" type="button">导入并重启</button><a class="ghost-button" href="${authPath("/backup", token)}">导出当前配置</a></div><span id="importResult" class="inline-status" role="status"></span></div>
            </div>
          </div>
          <div class="section"><div class="section-head"><p class="section-title">数据库</p><p class="section-desc">后端服务启动前必须能访问 PostgreSQL。保存前建议先测试一次。</p></div>
            <div class="grid">
              ${field({ id: "PO18_PG_URL", label: "PostgreSQL 连接地址", value: values.PO18_PG_URL, placeholder: "postgres://po18:password@host:5432/po18", helper: "支持 <code>postgres://</code> 或 <code>postgresql://</code>。Docker 数据库可用容器名作为 host。", required: true, wide: true })}
              <div class="field field-wide"><button id="testDb" class="ghost-button" type="button">测试数据库连接</button><span id="dbTestResult" class="inline-status" role="status"></span></div>
            </div>
          </div>
          <div class="section"><div class="section-head"><p class="section-title">后台账号</p><p class="section-desc">首次正式启动会使用这里的账号创建管理员。</p></div>
            <div class="grid">
              ${field({ id: "PO18_UPLOAD_ADMIN_USER", label: "管理员账号", value: values.PO18_UPLOAD_ADMIN_USER, required: true, autocomplete: "username" })}
              ${field({ id: "PO18_UPLOAD_ADMIN_PASSWORD", label: "管理员密码", type: "password", value: values.PO18_UPLOAD_ADMIN_PASSWORD, required: true, autocomplete: "new-password", secret: true })}
              ${field({ id: "PO18_UPLOAD_SESSION_SECRET", label: "Session Secret", value: values.PO18_UPLOAD_SESSION_SECRET, required: true, wide: true, helper: "用于浏览器会话签名。建议使用自动生成值。", generator: true })}
              ${field({ id: "PO18_UPLOAD_API_TOKEN", label: "上传写入 API Token", value: values.PO18_UPLOAD_API_TOKEN, required: true, wide: true, helper: "外部上传脚本调用写入接口时需要放到 X-Upload-Token 或 X-PO18-Upload-Token 请求头。", secret: true, generator: true })}
              ${field({ id: "PO18_METRICS_TOKEN", label: "Prometheus Metrics Token", value: values.PO18_METRICS_TOKEN, wide: true, helper: "可选。留空时 /metrics 开放；填写后需要 Authorization: Bearer Token。", secret: true, generator: true })}
            </div>
          </div>
          <div class="section"><div class="section-head"><p class="section-title">Bot</p><p class="section-desc">不使用 Bot 可以留空 Telegram Token；通信 Token 用于后端和 Bot 之间校验。</p></div>
            <div class="grid">
              ${field({ id: "PO18_BOT_API_TOKEN", label: "服务端与 Bot 通信 Token", value: values.PO18_BOT_API_TOKEN, required: true, wide: true, generator: true })}
              ${field({ id: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", type: "password", value: values.TELEGRAM_BOT_TOKEN, autocomplete: "off", secret: true })}
              ${field({ id: "TELEGRAM_API_BASE", label: "Telegram API Base", value: values.TELEGRAM_API_BASE, placeholder: "https://api.telegram.org" })}
              ${field({ id: "PO18_SHARE_API_URL", label: "公开分享/阅读器地址", value: values.PO18_SHARE_API_URL, placeholder: "http://服务器IP:3200", wide: true })}
            </div>
          </div>
          <div class="section"><div class="section-head"><p class="section-title">PikPak WebDAV</p><p class="section-desc">可选配置，用于 Bot 导出上传。</p></div>
            <div class="grid">
              ${field({ id: "PIKPAK_WEBDAV_URL", label: "WebDAV URL", value: values.PIKPAK_WEBDAV_URL, wide: true })}
              ${field({ id: "PIKPAK_WEBDAV_USERNAME", label: "用户名", value: values.PIKPAK_WEBDAV_USERNAME, autocomplete: "username" })}
              ${field({ id: "PIKPAK_WEBDAV_PASSWORD", label: "密码", type: "password", value: values.PIKPAK_WEBDAV_PASSWORD, autocomplete: "current-password", secret: true })}
              ${field({ id: "PIKPAK_WEBDAV_ROOT", label: "根目录", value: values.PIKPAK_WEBDAV_ROOT, wide: true })}
            </div>
          </div>
          <div class="actions"><small>保存后会退出当前进程，Docker 重启策略会拉起正式服务或最新配置。</small><span class="button-row">${backupLink}<button type="submit">保存配置并重启</button></span></div>
        </form>
      </section>
    </div></main>${formScript(authPath("/setup/test-db", token))}`;
    return pageShell({ body, auth });
}

function formScript(testUrl) {
    const importUrl = testUrl.replace("/setup/test-db", "/setup/import");
    return `<script>
    var importKeys=${JSON.stringify(CONFIG_KEYS)};
    function randomToken(bytes){var array=new Uint8Array(bytes||24);if(window.crypto&&window.crypto.getRandomValues){window.crypto.getRandomValues(array)}else{for(var i=0;i<array.length;i+=1)array[i]=Math.floor(Math.random()*256)}var binary="";for(var j=0;j<array.length;j+=1)binary+=String.fromCharCode(array[j]);return btoa(binary).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/g,"")}
    function decodeEnvValue(value){var text=String(value||"").trim();if((text[0]==='"'&&text[text.length-1]==='"')||(text[0]==="'"&&text[text.length-1]==="'"))text=text.slice(1,-1);return text.replace(/\\\\n/g,"\\n").replace(/\\\\"/g,'"').replace(/\\\\\\\\/g,"\\\\")}
    function parseEnvText(text){var result={};String(text||"").split(/\\r?\\n/).forEach(function(line){var trimmed=line.trim();if(!trimmed||trimmed[0]==="#")return;var match=trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(match&&importKeys.indexOf(match[1])!==-1)result[match[1]]=decodeEnvValue(match[2]||"")});if(result.BOT_TOKEN&&!result.TELEGRAM_BOT_TOKEN)result.TELEGRAM_BOT_TOKEN=result.BOT_TOKEN;return result}
    function applyImportValues(values){Object.keys(values||{}).forEach(function(key){if(key==="BOT_TOKEN")return;var input=document.getElementById(key);if(input){input.value=values[key]||"";input.dispatchEvent(new Event("input",{bubbles:true}))}})}
    document.querySelectorAll("[data-toggle-target]").forEach(function(button){button.addEventListener("click",function(){var input=document.getElementById(button.getAttribute("data-toggle-target"));if(!input)return;var visible=input.type==="text";input.type=visible?"password":"text";button.textContent=visible?"显示":"隐藏"})});
    document.querySelectorAll("[data-generate-target]").forEach(function(button){button.addEventListener("click",function(){var input=document.getElementById(button.getAttribute("data-generate-target"));if(!input)return;input.value=randomToken(24);input.dispatchEvent(new Event("input",{bubbles:true}))})});
    var importFile=document.getElementById("configImportFile");var importText=document.getElementById("configImportText");var importResult=document.getElementById("importResult");var previewImport=document.getElementById("previewImport");var submitImport=document.getElementById("submitImport");
    if(importFile&&importText){importFile.addEventListener("change",async function(){var file=importFile.files&&importFile.files[0];if(!file)return;try{importText.value=await file.text();if(importResult){importResult.className="inline-status ok";importResult.textContent="已读取 "+file.name}}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}})}
    if(previewImport&&importText){previewImport.addEventListener("click",function(){try{var values=parseEnvText(importText.value);var keys=Object.keys(values).filter(function(key){return key!=="BOT_TOKEN"});if(!keys.length)throw new Error("没有识别到可导入的配置项");applyImportValues(values);if(importResult){importResult.className="inline-status ok";importResult.textContent="已填入 "+keys.length+" 个配置项，请检查后保存"}}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}})}
    if(submitImport&&importText){submitImport.addEventListener("click",async function(){if(!window.confirm("导入会覆盖当前 /config/app.env 并重启服务，继续？"))return;submitImport.disabled=true;if(importResult){importResult.className="inline-status";importResult.textContent="正在导入..."}try{var response=await fetch("${importUrl}",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({config:importText.value}).toString()});var data=await response.json().catch(function(){return{}});if(!response.ok||!data.ok)throw new Error(data.error||"导入失败");if(importResult){importResult.className="inline-status ok";importResult.textContent="已导入 "+(data.imported||0)+" 个配置项，服务即将重启"}setTimeout(function(){window.location.href=data.next||"${authPath("/setup/status", "")}"},1200)}catch(err){if(importResult){importResult.className="inline-status err";importResult.textContent=err.message||String(err)}}finally{submitImport.disabled=false}})}
    var testButton=document.getElementById("testDb");var result=document.getElementById("dbTestResult");
    if(testButton&&result){testButton.addEventListener("click",async function(){var form=document.getElementById("setupForm");result.className="inline-status";result.textContent="正在测试...";testButton.disabled=true;try{var response=await fetch("${testUrl}",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(form)).toString()});var data=await response.json().catch(function(){return{}});if(!response.ok||!data.ok)throw new Error(data.error||"连接失败");result.className="inline-status ok";result.textContent="连接成功，用时 "+(data.latency_ms||0)+"ms"}catch(err){result.className="inline-status err";result.textContent=err.message||String(err)}finally{testButton.disabled=false}})}
    </script>`;
}

function successPage({ values, auth = {}, configFile = DEFAULT_CONFIG_FILE, restarting = true } = {}) {
    const token = values.PO18_SETUP_TOKEN || auth.token || "";
    const shareUrl = values.PO18_SHARE_API_URL || "http://服务器IP:3200";
    const body = `<main><div class="success-wrap"><section class="success-card">
      <h1 class="success-title">配置已保存</h1>
      <p class="lead">${restarting ? `服务将在 <span id="countdown" class="countdown">${Math.ceil(RESTART_DELAY_MS / 1000)}</span> 秒后退出并等待 Docker 重启。` : "配置已写入磁盘。"}</p>
      <div class="status-grid">
        <div class="status-box"><strong>配置文件</strong><span>${htmlEscape(configFile)}</span></div>
        <div class="status-box ok"><strong>面板 Token</strong><span>新 Token 已写入当前浏览器 Cookie，下面的链接也已自动使用新 Token。</span></div>
        <div class="status-box"><strong>后台地址</strong><span>http://服务器IP:3100</span></div>
        <div class="status-box"><strong>阅读器地址</strong><span>${htmlEscape(shareUrl)}</span></div>
        <div class="status-box"><strong>Bot 状态</strong><span>${values.TELEGRAM_BOT_TOKEN ? "已配置 Token，重启后自动启动" : "未填写 Telegram Token，重启后不启动 Bot"}</span></div>
      </div>
      <div class="button-row"><a class="primary-button" href="${authPath("/setup/status", token)}">查看状态</a><a class="ghost-button" href="${authPath("/backup", token)}">下载配置备份</a><a class="ghost-button" href="${authPath("/setup", token)}">返回配置</a></div>
    </section></div></main>${restarting ? `<script>var seconds=${Math.ceil(RESTART_DELAY_MS / 1000)};var node=document.getElementById("countdown");setInterval(function(){seconds=Math.max(0,seconds-1);if(node)node.textContent=String(seconds)},1000)</script>` : ""}`;
    return pageShell({ chip: "配置已保存", body, auth: { ...auth, token } });
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
            PO18_METRICS_TOKEN: imported.PO18_METRICS_TOKEN || "",
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

async function testDatabase(connectionString) {
    const { Pool } = require("pg");
    const started = Date.now();
    const pool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: Number(process.env.PO18_SETUP_DB_TEST_TIMEOUT_MS || 1500)
    });
    try {
        await pool.query("SELECT 1");
        return { ok: true, latency_ms: Date.now() - started };
    } finally {
        await pool.end().catch(() => {});
    }
}

async function collectDatabaseState(connectionString) {
    const { Pool } = require("pg");
    const pool = new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: Number(process.env.PO18_SETUP_DB_TEST_TIMEOUT_MS || 1500)
    });
    try {
        const [versionResult, tablesResult] = await Promise.all([
            pool.query("SELECT current_database() AS database, version() AS version"),
            pool.query(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
                [REQUIRED_TABLES]
            )
        ]);
        const present = new Set(tablesResult.rows.map((row) => row.table_name));
        const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
        const state = {
            ok: missing.length === 0,
            database: versionResult.rows[0]?.database || "",
            pg_version: String(versionResult.rows[0]?.version || "").split(" on ")[0],
            required_tables: REQUIRED_TABLES.map((table) => ({ table, ok: present.has(table) })),
            missing_tables: missing
        };
        if (!missing.length) {
            const counts = await pool.query(`
                SELECT
                  (SELECT COUNT(*)::int FROM book_metadata) AS books,
                  (SELECT COUNT(*)::int FROM chapter_cache) AS chapters,
                  (SELECT COUNT(*)::int FROM reader_users) AS users,
                  (SELECT COUNT(*)::int FROM admin_users) AS admins,
                  (SELECT COUNT(*)::int FROM upload_events) AS events
            `);
            state.counts = counts.rows[0] || {};
        }
        return state;
    } finally {
        await pool.end().catch(() => {});
    }
}

function databaseStateResult(state) {
    if (!state.ok) {
        return {
            name: "database schema",
            ok: false,
            detail: `missing tables: ${state.missing_tables.join(", ") || "unknown"}`,
            body: state
        };
    }
    const counts = state.counts || {};
    return {
        name: "database schema",
        ok: true,
        detail: `tables ready; books=${counts.books || 0}, chapters=${counts.chapters || 0}, users=${counts.users || 0}, admins=${counts.admins || 0}`,
        body: state
    };
}

async function checkHttp(name, url, required = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.STATUS_TIMEOUT_MS || 1500));
    const started = Date.now();
    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            body = { raw: text.slice(0, 200) };
        }
        return { name, ok: response.ok && body.ok !== false, required, status: response.status, latency_ms: Date.now() - started, url, body };
    } catch (err) {
        return { name, ok: false, required, latency_ms: Date.now() - started, url, error: err.message || String(err) };
    } finally {
        clearTimeout(timeout);
    }
}

async function collectStatus(configFile = DEFAULT_CONFIG_FILE) {
    loadConfigIntoEnv(configFile);
    const values = currentValues(configFile);
    const hasConfig = fsSync.existsSync(configFile) || !!values.PO18_PG_URL;
    const results = [];
    if (!hasConfig) {
        results.push({ name: "setup", ok: true, skipped: false, detail: "等待保存配置" });
        return results;
    }
    const [server, reader, db, dbState] = await Promise.all([
        checkHttp("server-pg", process.env.SERVER_PG_HEALTH_URL || "http://127.0.0.1:3100/health/deep", true),
        checkHttp("reader", process.env.READER_HEALTH_URL || "http://127.0.0.1:3200/health/ready", true),
        testDatabase(values.PO18_PG_URL).catch((err) => ({ ok: false, error: err.message || String(err) })),
        collectDatabaseState(values.PO18_PG_URL).catch((err) => ({ ok: false, error: err.message || String(err), missing_tables: REQUIRED_TABLES }))
    ]);
    results.push(server, reader, { name: "database", required: true, ...db });
    results.push(dbState.error ? { name: "database schema", required: true, ...dbState } : { ...databaseStateResult(dbState), required: true });
    if (values.TELEGRAM_BOT_TOKEN) {
        results.push(await checkHttp("bot", process.env.BOT_HEALTH_URL || "http://127.0.0.1:3300/health/ready", false));
    } else {
        results.push({ name: "bot", ok: true, required: false, skipped: true, detail: "未配置 Telegram Token" });
    }
    return results;
}

function statusBox(result) {
    const cls = result.skipped ? "skip" : result.ok ? "ok" : result.required === false ? "optional-fail" : "fail";
    const detail = result.detail || result.error || `status=${result.status || "n/a"} latency=${result.latency_ms || 0}ms`;
    const label = result.skipped ? "SKIP" : result.ok ? "OK" : result.required === false ? "OPTIONAL FAIL" : "FAIL";
    return `<div class="status-box ${cls}"><strong>${htmlEscape(result.name)} · ${label}</strong><span>${htmlEscape(detail)}</span></div>`;
}

function redactValue(key, value) {
    const text = String(value || "");
    if (!text) return "";
    if (/PG_URL/i.test(key)) {
        try {
            const url = new URL(text);
            if (url.password) url.password = "***";
            return url.toString();
        } catch {
            return text.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:***@");
        }
    }
    if (/(TOKEN|PASSWORD|SECRET|KEY)/i.test(key)) return `<set:${text.length}>`;
    return text;
}

function configDiagnostics(configFile = DEFAULT_CONFIG_FILE) {
    const config = readEnvFileSync(configFile);
    const keys = [
        "PO18_SETUP_TOKEN",
        "PO18_PG_URL",
        "PO18_UPLOAD_ADMIN_USER",
        "PO18_UPLOAD_ADMIN_PASSWORD",
        "PO18_UPLOAD_SESSION_SECRET",
        "PO18_UPLOAD_API_TOKEN",
        "PO18_METRICS_TOKEN",
        "PO18_BOT_API_TOKEN",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_API_BASE",
        "PO18_SHARE_API_URL",
        "PIKPAK_WEBDAV_URL",
        "PIKPAK_WEBDAV_USERNAME",
        "PIKPAK_WEBDAV_PASSWORD",
        "PIKPAK_WEBDAV_ROOT"
    ];
    const fields = {};
    for (const key of keys) {
        const value = process.env[key] || config[key] || "";
        fields[key] = { present: !!value, value: redactValue(key, value) };
    }
    return {
        config_file: configFile,
        config_exists: fsSync.existsSync(configFile),
        fields
    };
}

async function collectDiagnostics(configFile = DEFAULT_CONFIG_FILE, statusResults = null) {
    const status = statusResults || (await collectStatus(configFile));
    return {
        generated_at: new Date().toISOString(),
        version: versionPayload("po18-reader"),
        runtime: {
            pid: process.pid,
            cwd: process.cwd(),
            node_env: process.env.NODE_ENV || "",
            ports: {
                server: process.env.PO18_UPLOAD_PORT || "3100",
                reader: process.env.PO18_READER_PORT || "3200",
                bot_health: process.env.BOT_HEALTH_PORT || "3300"
            }
        },
        config: configDiagnostics(configFile),
        status,
        log_summary: {
            file: process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE,
            recent_errors: filterLogText(readLogTail(process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE, 80000), "error")
                .split(/\r?\n/)
                .slice(-30)
        }
    };
}

async function statusPage({ configFile = DEFAULT_CONFIG_FILE, auth = {} } = {}) {
    const results = await collectStatus(configFile);
    const token = auth.token || "";
    const diagnosticsText = JSON.stringify(await collectDiagnostics(configFile, results), null, 2);
    const body = `<main><div class="layout"><aside class="summary"><h1>运行状态</h1><p class="lead">检测 server-pg、阅读器、Bot 和数据库连接。</p><div class="path">${htmlEscape(configFile)}</div>${nav(token)}</aside>
      <section class="panel"><div class="section"><div class="section-head"><p class="section-title">服务状态</p><p class="section-desc">Bot 未配置 Token 时会被跳过，不影响整体部署。</p></div><div class="status-grid">${results.map(statusBox).join("")}</div>
      <form method="post" action="${authPath("/setup/restart", token)}" class="button-row"><button type="submit">手动重启服务</button><a class="ghost-button" href="${authPath("/setup/logs", token)}">查看日志</a><a class="ghost-button" href="${authPath("/setup/diagnostics.json", token)}">诊断 JSON</a></form></div>
      <div class="section"><div class="section-head"><p class="section-title">脱敏诊断信息</p><p class="section-desc">用于排查部署问题；Token、密码和数据库密码已脱敏。</p></div><button id="copyDiagnostics" class="ghost-button" type="button">复制诊断信息</button><span id="copyDiagnosticsStatus" class="inline-status"></span><textarea id="diagnosticsText" class="diagbox" readonly>${htmlEscape(diagnosticsText)}</textarea></div>
      </section></div></main><script>
      var copyButton=document.getElementById("copyDiagnostics");
      var copyStatus=document.getElementById("copyDiagnosticsStatus");
      if(copyButton){copyButton.addEventListener("click",async function(){var text=document.getElementById("diagnosticsText").value;try{await navigator.clipboard.writeText(text);copyStatus.className="inline-status ok";copyStatus.textContent="已复制"}catch(err){copyStatus.className="inline-status err";copyStatus.textContent="复制失败，请手动选择文本"}})}
      </script>`;
    return pageShell({ chip: results.every((item) => item.ok || item.required === false) ? "状态正常" : "需要检查", body, auth });
}

function readLogTail(logFile = DEFAULT_RUNTIME_LOG_FILE, maxBytes = 120000) {
    try {
        if (!fsSync.existsSync(logFile)) return "暂无运行日志。单容器模式会把 run-all 子进程日志写入这里；也可以执行 docker logs po18-app --tail 200。";
        const stat = fsSync.statSync(logFile);
        const fd = fsSync.openSync(logFile, "r");
        const length = Math.min(stat.size, maxBytes);
        const buffer = Buffer.alloc(length);
        fsSync.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
        fsSync.closeSync(fd);
        return buffer.toString("utf8");
    } catch (err) {
        return `读取日志失败: ${err.message || String(err)}`;
    }
}

function filterLogText(text, filter = "all") {
    const mode = String(filter || "all").toLowerCase();
    if (mode === "all") return text;
    const patterns = {
        error: /(error|fail|exception|unhandled|timeout|econn|refused|denied|invalid|fatal)/i,
        database: /(database|postgres|pg-|pg\]|pool|po18_pg_url|connection|select 1)/i,
        bot: /(\[bot\]|telegram|bot\/telegram|polling|webdav)/i,
        reader: /(\[reader\]|reader-server|dist-reader|po18_api_base)/i,
        server: /(\[server-pg\]|\[sidecar|server-pg|request-db|admin-api|reader-api)/i,
        setup: /(\[setup\]|\[run-all\]|setup token|config saved)/i
    };
    const pattern = patterns[mode] || patterns.all;
    if (!pattern) return text;
    return text
        .split(/\r?\n/)
        .filter((line) => pattern.test(line))
        .join("\n") || `没有匹配 ${mode} 的日志。`;
}

function logFilterLinks(token, active) {
    const labels = {
        all: "全部",
        error: "错误",
        database: "数据库",
        bot: "Bot",
        reader: "阅读器",
        server: "后端",
        setup: "启动/面板"
    };
    return `<div class="filter-row">${Object.entries(labels)
        .map(([key, label]) => `<a class="${key === active ? "active" : ""}" href="${authPath("/setup/logs", token, { filter: key })}">${label}</a>`)
        .join("")}</div>`;
}

function logsPage({ auth = {}, filter = "all" } = {}) {
    const token = auth.token || "";
    const logFile = process.env.PO18_RUNTIME_LOG_FILE || DEFAULT_RUNTIME_LOG_FILE;
    const active = ["all", "error", "database", "bot", "reader", "server", "setup"].includes(String(filter || "").toLowerCase()) ? String(filter).toLowerCase() : "all";
    const body = `<main><div class="layout"><aside class="summary"><h1>运行日志</h1><p class="lead">显示容器内最近运行日志。完整日志仍建议使用 <code>docker logs po18-app</code>。</p><div class="path">${htmlEscape(logFile)}</div>${nav(token)}</aside>
      <section class="panel"><div class="section">${logFilterLinks(token, active)}<pre class="logbox">${htmlEscape(filterLogText(readLogTail(logFile), active))}</pre></div></section></div></main>`;
    return pageShell({ chip: active === "all" ? "最近日志" : `日志过滤：${active}`, body, auth });
}

async function adminPanelPage({ auth = {}, available = false } = {}) {
    if (!available) {
        const token = auth.token || "";
        const body = `<main><div class="layout"><aside class="summary"><h1>后台面板</h1><p class="lead">后台面板会在保存配置并由 Docker 重启进入正常应用模式后启用。</p>${nav(token)}</aside>
          <section class="panel"><div class="section"><div class="section-head"><p class="section-title">等待应用服务启动</p><p class="section-desc">当前进程只负责初始化配置，没有加载书库后台 API。请先保存 PostgreSQL 和管理员配置，容器重启后再从这里进入后台。</p></div><div class="button-row"><a class="primary-button" href="${authPath("/setup", token)}">返回配置</a><a class="ghost-button" href="${authPath("/setup/status", token)}">查看状态</a></div></div></section></div></main>`;
        return pageShell({ chip: "等待后台启动", body, auth });
    }
    const file = path.join(__dirname, "..", "public", "index.html");
    const stat = await fs.stat(file);
    if (adminIndexCache.file !== file || adminIndexCache.mtimeMs !== stat.mtimeMs) {
        adminIndexCache = {
            file,
            mtimeMs: stat.mtimeMs,
            html: await fs.readFile(file, "utf8")
        };
    }
    return {
        html: adminIndexCache.html,
        headers: auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {}
    };
}

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
        const nextAuth = { ...auth, token: values.PO18_SETUP_TOKEN, setCookie: true };
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
            writeJson(res, 400, { ok: false, error: "没有识别到可导入的配置项" }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
            return;
        }
        const error = validate(values);
        if (error) {
            writeJson(res, 400, { ok: false, error }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
            return;
        }
        await saveConfig(values, configFile);
        Object.assign(process.env, values);
        const nextAuth = { ...auth, token: values.PO18_SETUP_TOKEN, setCookie: true };
        writeJson(res, 200, {
            ok: true,
            imported: importedCount,
            restarting: typeof onSave === "function",
            next: authPath("/setup/status", values.PO18_SETUP_TOKEN)
        }, { "Set-Cookie": authCookie(nextAuth.token) });
        if (typeof onSave === "function") onSave();
    } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message || String(err) }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
    }
}

async function handleTestDb(req, res, configFile, auth) {
    try {
        const body = await parseBody(req);
        const values = valuesFromParams(new URLSearchParams(body), configFile);
        if (!/^postgres(?:ql)?:\/\//i.test(values.PO18_PG_URL)) {
            writeJson(res, 400, { ok: false, error: "PostgreSQL 连接地址格式不正确" }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
            return;
        }
        writeJson(res, 200, await testDatabase(values.PO18_PG_URL), auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
    } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message || String(err) }, auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
    }
}

async function handleBackup(res, configFile, auth) {
    try {
        const content = await fs.readFile(configFile, "utf8");
        write(res, 200, content, "text/plain; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="app.env"',
            ...(auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {})
        });
    } catch {
        write(res, 404, "config file not found", "text/plain; charset=utf-8", auth.setCookie ? { "Set-Cookie": authCookie(auth.token) } : {});
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
    if (!auth.ok) {
        const page = gatePage({ auth });
        write(res, 401, page.html, "text/html; charset=utf-8", page.headers);
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
        await handleBackup(res, configFile, auth);
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
    filterLogText,
    handlePanelRequest,
    importedValuesFromText,
    loadConfigIntoEnv,
    logSetupToken,
    readLogTail,
    setupToken,
    versionPayload
};
