/**
 * [INPUT]: 依赖模板工坊短状态解析、工坊/模板库面板、Bot 审计限流与持久导出调度
 * [OUTPUT]: 对外提供 Telegram EPUB 模板工坊回调处理器
 * [POS]: bot 的组件模板交互层，以无会话短状态驱动预览切换和确认生成
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createEpubStudioHandler(options = {}) {
    return async function handleEpubStudio(input = {}) {
        const operation = String(input.operation || "open");
        const encoded = String(input.state?.[0] || "");
        const bookId = String(input.state?.[1] || "").trim();
        const message = input.message;
        if (!bookId) return options.sendMessage(message.chat.id, "EPUB 书号无效，请重新选择。");
        const epubConfig = options.parseEpubStudioState(encoded);
        if (operation === "back") {
            return options.requestEpubStyle(message.chat, input.from, bookId, { messageId: message.message_id });
        }
        if (operation !== "export") {
            return options.requestEpubStudio(message.chat, bookId, epubConfig.studio, { messageId: message.message_id });
        }
        return options.withBotAudit(
            input.callbackMessage,
            "/exportepub",
            "export_epub_studio",
            { book_id: bookId, style_id: "studio" },
            () =>
                options.withCooldown(input.callbackMessage, "export", options.exportCooldownMs, "导出", () =>
                    options.scheduleExport(message.chat, input.from, bookId, "epub", {
                        epubStyleId: "studio",
                        epubConfig
                    })
                )
        );
    };
}

module.exports = { createEpubStudioHandler };
