function createTaskSchedulers(deps = {}) {
    const {
        botTaskQueue,
        sendMessage,
        isGroup,
        sendExport,
        handleMyBookshelf,
        handleShare,
        handleShareBookshelf
    } = deps;

    function scheduleExport(chat, from, bookId, format) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(chatId, `用法：/export${format} 书号`);
        const label = `${format.toUpperCase()} 导出`;
        return botTaskQueue.enqueue({
            name: `export:${format}:${from.id}:${id}`,
            label,
            chatId,
            bookId: id,
            format,
            systemJobType: `bot_export_${format}`,
            systemJobCreatedBy: `telegram:${from.id}`,
            systemJobInput: {
                telegram_id: String(from.id || ""),
                chat_id: String(chatId || ""),
                book_id: id,
                format,
                group_chat: typeof chat === "object" && isGroup(chat)
            },
            lockKey: `export:${from.id}`,
            task: () => sendExport(chat, from, id, format)
        });
    }

    function scheduleMyBookshelf(message) {
        return botTaskQueue.enqueue({
            name: `mybookshelf:${message.from.id}`,
            label: "PO18 书架同步",
            chatId: message.chat.id,
            systemJobType: "bot_po18_bookshelf_sync",
            systemJobCreatedBy: `telegram:${message.from.id}`,
            systemJobInput: {
                telegram_id: String(message.from.id || ""),
                chat_id: String(message.chat.id || "")
            },
            lockKey: `mybookshelf:${message.from.id}`,
            task: () => handleMyBookshelf(message)
        });
    }

    function scheduleShare(message, bookId) {
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(message.chat.id, "用法：共享 书号");
        return botTaskQueue.enqueue({
            name: `share:${message.from.id}:${id}`,
            label: "共享上传",
            chatId: message.chat.id,
            bookId: id,
            systemJobType: "bot_share_upload",
            systemJobCreatedBy: `telegram:${message.from.id}`,
            systemJobInput: {
                telegram_id: String(message.from.id || ""),
                chat_id: String(message.chat.id || ""),
                book_id: id
            },
            lockKey: `share:${message.from.id}`,
            task: () => handleShare(message, id)
        });
    }

    function scheduleShareBookshelf(message) {
        return botTaskQueue.enqueue({
            name: `sharebookshelf:${message.from.id}`,
            label: "PO18 书架上传共享",
            chatId: message.chat.id,
            systemJobType: "bot_po18_bookshelf_share",
            systemJobCreatedBy: `telegram:${message.from.id}`,
            systemJobInput: {
                telegram_id: String(message.from.id || ""),
                chat_id: String(message.chat.id || "")
            },
            lockKey: `sharebookshelf:${message.from.id}`,
            task: () => handleShareBookshelf(message)
        });
    }

    return { scheduleExport, scheduleMyBookshelf, scheduleShare, scheduleShareBookshelf };
}

module.exports = { createTaskSchedulers };
