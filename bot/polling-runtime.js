/**
 * [INPUT]: 依赖 Telegram getUpdates 客户端、update 处理器、server 连通检查、命令同步和可注入退避时钟
 * [OUTPUT]: 对外提供长轮询单次执行、永久运行、启动重试和健康状态快照
 * [POS]: bot Telegram 传输生命周期管理器，只负责 offset、退避、统计与连接状态，不承载业务命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createTelegramPollingRuntime(deps = {}) {
    const {
        telegram,
        handleUpdate,
        sendMessage,
        escapeHtml = (value) => String(value ?? ""),
        delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        pollTimeout = 25,
        pollRetryDelayMs = 3000,
        startupRetryDelayMs = 10000,
        allowedUpdates = ["message", "callback_query"],
        client,
        syncBotCommands,
        telegramApiBase = "https://api.telegram.org",
        onConnected,
        logger = console
    } = deps;

    let offset = 0;
    let botUser = null;
    let lastStartupOkAt = 0;
    let lastStartupError = "";
    let lastPollOkAt = 0;
    let lastPollError = "";
    let pollRequests = 0;
    let pollFailures = 0;
    let updatesReceived = 0;
    const pollDurations = [];

    function pollPercentile(ratio) {
        if (!pollDurations.length) return 0;
        const sorted = pollDurations.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    }

    function state() {
        return {
            botUser,
            lastStartupOkAt,
            lastStartupError,
            lastPollOkAt,
            lastPollError,
            polling: {
                requests_total: pollRequests,
                failures_total: pollFailures,
                updates_total: updatesReceived,
                latency_p50_ms: pollPercentile(0.5),
                latency_p95_ms: pollPercentile(0.95)
            }
        };
    }

    async function pollOnce() {
        const startedAt = Date.now();
        pollRequests += 1;
        let updates;
        try {
            updates = await telegram("getUpdates", {
                offset,
                timeout: pollTimeout,
                allowed_updates: allowedUpdates
            });
        } catch (error) {
            pollFailures += 1;
            lastPollError = error.message || String(error);
            throw error;
        } finally {
            pollDurations.push(Math.max(0, Date.now() - startedAt));
            if (pollDurations.length > 500) pollDurations.splice(0, pollDurations.length - 500);
        }
        lastPollOkAt = Date.now();
        lastPollError = "";
        updatesReceived += (updates || []).length;
        for (const update of updates || []) {
            offset = Number(update.update_id || 0) + 1;
            try {
                await handleUpdate(update);
            } catch (err) {
                const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
                logger.error?.(err);
                if (chatId) {
                    await sendMessage(chatId, `处理失败：${escapeHtml(err.message)}`).catch(() => {});
                }
            }
        }
        return updates || [];
    }

    async function pollForever() {
        while (true) {
            try {
                await pollOnce();
            } catch (err) {
                lastPollError = err.message || String(err);
                logger.error?.(`[poll] ${err.message || String(err)}`);
                await delay(pollRetryDelayMs);
            }
        }
    }

    async function runForever() {
        while (true) {
            try {
                if (client && typeof client.health === "function") await client.health();
                botUser = await telegram("getMe");
                lastStartupOkAt = Date.now();
                lastStartupError = "";
                if (typeof syncBotCommands === "function") await syncBotCommands();
                await onConnected?.(botUser);
                await pollForever();
            } catch (err) {
                lastStartupError = err.message || String(err);
                logger.error?.(`[telegram-bot] startup failed: ${err.message || String(err)}`);
                if (String(err.message || "").includes("network failed") && telegramApiBase === "https://api.telegram.org") {
                    logger.error?.("[telegram-bot] Cannot reach https://api.telegram.org. Check network access, firewall/proxy, or set TELEGRAM_API_BASE to a reachable Bot API mirror/self-hosted endpoint.");
                }
                await delay(startupRetryDelayMs);
            }
        }
    }

    return { pollForever, pollOnce, runForever, state };
}

module.exports = { createTelegramPollingRuntime };
