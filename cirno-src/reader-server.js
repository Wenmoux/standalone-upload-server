/**
 * [INPUT]: 依赖 Express、http-proxy/fetch、dist-reader 构建产物、PO18_API_BASE 与监听配置
 * [OUTPUT]: 对外提供 3200 端口 Reader 静态站点、保留公网来源信息的 /reader-auth 和 /reader-api 代理及健康端点
 * [POS]: cirno-src 的生产静态服务器，只代理 Reader 专用 API，并为 server-pg 的会话与 CSRF 判断传递原始 Host/协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const express = require("express");
const compression = require("compression");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const { createRequestLogger } = require("../docker/structured-log");

const PORT = Number(process.env.PO18_READER_PORT || 3200);
const HOST = process.env.PO18_READER_HOST || "127.0.0.1";
const API_BASE = String(process.env.PO18_API_BASE || "http://127.0.0.1:3100").replace(/\/+$/, "");
const DIST_DIR = path.resolve(__dirname, process.env.PO18_READER_DIST || process.env.CIRNO_OUTPUT_DIR || "dist-reader");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

const app = express();
app.use(compression());
app.use(createRequestLogger({
    service: "reader",
    slowMs: Number(process.env.PO18_READER_SLOW_REQUEST_MS || process.env.PO18_SLOW_REQUEST_MS || 800)
}));

function healthPayload(extra = {}) {
    return {
        ok: true,
        service: "reader",
        uptime_seconds: Math.round(process.uptime()),
        api_base: API_BASE,
        dist_dir: DIST_DIR,
        ...extra
    };
}

function firstForwardedValue(value) {
    return String(value || "").split(",")[0].trim();
}

function proxyRequestHeaders(req, target) {
    const headers = { ...req.headers, host: target.host };
    const publicHost = String(req.headers?.host || "").trim();
    const publicProtocol = firstForwardedValue(req.headers?.["x-forwarded-proto"])
        || (req.socket?.encrypted ? "https" : String(req.protocol || "http"));
    if (publicHost) headers["x-forwarded-host"] = publicHost;
    if (publicProtocol) headers["x-forwarded-proto"] = publicProtocol;
    return headers;
}

app.get("/health/live", (req, res) => {
    res.json(healthPayload());
});

app.get(["/health/ready", "/health/status"], (req, res) => {
    const buildExists = fs.existsSync(INDEX_HTML);
    res.status(buildExists ? 200 : 503).json(
        healthPayload({
            ok: buildExists,
            static: {
                ok: buildExists,
                index: INDEX_HTML
            }
        })
    );
});

function proxyToApi(req, res) {
    const target = new URL(req.originalUrl, API_BASE);
    const client = target.protocol === "https:" ? https : http;
    const headers = proxyRequestHeaders(req, target);
    const request = client.request(
        {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === "https:" ? 443 : 80),
            method: req.method,
            path: `${target.pathname}${target.search}`,
            headers
        },
        (response) => {
            res.statusCode = response.statusCode || 502;
            for (const [key, value] of Object.entries(response.headers)) {
                if (value !== undefined) res.setHeader(key, value);
            }
            response.pipe(res);
        }
    );
    request.on("error", (err) => {
        if (!res.headersSent) res.status(502).json({ error: `API proxy failed: ${err.message}` });
    });
    req.pipe(request);
}

app.use(["/reader-auth", "/reader-api"], proxyToApi);
app.use(
    express.static(DIST_DIR, {
        index: false,
        etag: true,
        lastModified: true,
        maxAge: "7d",
        immutable: true,
        setHeaders(res, filePath) {
            if (filePath.endsWith("index.html")) {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    })
);

app.get("*", (req, res) => {
    if (!fs.existsSync(INDEX_HTML)) {
        res.status(500).send(`Reader build not found. Run "npm run reader:build" first. Missing: ${INDEX_HTML}`);
        return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(INDEX_HTML);
});

function start() {
    return app.listen(PORT, HOST, () => {
        console.log(`[reader] http://${HOST}:${PORT}`);
        console.log(`[reader] API proxy -> ${API_BASE}`);
        console.log(`[reader] static -> ${DIST_DIR}`);
    });
}

if (require.main === module) start();

module.exports = { app, firstForwardedValue, healthPayload, proxyRequestHeaders, proxyToApi, start };
