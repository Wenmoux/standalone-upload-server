#!/usr/bin/env node

/**
 * [INPUT]: 依赖 control-panel 请求处理器、Setup 专用 host/port 与目标配置文件
 * [OUTPUT]: 启动首次配置 HTTP 服务，保存配置后以退出语义交还 Docker restart policy
 * [POS]: docker 的最小初始化进程，仅在尚无可用数据库配置时运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

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
