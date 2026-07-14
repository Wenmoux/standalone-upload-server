/**
 * [INPUT]: 依赖 PgBotClient、Telegram 文本投递、账户格式器、命令帮助与私聊导出续接协议
 * [OUTPUT]: 对外提供注册保障、/start、/reg、/me 与 /sign 账户处理器
 * [POS]: bot 的账户交互层，连接 Reader 用户事实与 Telegram 文案，不承载命令注册和轮询状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createAccountHandlers(options = {}) {
    const client = options.client;
    const sendMessage = options.sendMessage;
    const deliverLongGroupResult = options.deliverLongGroupResult;
    const escapeHtml = options.escapeHtml;
    const scholarText = options.scholarText;
    const freeExportText = options.freeExportText;
    const startHelpText = options.startHelpText;
    const registerText = options.registerText;
    const meText = options.meText;
    const signSuccessText = options.signSuccessText;
    const refreshCommandSettings = options.refreshCommandSettings || (async () => {});
    const helpLinesFromCommands = options.helpLinesFromCommands || (() => []);
    const takePrivateExportStart = options.takePrivateExportStart || (() => null);
    const scheduleExport = options.scheduleExport;
    const epubStyleChoices = options.epubStyleChoices || [];

    async function ensureRegistered(user) {
        const found = await client.getUser(user.id);
        if (found) return found;
        const created = await client.registerUser(user);
        return created.user;
    }

    async function handleStart(message, payload) {
        await refreshCommandSettings();
        const user = await ensureRegistered(message.from);
        const pendingExport = takePrivateExportStart(payload, message.from.id);
        if (pendingExport) {
            await sendMessage(
                message.chat.id,
                [
                    "私聊已授权，开始继续刚才的导出。",
                    `书号：<code>${escapeHtml(pendingExport.bookId)}</code>`,
                    `格式：${escapeHtml(pendingExport.format.toUpperCase())}`,
                    pendingExport.epubStyleId
                        ? `样式：${escapeHtml(epubStyleChoices.find((item) => item.id === pendingExport.epubStyleId)?.label || pendingExport.epubStyleId)}`
                        : ""
                ]
                    .filter(Boolean)
                    .join("\n")
            ).catch(() => {});
            return scheduleExport(message.chat, message.from, pendingExport.bookId, pendingExport.format, {
                epubStyleId: pendingExport.epubStyleId
            });
        }
        await deliverLongGroupResult(
            message,
            startHelpText({
                user,
                payload,
                helpLines: helpLinesFromCommands(),
                escapeHtml,
                scholarText
            }),
            {},
            { title: "Bot 帮助" }
        );
    }

    async function handleRegister(message, payload) {
        const result = await client.registerUser(message.from, payload);
        await sendMessage(message.chat.id, registerText(result, { escapeHtml, scholarText }));
    }

    async function handleMe(message) {
        await ensureRegistered(message.from);
        const data = await client.me(message.from.id);
        await deliverLongGroupResult(
            message,
            meText({
                user: data.user || {},
                stats: data.stats || {},
                telegramId: message.from.id,
                escapeHtml,
                scholarText,
                freeExportText
            }),
            {},
            { title: "我的账户" }
        );
    }

    async function handleSign(message) {
        await ensureRegistered(message.from);
        try {
            const result = await client.sign(message.from.id);
            await sendMessage(message.chat.id, signSuccessText(result, { escapeHtml, scholarText }));
        } catch (err) {
            if (err.status === 409) return sendMessage(message.chat.id, "今天已经签到过了。");
            throw err;
        }
    }

    return {
        ensureRegistered,
        handleMe,
        handleRegister,
        handleSign,
        handleStart
    };
}

module.exports = {
    createAccountHandlers
};
