/**
 * [INPUT]: 依赖 EPUB 自定义状态解析、模板面板、Bot 审计/限流、持久导出调度与消息发送能力
 * [OUTPUT]: 对外提供 Telegram EPUB 自定义回调处理器
 * [POS]: bot 的 EPUB 自定义交互领域层，把底板切换、开关预览和确认导出从 telegram-bot 组合根移出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createEpubCustomHandler(options = {}) {
    const parseEpubCustomState = options.parseEpubCustomState;
    const requestEpubCustomization = options.requestEpubCustomization;
    const requestEpubStyle = options.requestEpubStyle;
    const scheduleExport = options.scheduleExport;
    const sendMessage = options.sendMessage;
    const withBotAudit = options.withBotAudit;
    const withCooldown = options.withCooldown;
    const exportCooldownMs = options.exportCooldownMs;

    return async function handleEpubCustom(input = {}) {
        const operation = String(input.operation || "open");
        const styleId = String(input.state?.[0] || "style1");
        const flags = String(input.state?.[1] || "11");
        const bookId = String(input.state?.[2] || "").trim();
        const message = input.message;
        if (!bookId) return sendMessage(message.chat.id, "EPUB 书号无效，请重新选择。");
        const epubConfig = parseEpubCustomState(styleId, flags);
        if (operation === "back") {
            return requestEpubStyle(message.chat, input.from, bookId, { messageId: message.message_id });
        }
        if (operation !== "export") {
            return requestEpubCustomization(message.chat, bookId, epubConfig, { messageId: message.message_id });
        }
        return withBotAudit(
            input.callbackMessage,
            "/exportepub",
            "export_epub_custom",
            { book_id: bookId, style_id: epubConfig.styleId },
            () =>
                withCooldown(input.callbackMessage, "export", exportCooldownMs, "导出", () =>
                    scheduleExport(message.chat, input.from, bookId, "epub", {
                        epubStyleId: epubConfig.styleId,
                        epubConfig
                    })
                )
        );
    };
}

module.exports = { createEpubCustomHandler };
