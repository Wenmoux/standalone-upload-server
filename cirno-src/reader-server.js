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
    const headers = { ...req.headers, host: target.host };
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

app.listen(PORT, HOST, () => {
    console.log(`[reader] http://${HOST}:${PORT}`);
    console.log(`[reader] API proxy -> ${API_BASE}`);
    console.log(`[reader] static -> ${DIST_DIR}`);
});
