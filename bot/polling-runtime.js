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

    function state() {
        return { botUser, lastStartupOkAt, lastStartupError, lastPollOkAt, lastPollError };
    }

    async function pollOnce() {
        const updates = await telegram("getUpdates", {
            offset,
            timeout: pollTimeout,
            allowed_updates: allowedUpdates
        });
        lastPollOkAt = Date.now();
        lastPollError = "";
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
