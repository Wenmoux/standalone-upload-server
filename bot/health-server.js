/**
 * [INPUT]: 依赖 Node HTTP、polling 状态、server/Telegram 客户端统计、任务队列和限流器快照
 * [OUTPUT]: 对外提供 Bot live/ready/status 健康载荷与独立 HTTP 健康服务启动函数
 * [POS]: bot 可观测性边界，将长轮询新鲜度和下游连通性折叠为容器编排可消费的健康状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const http = require("http");

function botHealthPayload(options = {}) {
    const {
        startedAt = Date.now(),
        staleMs = 120000,
        stateProvider = () => ({}),
        client,
        telegramClient,
        botTaskQueue,
        rateLimiter,
        telegramApiBase = ""
    } = options;
    const state = stateProvider() || {};
    const now = Date.now();
    const pollAgeMs = state.lastPollOkAt ? now - state.lastPollOkAt : null;
    const ready = !!state.botUser && !!state.lastStartupOkAt && !!state.lastPollOkAt && pollAgeMs <= staleMs;
    return {
        ok: ready,
        service: "bot",
        uptime_seconds: Math.round(process.uptime()),
        started_at: new Date(startedAt).toISOString(),
        bot_username: state.botUser?.username || "",
        server_url: client?.baseUrl || "",
        telegram_api_base: telegramApiBase,
        last_startup_ok_at: state.lastStartupOkAt ? new Date(state.lastStartupOkAt).toISOString() : null,
        last_startup_error: state.lastStartupError || "",
        last_poll_ok_at: state.lastPollOkAt ? new Date(state.lastPollOkAt).toISOString() : null,
        last_poll_error: state.lastPollError || "",
        poll_age_ms: pollAgeMs,
        polling: state.polling || {},
        telegram: typeof telegramClient?.stats === "function" ? telegramClient.stats() : undefined,
        background_tasks: botTaskQueue?.stats ? botTaskQueue.stats() : undefined,
        rate_limits: rateLimiter?.stats ? rateLimiter.stats() : undefined,
        client: typeof client?.stats === "function" ? client.stats() : undefined
    };
}

function writeJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function startBotHealthServer(options = {}) {
    const { port = 0, host = "127.0.0.1", logger = console } = options;
    if (!port) return null;
    const server = http.createServer((req, res) => {
        if (req.url === "/health/live") {
            writeJson(res, 200, { ...botHealthPayload(options), ok: true });
            return;
        }
        if (req.url === "/health/ready" || req.url === "/health/status") {
            const payload = botHealthPayload(options);
            writeJson(res, payload.ok ? 200 : 503, payload);
            return;
        }
        writeJson(res, 404, { ok: false, error: "not found" });
    });
    server.on("error", (err) => logger.error(`[bot-health] ${err.message}`));
    server.listen(port, host, () => {
        logger.log(`[bot-health] http://${host}:${port}`);
    });
    return server;
}

module.exports = { botHealthPayload, startBotHealthServer };
