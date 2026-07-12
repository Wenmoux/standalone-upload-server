/**
 * [INPUT]: 依赖 botTaskQueue、Telegram 消息接口和导出、书架同步、共享、注册用户广播领域执行器
 * [OUTPUT]: 对外提供持久 Bot 任务类型、幂等任务构造与导出/同步/共享/全员通知调度和恢复工厂
 * [POS]: bot 任务域的声明式调度层，统一任务类型、互斥键、持久输入和实际执行函数之间的映射
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const PERSISTENT_BOT_JOB_TYPES = [
    "bot_export_txt",
    "bot_export_epub",
    "bot_po18_bookshelf_sync",
    "bot_share_upload",
    "bot_po18_bookshelf_share"
];

function createTaskSchedulers(deps = {}) {
    const {
        botTaskQueue,
        sendMessage,
        isGroup,
        sendExport,
        handleMyBookshelf,
        handleShare,
        handleShareBookshelf,
        sendRegisteredUserBroadcast
    } = deps;

    function exportJob(chat, from, bookId, format, exportOptions = {}) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return null;
        const epubStyleId = format === "epub" ? String(exportOptions.epubStyleId || "").trim() : "";
        const label = `${format.toUpperCase()} 导出`;
        return {
            name: `export:${format}:${from.id}:${id}${epubStyleId ? `:${epubStyleId}` : ""}`,
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
                group_chat: typeof chat === "object" && isGroup(chat),
                ...(epubStyleId ? { epub_style_id: epubStyleId } : {})
            },
            idempotencyKey: `bot:export:${format}:${from.id}:${id}${epubStyleId ? `:${epubStyleId}` : ""}`,
            maxAttempts: 3,
            lockKey: `export:${from.id}`,
            task: (signal, runtimeJob = {}) => sendExport(chat, from, id, format, signal, {
                epubStyleId,
                settlementKey: runtimeJob.systemJobId ? `system-job:${runtimeJob.systemJobId}:export-settlement` : ""
            })
        };
    }

    function bookshelfJob(message) {
        return {
            name: `mybookshelf:${message.from.id}`,
            label: "PO18 书架同步",
            chatId: message.chat.id,
            systemJobType: "bot_po18_bookshelf_sync",
            systemJobCreatedBy: `telegram:${message.from.id}`,
            systemJobInput: {
                telegram_id: String(message.from.id || ""),
                chat_id: String(message.chat.id || "")
            },
            idempotencyKey: `bot:bookshelf:${message.from.id}`,
            maxAttempts: 5,
            lockKey: `mybookshelf:${message.from.id}`,
            task: (signal) => handleMyBookshelf(message, signal)
        };
    }

    function shareJob(message, bookId) {
        const id = String(bookId || "").trim();
        if (!id) return null;
        return {
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
            idempotencyKey: `bot:share:${message.from.id}:${id}`,
            maxAttempts: 5,
            lockKey: `share:${message.from.id}`,
            task: (signal, runtimeJob = {}) => handleShare(message, id, signal, {
                systemJobId: runtimeJob.systemJobId || null
            })
        };
    }

    function shareBookshelfJob(message) {
        return {
            name: `sharebookshelf:${message.from.id}`,
            label: "PO18 书架上传共享",
            chatId: message.chat.id,
            systemJobType: "bot_po18_bookshelf_share",
            systemJobCreatedBy: `telegram:${message.from.id}`,
            systemJobInput: {
                telegram_id: String(message.from.id || ""),
                chat_id: String(message.chat.id || "")
            },
            idempotencyKey: `bot:sharebookshelf:${message.from.id}`,
            maxAttempts: 5,
            lockKey: `sharebookshelf:${message.from.id}`,
            task: (signal, runtimeJob = {}) => handleShareBookshelf(message, signal, {
                systemJobId: runtimeJob.systemJobId || null,
                rewardOperationPrefix: runtimeJob.systemJobId ? `system-job:${runtimeJob.systemJobId}:po18-share-reward` : ""
            })
        };
    }

    function broadcastJob(input = {}) {
        const content = String(input.message || "").trim();
        if (!content) return null;
        return {
            name: `broadcast:${input.job_id || Date.now()}`,
            label: "全员通知",
            chatId: String(input.chat_id || ""),
            systemJobType: "bot_registered_user_broadcast",
            systemJobCreatedBy: String(input.created_by || "telegram_bot"),
            systemJobInput: {
                message: content,
                chat_id: String(input.chat_id || ""),
                telegram_id: String(input.telegram_id || ""),
                source: input.source || "bot"
            },
            maxAttempts: 1,
            lockKey: "broadcast:registered-users",
            task: (signal) => sendRegisteredUserBroadcast(content, signal)
        };
    }

    function scheduleExport(chat, from, bookId, format, exportOptions = {}) {
        const job = exportJob(chat, from, bookId, format, exportOptions);
        if (!job) return sendMessage(typeof chat === "object" ? chat.id : chat, `用法：/export${format} 书号`);
        return botTaskQueue.enqueue(job);
    }

    function scheduleMyBookshelf(message) {
        return botTaskQueue.enqueue(bookshelfJob(message));
    }

    function scheduleShare(message, bookId) {
        const job = shareJob(message, bookId);
        if (!job) return sendMessage(message.chat.id, "用法：共享 书号");
        return botTaskQueue.enqueue(job);
    }

    function scheduleShareBookshelf(message) {
        return botTaskQueue.enqueue(shareBookshelfJob(message));
    }

    function recoverSystemJob(row = {}) {
        const input = row.input_json || {};
        const from = { id: input.telegram_id };
        const chat = { id: input.chat_id, type: input.group_chat ? "group" : "private" };
        const message = { from, chat };
        let job = null;
        if (row.type === "bot_export_txt" || row.type === "bot_export_epub") {
            job = exportJob(chat, from, input.book_id, input.format || row.type.replace("bot_export_", ""), {
                epubStyleId: input.epub_style_id || ""
            });
        } else if (row.type === "bot_po18_bookshelf_sync") {
            job = bookshelfJob(message);
        } else if (row.type === "bot_share_upload") {
            job = shareJob(message, input.book_id);
        } else if (row.type === "bot_po18_bookshelf_share") {
            job = shareBookshelfJob(message);
        } else if (row.type === "bot_registered_user_broadcast") {
            job = broadcastJob({ ...input, job_id: row.id, created_by: row.created_by });
        }
        if (!job) return null;
        job.systemJobId = row.id;
        job.systemJobClaimed = true;
        job.recovered = true;
        return job;
    }

    return {
        persistentJobTypes: PERSISTENT_BOT_JOB_TYPES,
        recoverSystemJob,
        scheduleExport,
        scheduleMyBookshelf,
        scheduleShare,
        scheduleShareBookshelf
    };
}

module.exports = { PERSISTENT_BOT_JOB_TYPES, createTaskSchedulers };
