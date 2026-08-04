/**
 * [INPUT]: 依赖 Bot API 客户端、预览 PNG 渲染器、消息平台投递/私聊不可达识别、导出构建器、计价规则、EPUB 成品/基础/工坊配置协议和临时文件系统
 * [OUTPUT]: 对外提供私聊导出续接、EPUB 模板库/实时预览/基础/工坊面板、私聊可达性检查，以及携带实际执行耗时和来源的成功后幂等结算状态机
 * [POS]: bot 的导出投递边界，连接预览/导出产物与消息平台/用户经济，但不持有命令注册和轮询生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const path = require("path");

function formatExportDuration(value) {
    const durationMs = Math.max(0, Number(value) || 0);
    if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))} 毫秒`;
    if (durationMs < 60_000) {
        const seconds = durationMs / 1000;
        return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))} 秒`;
    }
    const totalSeconds = Math.round(durationMs / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return `${totalMinutes} 分${seconds ? ` ${seconds} 秒` : ""}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} 小时${minutes ? ` ${minutes} 分` : ""}`;
}

function createExportDelivery(options = {}) {
    const client = options.client;
    const telegram = options.telegram;
    const sendMessage = options.sendMessage;
    const editMessage = options.editMessage;
    const sendPhoto = options.sendPhoto;
    const editPhoto = options.editPhoto;
    const clearReplyMarkup = options.clearReplyMarkup;
    const sendDocument = options.sendDocument;
    const isGroup = options.isGroup;
    const escapeHtml = options.escapeHtml;
    const asExportError = options.asExportError;
    const formatExportFailure = options.formatExportFailure;
    const isPrivateChatUnavailableError = options.isPrivateChatUnavailableError;
    const normalizeEpubStyleChoice = options.normalizeEpubStyleChoice;
    const normalizeEpubCustomConfig = options.normalizeEpubCustomConfig || ((value) => value || {});
    const epubStyleChoices = options.epubStyleChoices || [];
    const epubStyleSelectionMarkup = options.epubStyleSelectionMarkup;
    const epubCustomSelectionMarkup = options.epubCustomSelectionMarkup;
    const epubCustomSummary = options.epubCustomSummary;
    const epubStudioSelectionMarkup = options.epubStudioSelectionMarkup;
    const epubStudioSummary = options.epubStudioSummary;
    const callback = options.callback;
    const ensureRegistered = options.ensureRegistered;
    const buildExport = options.buildExport;
    const normalizeExportPricing = options.normalizeExportPricing;
    const exportQuote = options.exportQuote;
    const exportQuoteText = options.exportQuoteText;
    const freeExportText = options.freeExportText;
    const botUserProvider = options.botUserProvider || (() => null);
    const privateExportStartTtlMs = Number(options.privateExportStartTtlMs || 30 * 60 * 1000);
    const renderEpubPreviewPng = options.renderEpubPreviewPng;
    const privateExportStarts = options.privateExportStarts || new Map();
    const now = options.now || Date.now;
    const random = options.random || Math.random;
    const removeDirectory = options.removeDirectory || ((dir) => fs.rm(dir, { recursive: true, force: true }));
    const source = String(options.source || "telegram_bot").slice(0, 64);

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
            ...(exportOptions.epubConfig ? { epubConfig: normalizeEpubCustomConfig(exportOptions.epubConfig) } : {}),
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

    async function showEpubPanel(chatId, messageId, text, replyMarkup, display = {}) {
        if (messageId) {
            if (display.media) {
                await clearReplyMarkup?.(chatId, messageId);
                return sendMessage(chatId, text, { reply_markup: replyMarkup });
            }
            try {
                return await editMessage(chatId, messageId, text, { reply_markup: replyMarkup });
            } catch {
                // 原消息可能过期或已不可编辑，回退为新消息。
            }
        }
        return sendMessage(chatId, text, { reply_markup: replyMarkup });
    }

    async function showEpubPreview(chatId, messageId, caption, replyMarkup, config, display = {}) {
        if (!renderEpubPreviewPng || !sendPhoto) return showEpubPanel(chatId, messageId, caption, replyMarkup, display);
        try {
            const bytes = await Promise.resolve(renderEpubPreviewPng(config));
            if (messageId && display.media && editPhoto) {
                try {
                    return await editPhoto(chatId, messageId, bytes, "epub-preview.png", caption, { reply_markup: replyMarkup });
                } catch {
                    // 原消息可能不是可编辑图片，回退为新预览消息。
                }
            }
            if (messageId) await clearReplyMarkup?.(chatId, messageId);
            return await sendPhoto(chatId, bytes, "epub-preview.png", caption, { reply_markup: replyMarkup });
        } catch {
            return showEpubPanel(chatId, messageId, caption, replyMarkup, display);
        }
    }

    async function requestEpubStyle(chat, _from, bookId, display = {}) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(chatId, "用法：/exportepub 书号");
        return showEpubPanel(
            chatId,
            display.messageId,
            ["请选择 EPUB 生成样式：", `<code>${escapeHtml(id)}</code>`, "选择模板后先查看实时预览，确认后再生成。"].join("\n"),
            epubStyleSelectionMarkup(id, callback),
            display
        );
    }

    async function requestEpubCustomization(chat, bookId, value = {}, display = {}) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(chatId, "EPUB 书号无效，请重新选择。");
        const config = normalizeEpubCustomConfig(value);
        return showEpubPreview(
            chatId,
            display.messageId,
            epubCustomSummary(id, config, escapeHtml),
            epubCustomSelectionMarkup(id, config, callback),
            config,
            display
        );
    }

    async function requestEpubStudio(chat, bookId, value = {}, display = {}) {
        const chatId = typeof chat === "object" ? chat.id : chat;
        const id = String(bookId || "").trim();
        if (!id) return sendMessage(chatId, "EPUB 书号无效，请重新选择。");
        const config = normalizeEpubCustomConfig({ styleId: "studio", studio: value });
        return showEpubPreview(
            chatId,
            display.messageId,
            epubStudioSummary(id, config.studio, escapeHtml),
            epubStudioSelectionMarkup(id, config.studio, callback),
            config,
            display
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
        const customEpubConfig = exportOptions.epubConfig ? normalizeEpubCustomConfig(exportOptions.epubConfig) : null;
        const epubStyleId = normalizeEpubStyleChoice(exportOptions.epubStyleId || customEpubConfig?.styleId);
        const epubStyleLabel = epubStyleChoices.find((item) => item.id === epubStyleId)?.label || "";
        const progress = await sendMessage(
            chatId,
            `正在生成 ${format.toUpperCase()}${epubStyleLabel ? `（${escapeHtml(epubStyleLabel)}）` : ""}：<code>${escapeHtml(id)}</code>`
        );
        const exportStartedAt = now();
        const elapsedText = () => `耗时：${formatExportDuration(now() - exportStartedAt)}`;
        let result = null;
        try {
            const savedEpubConfig = pricingData.pricing?.epub || pricingData.epub || {};
            result = await buildExport(bookData.book, format, from, {
                epub: {
                    ...savedEpubConfig,
                    ...(customEpubConfig || {}),
                    ...(epubStyleId ? { styleId: epubStyleId } : {})
                }
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
                        "付费章节导出可使用每日免费额度、额外下载次数，或开通导出授权后按收费章节扣银币。",
                        elapsedText()
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
                        `当前铜币：${user.copper_coins ?? 0}`,
                        elapsedText()
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
                        `当前银币：${user.silver_coins ?? 0}`,
                        elapsedText()
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
                        source,
                        settlementOptions
                    );
                    return { kind: "currency", quote };
                }
                return { kind: "free", quote };
            }

            async function recordAndSettle() {
                await client
                    .recordUserEvent(from.id, `export_${format}`, `${result.book.book_id} ${result.chapters} chapters`, source)
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
                    await editMessage(
                        chatId,
                        progress.message_id,
                        `${format.toUpperCase()} 已私聊发送：${exportSummary}\n${elapsedText()}`
                    ).catch(() => {});
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
                                "点下面按钮打开私聊，发送 /start 后会自动继续这次导出。",
                                elapsedText()
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
                            `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`,
                            elapsedText()
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
                        `但扣费/扣次数记录失败：${escapeHtml(err.settlementMessage || err.message || String(err))}`,
                        elapsedText()
                    ].join("\n")
                ).catch(() => {});
                err.userNotified = true;
                throw err;
            }
            await editMessage(chatId, progress.message_id, `${format.toUpperCase()} 导出完成：${exportSummary}\n${elapsedText()}`).catch(
                () => {}
            );
        } catch (err) {
            const exportDurationMs = Math.max(0, now() - exportStartedAt);
            if (!Number.isFinite(Number(err.exportDurationMs))) err.exportDurationMs = exportDurationMs;
            if (!err.exportDurationText) err.exportDurationText = formatExportDuration(exportDurationMs);
            throw err;
        } finally {
            if (result?.filePath) await removeDirectory(path.dirname(result.filePath)).catch(() => {});
        }
    }

    return {
        botPrivateUrl,
        canSendPrivateMessage,
        privateExportStartMarkup,
        rememberPrivateExportStart,
        requestEpubCustomization,
        requestEpubStudio,
        requestEpubStyle,
        sendExport,
        takePrivateExportStart
    };
}

module.exports = {
    createExportDelivery
};
