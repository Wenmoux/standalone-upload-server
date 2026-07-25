#!/usr/bin/env node

/**
 * [INPUT]: 依赖 PgBotClient、QQ API/Gateway、消息与导出运行时，以及 server-pg 下发的加密配置投影
 * [OUTPUT]: 启动可热加载启停/凭据/搜索范围的 QQ Bot 长连接进程
 * [POS]: qq-bot 的进程组合根，只装配依赖和生命周期；搜索、导出、协议细节分别委托领域模块
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const crypto = require("crypto");
const { PgBotClient } = require("../bot/pg-bot-client");
const { createQqApiClient } = require("./qq-api");
const { createQqExportRuntime } = require("./export-runtime");
const { createQqGateway } = require("./gateway");
const { createQqMessageRuntime } = require("./message-runtime");

const CONFIG_POLL_MS = Math.max(5000, Number(process.env.QQ_BOT_CONFIG_POLL_MS || 15000));
const RECONNECT_MAX_MS = Math.max(5000, Number(process.env.QQ_BOT_RECONNECT_MAX_MS || 60000));
const client = new PgBotClient();
let currentConfig = null;
let configLoadedAt = 0;
let stopped = false;
let activeGateway = null;
let watchGeneration = 0;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function credentialFingerprint(config = {}) {
    return crypto
        .createHash("sha256")
        .update(`${config.enabled ? 1 : 0}\0${config.appId || ""}\0${config.appSecret || ""}`)
        .digest("hex");
}

async function refreshConfig(force = false) {
    if (!force && currentConfig && Date.now() - configLoadedAt < CONFIG_POLL_MS) return currentConfig;
    currentConfig = await client.qqBotConfig();
    configLoadedAt = Date.now();
    return currentConfig;
}

const api = createQqApiClient({
    credentials: async () => {
        const config = await refreshConfig();
        return { appId: config.appId, appSecret: config.appSecret };
    },
    apiBase: process.env.QQ_BOT_API_BASE,
    tokenUrl: process.env.QQ_BOT_TOKEN_URL,
    timeoutMs: process.env.QQ_BOT_REQUEST_TIMEOUT_MS
});

let messageRuntime = null;
const exportRuntime = createQqExportRuntime({
    client,
    sendMessage: (...args) => messageRuntime.sendText(...args),
    sendFile: (...args) => messageRuntime.sendFile(...args)
});
messageRuntime = createQqMessageRuntime({
    client,
    api,
    configProvider: refreshConfig,
    exportRuntime,
    searchLimit: process.env.QQ_BOT_SEARCH_LIMIT,
    logger: console
});

async function watchConfig(fingerprint, gateway, generation) {
    while (!stopped && generation === watchGeneration) {
        await delay(CONFIG_POLL_MS);
        try {
            const config = await refreshConfig(true);
            if (credentialFingerprint(config) !== fingerprint) {
                gateway.stop();
                return;
            }
        } catch (err) {
            console.error(`[qq-bot] config refresh failed: ${err.message || err}`);
        }
    }
}

async function main() {
    let failures = 0;
    let disabledLogged = false;
    let gatewayFingerprint = "";
    let gateway = null;
    while (!stopped) {
        try {
            const config = await refreshConfig(true);
            if (!config.enabled || !config.appId || !config.appSecret) {
                if (!disabledLogged) console.log("[qq-bot] disabled or credentials incomplete; waiting for Admin configuration");
                disabledLogged = true;
                failures = 0;
                await delay(CONFIG_POLL_MS);
                continue;
            }
            disabledLogged = false;
            const [gatewayUrl, accessToken] = await Promise.all([api.gateway(), api.accessToken()]);
            const fingerprint = credentialFingerprint(config);
            if (!gateway || gatewayFingerprint !== fingerprint) {
                gateway = createQqGateway({ onEvent: messageRuntime.handle, logger: console });
                gatewayFingerprint = fingerprint;
            }
            activeGateway = gateway;
            failures = 0;
            const generation = ++watchGeneration;
            await Promise.race([gateway.run({ url: gatewayUrl, accessToken }), watchConfig(fingerprint, gateway, generation)]);
            watchGeneration += 1;
            activeGateway = null;
        } catch (err) {
            failures += 1;
            const waitMs = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(6, failures));
            console.error(`[qq-bot] connection failed: ${err.message || err}; retrying in ${waitMs}ms`);
            await delay(waitMs);
        }
    }
}

function shutdown() {
    stopped = true;
    watchGeneration += 1;
    activeGateway?.stop();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);

if (require.main === module) {
    main().catch((err) => {
        console.error(`[qq-bot] fatal: ${err.message || err}`);
        process.exitCode = 1;
    });
}

module.exports = { credentialFingerprint, main, refreshConfig, shutdown };
