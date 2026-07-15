/**
 * [INPUT]: 依赖 Bot API 客户端、Telegram 投递/私聊不可达识别、导出构建器、计价规则、EPUB 样式协议和临时文件系统
 * [OUTPUT]: 对外提供私聊导出续接、EPUB 样式提示、私聊可达性检查和成功后幂等结算状态机
 * [POS]: bot 的导出投递边界，连接 export-builder 产物与 Telegram/用户经济，但不持有命令注册和轮询生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const path = require("path");

function createExportDelivery(options = {}) {
    const client = options.client;
    const telegram = options.telegram;
    const sendMessage = options.sendMessage;
    const editMessage = options.editMessage;
    const sendDocument = options.sendDocument;
    const isGroup = options.isGroup;
    const escapeHtml = options.escapeHtml;
    const asExportError = options.asExportError;
    const formatExportFailure = options.formatExportFailure;
    const isPrivateChatUnavailableError = options.isPrivateChatUnavailableError;
    const normalizeEpubStyleChoice = options.normalizeEpubStyleChoice;
    const epubStyleChoices = options.epubStyleChoices || [];
    const epubStyleSelectionMarkup = options.epubStyleSelectionMarkup;
    const callback = options.callback;
    const ensureRegistered = options.ensureRegistered;
    const buildExport = options.buildExport;
    const normalizeExportPricing = options.normalizeExportPricing;
    const exportQuote = options.exportQuote;
    const exportQuoteText = options.exportQuoteText;
    const freeExportText = options.freeExportText;
    const botUserProvider = options.botUserProvider || (() => null);
    const privateExportStartTtlMs = Number(options.privateExportStartTtlMs || 30 * 60 * 1000);
    const privateExportStarts = options.privateExportStarts || new Map();
    const now = options.now || Date.now;
    const random = options.random || Math.random;
    const removeDirectory = options.removeDirectory || ((dir) => fs.rm(dir, { recursive: true, force: true }));

    function botPrivateUrl(payload = "") {
        const username = String(botUserProvider()?.username || "").trim();
        if (!username) return "";
        const suffix = payload ? `?start=${encodeURIComponent(payload)}` : "";
        return `https://t.me/${username}${suffix}`;
    }

    function cleanupPrivateExportStarts() {
        const current = now();
        for (const [key, pending] of privateExportStarts.entries()) {
            if (!pending?.createdAt || current - pending.createdAt > privateExportStartTtlMs) privateExportStarts.delete(key);
        }
    }

    function rememberPrivateExportStart(from = {}, chat = {}, bookId = "", format = "txt", exportOptions = {}) {
        cleanupPrivateExportStarts();
        const key = `ex_${now().toString(36)}_${random().toString(36).slice(2, 8)}`;
        privateExportStarts.set(key, {
            userId: String(from.id || ""),
            chatId: String(typeof chat === "object" ? chat.id : chat || ""),
            bookId: String(bookId || "").trim(),
            format: String(format || "txt").trim(),
            epubStyleId: normalizeEpubStyleChoice(exportOptions.epubStyleId),
            createdAt: now()
        });
        return key;
    }

    function takePrivateExportStart(payload = "", userId = "") {
        cleanupPrivateExportStarts();
        const key = String(payload || "").trim();
        if (!key.startsWith("ex_")) return null;
        const pending = privateExportStarts.get(key);
        if (!pending || String(pending.userId) !== String(userId || "")) return null;
        privateExportStarts.delete(key);
        return pending;
    }

    function privateExportStartMarkup(payload = "") {
        const url = botPrivateUrl(payload);
        return url ? { inline_keyboard: [[{ text: "打开私聊继续导出", url }]] } : undefined;
    }

    async function canSendPrivateMessage(userId) {
        try {
            await telegram("sendChatAction", { chat_id: userId, action: "upload_document" });
            return true;
        } catch (err) {
            if (isPrivateChatUnavailableError(err)) return false;
            throw err;
        }
    }

    async function requestEpubStyle(chat, _from, bookId) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(chatId, "用法：/exportepub 书号");
        return sendMessage(
            chatId,
            ["请选择 EPUB 生成样式：", `<code>${escapeHtml(id)}</code>`, "选择后才会开始生成和计算导出费用。"].join("\n"),
            { reply_markup: epubStyleSelectionMarkup(id, callback) }
        );
    }

    async function sendExport(chat, from, bookId, format, _signal, exportOptions = {}) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const groupExport = typeof chat === "object" && isGroup(chat);
        const id = String(bookId || "").trim();
        if (!id) throw asExportError("EXPORT_MISSING_BOOK_ID", `用法：/export${format} 书号`);
        await ensureRegistered(from);
        const [permission, pricingData, bookData] = await Promise.all([
            client.exportPermission(from.id, id),
            client.exportPricing().catch(() => ({})),
            client.getBook(id)
        ]);
        const pricing = normalizeExportPricing(pricingData.pricing ? pricingData : permission.pricing || {});
        const freeExport = permission.free_export || {};
        const canUseDailyExport = !!freeExport.available;
        const canUseExtraExport = !!freeExport.extra_book_already_used || Number(freeExport.extra_remaining || 0) > 0;
        if (groupExport && !(await canSendPrivateMessage(from.id))) {
            const payload = rememberPrivateExportStart(from, chat, id, format, exportOptions);
            const failure = formatExportFailure(
                asExportError("EXPORT_PRIVATE_CHAT_REQUIRED", "Forbidden: bot can't initiate conversation with a user")
            );
            await sendMessage(
                chatId,
                [
                    failure.message,
                    `错误码：${failure.code}`,
                    "Telegram 不允许 Bot 主动私聊未 /start 的用户。",
                    "点下面按钮打开私聊，发送 /start 后会自动继续这次导出。"
                ].join("\n"),
                { reply_markup: privateExportStartMarkup(payload) }
            );
            return;
        }
        const epubStyleId = normalizeEpubStyleChoice(exportOptions.epubStyleId);
        const epubStyleLabel = epubStyleChoices.find((item) => item.id === epubStyleId)?.label || "";
        const progress = await sendMessage(
            chatId,
            `正在生成 ${format.toUpperCase()}${epubStyleLabel ? `（${escapeHtml(epubStyleLabel)}）` : ""}：<code>${escapeHtml(id)}</code>`
        );
        let result = null;
        try {
            const savedEpubConfig = pricingData.pricing?.epub || pricingData.epub || {};
            result = await buildExport(bookData.book, format, from, {
                epub: epubStyleId ? { ...savedEpubConfig, styleId: epubStyleId } : savedEpubConfig
            });
            const quote = exportQuote(result, pricing);
            const paidBook = Number(quote.paidChapters || 0) > 0;
            const user = permission.user || {};
            if (paidBook && !permission.unlocked && !canUseDailyExport && !canUseExtraExport) {
                const exportErr = asExportError("EXPORT_FREE_QUOTA_USED", "paid export quota used");
                exportErr.userNotified = true;
                const failure = formatExportFailure(exportErr);
                await editMessage(
                    chatId,
                    progress.message_id,
                    [
                        failure.message,
                        `错误码：${failure.code}`,
                        freeExportText(freeExport),
                        `授权价格：${pricing.unlockCost} 银币`,
                        `当前银币：${user.silver_coins ?? 0}`,
                        "付费章节导出可使用每日免费额度、额外下载次数，或开通导出授权后按收费章节扣银币。"
                    ].join("\n"),
                    { reply_markup: { inline_keyboard: [[{ text: "开通导出授权", callback_data: callback(["unlock", id]) }]] } }
                ).catch(() => {});
                throw exportErr;
            }
            if (!paidBook && quote.amount > 0 && Number(user.copper_coins || 0) < Number(quote.amount || 0)) {
                const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", `copper insufficient, need ${quote.amount}`);
                exportErr.userNotified = true;
                const failure = formatExportFailure(exportErr);
                await editMessage(
                    chatId,
                    progress.message_id,
                    [
                        failure.message,
                        `错误码：${failure.code}`,
                        `本次费用：${exportQuoteText(quote)}`,
                        `当前铜币：${user.copper_coins ?? 0}`
                    ].join("\n")
                ).catch(() => {});
                throw exportErr;
            }
            if (
                paidBook &&
                permission.unlocked &&
                !canUseDailyExport &&
                !canUseExtraExport &&
                quote.amount > 0 &&
                Number(user.silver_coins || 0) < Number(quote.amount || 0)
            ) {
                const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", `silver insufficient, need ${quote.amount}`);
                exportErr.userNotified = true;
                const failure = formatExportFailure(exportErr);
                await editMessage(
                    chatId,
                    progress.message_id,
                    [
                        failure.message,
                        `错误码：${failure.code}`,
                        `本次费用：${exportQuoteText(quote)}`,
                        `当前银币：${user.silver_coins ?? 0}`
                    ].join("\n")
                ).catch(() => {});
                throw exportErr;
            }

            const settlementOptions = exportOptions.settlementKey
                ? {
                      idempotencyKey: exportOptions.settlementKey,
                      idempotencyScope: "export-settlement",
                      bookId: result.book.book_id
                  }
                : {};

            async function settleSuccessfulExport() {
                if (paidBook) {
                    if (canUseDailyExport) {
                        try {
                            const claimed = await client.claimFreeExport(from.id, result.book.book_id, format, settlementOptions);
                            return { kind: "daily", usage: claimed.usage || null };
                        } catch (err) {
                            if (err.status !== 409) throw err;
                        }
                    }
                    if (canUseExtraExport) {
                        try {
                            const claimed = await client.claimExtraExport(from.id, result.book.book_id, format, settlementOptions);
                            return { kind: "extra", usage: claimed.usage || null };
                        } catch (err) {
                            if (err.status !== 409) throw err;
                        }
                    }
                    if (!permission.unlocked) throw asExportError("EXPORT_FREE_QUOTA_USED", "paid export quota used");
                }
                if (quote.amount > 0) {
                    await client.spendCurrency(
                        from.id,
                        quote.currency,
                        quote.amount,
                        `export_${format}_fee`,
                        `${result.book.book_id} ${result.chapters} chapters paid=${quote.paidChapters}`,
                        "telegram_bot",
                        settlementOptions
                    );
                    return { kind: "currency", quote };
                }
                return { kind: "free", quote };
            }

            async function recordAndSettle() {
                await client
                    .recordUserEvent(from.id, `export_${format}`, `${result.book.book_id} ${result.chapters} chapters`)
                    .catch(() => {});
                try {
                    return await settleSuccessfulExport();
                } catch (err) {
                    const message =
                        err.status === 409 ? (err.data?.quota ? freeExportText(err.data.quota) : err.message) : err.message || String(err);
                    if (err.status === 409) {
                        const exportErr = asExportError("EXPORT_INSUFFICIENT_BALANCE", err.message || "insufficient balance", err);
                        exportErr.userNotified = true;
                        throw exportErr;
                    }
                    throw Object.assign(err, { settlementMessage: message });
                }
            }

            const exportTitle = escapeHtml(result.book.title || result.book.book_id);
            const exportSummary = `${exportTitle}\n已导出 ${result.chapters} 章`;
            if (groupExport) {
                try {
                    await sendDocument(from.id, result.filePath, exportSummary);
                    await recordAndSettle();
                    await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 已私聊发送：${exportSummary}`).catch(() => {});
                } catch (err) {
                    if (isPrivateChatUnavailableError(err)) {
                        const exportErr = asExportError("EXPORT_PRIVATE_CHAT_REQUIRED", err.message || "private chat required", err);
                        exportErr.userNotified = true;
                        const failure = formatExportFailure(exportErr);
                        const payload = rememberPrivateExportStart(from, chat, id, format, exportOptions);
                        await editMessage(
                            chatId,
                            progress.message_id,
                            [
                                failure.message,
                                `错误码：${failure.code}`,
                                `原因：${escapeHtml(failure.raw || err.message)}`,
                                "点下面按钮打开私聊，发送 /start 后会自动继续这次导出。"
                            ].join("\n"),
                            { reply_markup: privateExportStartMarkup(payload) }
                        ).catch(() => {});
                        throw exportErr;
                    }
                    await editMessage(
                        chatId,
                        progress.message_id,
                        [
                            `${format.toUpperCase()} 已私聊发送：${exportSummary}`,
                            `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`
                        ].join("\n")
                    ).catch(() => {});
                    err.userNotified = true;
                    throw err;
                }
                return;
            }
            await sendDocument(chatId, result.filePath, exportSummary);
            try {
                await recordAndSettle();
            } catch (err) {
                await editMessage(
                    chatId,
                    progress.message_id,
                    [
                        `${format.toUpperCase()} 导出完成：${exportSummary}`,
                        `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`
                    ].join("\n")
                ).catch(() => {});
                err.userNotified = true;
                throw err;
            }
            await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 导出完成：${exportSummary}`).catch(() => {});
        } finally {
            if (result?.filePath) await removeDirectory(path.dirname(result.filePath)).catch(() => {});
        }
    }

    return {
        botPrivateUrl,
        canSendPrivateMessage,
        privateExportStartMarkup,
        rememberPrivateExportStart,
        requestEpubStyle,
        sendExport,
        takePrivateExportStart
    };
}

module.exports = {
    createExportDelivery
};
