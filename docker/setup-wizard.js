#!/usr/bin/env node

const http = require("http");
const { handlePanelRequest, logSetupToken, setupToken } = require("./control-panel");

const HOST = process.env.PO18_SETUP_HOST || process.env.PO18_UPLOAD_HOST || "0.0.0.0";
const PORT = Number(process.env.PO18_SETUP_PORT || process.env.PO18_UPLOAD_PORT || 3100);
const CONFIG_FILE = process.env.PO18_SETUP_CONFIG_FILE || process.env.PO18_CONFIG_FILE || "/config/app.env";
let restartScheduled = false;

function exitForRestart() {
    if (process.env.PO18_SETUP_AUTO_RESTART === "0" || restartScheduled) return;
    restartScheduled = true;
    console.log("[setup] config saved; exiting so Docker restart policy can start app services");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}

setupToken(CONFIG_FILE);

const server = http.createServer((req, res) => {
    handlePanelRequest(req, res, {
        configFile: CONFIG_FILE,
        onRestart: exitForRestart
    }).catch((err) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end(err.message || String(err));
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[setup] http://${HOST}:${PORT}`);
    console.log(`[setup] config file: ${CONFIG_FILE}`);
    logSetupToken({ host: HOST, port: PORT, configFile: CONFIG_FILE });
});
