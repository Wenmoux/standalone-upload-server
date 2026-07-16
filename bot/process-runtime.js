/**
 * [INPUT]: 依赖已装配的 Telegram/client/任务服务、命令投影、健康参数与 update 分派器
 * [OUTPUT]: 对外提供 startBotProcessRuntime，启动命令同步、持久任务恢复、广播轮询、健康服务与长轮询
 * [POS]: bot 的进程生命周期边界，把启动/恢复/健康编排从业务组合根剥离，不解析消息或实现领域命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { startBotHealthServer } = require("./health-server");
const { createTelegramPollingRuntime } = require("./polling-runtime");

function startBotProcessRuntime(options = {}) {
    let persistentJobsRecovered = false;
    let broadcastRecoveryTimer = null;
    let broadcastRecoveryRunning = false;
    const logger = options.logger || console;

    async function syncBotCommands() {
        await options.refreshCommandSettings(true);
        const commands = options.getCommandRegistry().telegramCommands();
        const scopes = [
            { type: "default" },
            { type: "all_private_chats" },
            { type: "all_group_chats" },
            { type: "all_chat_administrators" }
        ];
        for (const scope of scopes) {
            await options
                .telegram("deleteMyCommands", { scope })
                .catch((err) => logger.warn(`[telegram-bot] deleteMyCommands ${scope.type} failed: ${err.message}`));
            await options
                .telegram("setMyCommands", { commands, scope })
                .catch((err) => logger.warn(`[telegram-bot] setMyCommands ${scope.type} failed: ${err.message}`));
        }
    }

    async function recoverBroadcastJobs() {
        if (broadcastRecoveryRunning) return 0;
        const queue = options.botTaskQueue.stats();
        if (Number(queue.running || 0) > 0 || Number(queue.queued || 0) > 0) return 0;
        broadcastRecoveryRunning = true;
        try {
            return await options.recoverPersistentJobs(["bot_registered_user_broadcast"], options.recoverSystemJob, { limit: 1 });
        } finally {
            broadcastRecoveryRunning = false;
        }
    }

    const botRuntime = createTelegramPollingRuntime({
        telegram: options.telegram,
        handleUpdate: options.handleUpdate,
        sendMessage: options.sendMessage,
        escapeHtml: options.escapeHtml,
        delay: options.delay,
        pollTimeout: options.pollTimeout,
        pollRetryDelayMs: 3000,
        startupRetryDelayMs: 10000,
        client: options.client,
        syncBotCommands,
        telegramApiBase: options.telegramApiBase,
        onConnected(user) {
            options.onConnectedUser?.(user);
            logger.log(`[telegram-bot] @${user.username} connected to ${options.client.baseUrl}`);
            if (!persistentJobsRecovered) {
                persistentJobsRecovered = true;
                options
                    .recoverPersistentJobs(options.persistentJobTypes, options.recoverSystemJob)
                    .then((count) => logger.log(`[bot-task] recovered ${count} persistent jobs`))
                    .catch((err) => {
                        persistentJobsRecovered = false;
                        logger.warn(`[bot-task] recovery failed: ${err.message || String(err)}`);
                    });
            }
            if (!broadcastRecoveryTimer) {
                recoverBroadcastJobs().catch((err) => logger.warn(`[bot-task] broadcast recovery failed: ${err.message || String(err)}`));
                broadcastRecoveryTimer = setInterval(
                    () => {
                        recoverBroadcastJobs().catch((err) =>
                            logger.warn(`[bot-task] broadcast recovery failed: ${err.message || String(err)}`)
                        );
                    },
                    Math.max(2000, Number(process.env.TELEGRAM_BROADCAST_POLL_MS || 5000))
                );
                broadcastRecoveryTimer.unref?.();
            }
        }
    });

    startBotHealthServer({
        port: options.healthPort,
        host: options.healthHost,
        staleMs: options.healthStaleMs,
        startedAt: options.startedAt,
        telegramApiBase: options.telegramApiBase,
        client: options.client,
        telegramClient: options.telegramClient,
        botTaskQueue: options.botTaskQueue,
        rateLimiter: options.rateLimiter,
        stateProvider: botRuntime.state
    });

    botRuntime.runForever();
    return botRuntime;
}

module.exports = { startBotProcessRuntime };
