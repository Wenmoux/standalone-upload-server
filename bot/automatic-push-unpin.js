/**
 * [INPUT]: 依赖根级 Telegram 系统推送标记契约、Telegram 通用请求函数与置顶服务消息
 * [OUTPUT]: 对外提供自动转发系统推送的精确取消置顶目标解析器和容错处理器
 * [POS]: bot 的群组维护策略，只处理带系统标记的频道自动转发，人工消息与人工频道帖保持不变
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { hasTelegramSystemPushMarker } = require("../telegram-push-contract");

function automaticPushUnpinTarget(message = {}) {
    const pinnedMessage = message?.pinned_message;
    const chatId = message?.chat?.id;
    const messageId = Number(pinnedMessage?.message_id);
    const content = pinnedMessage?.text ?? pinnedMessage?.caption ?? "";
    if (chatId === undefined || chatId === null) return null;
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return null;
    if (pinnedMessage?.is_automatic_forward !== true) return null;
    if (!hasTelegramSystemPushMarker(content)) return null;
    return { chatId, messageId };
}

function createAutomaticPushUnpinHandler(options = {}) {
    const telegram = options.telegram;
    const logger = options.logger || console;

    return async function maybeUnpinAutomaticPush(message = {}) {
        const target = automaticPushUnpinTarget(message);
        if (!target) return false;
        try {
            await telegram("unpinChatMessage", {
                chat_id: target.chatId,
                message_id: target.messageId
            });
        } catch (err) {
            logger.warn?.(`[telegram-bot] automatic push unpin failed: ${err.message || String(err)}`);
        }
        return true;
    };
}

module.exports = {
    automaticPushUnpinTarget,
    createAutomaticPushUnpinHandler
};
