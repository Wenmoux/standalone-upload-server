/**
 * [INPUT]: 依赖共享 Bot API 客户端、TXT/EPUB 生成器、计价格式化器、PO18 补章客户端及 QQ 消息/文件适配器
 * [OUTPUT]: 对外提供 QQ 用户自动注册和复用 Telegram 同款 EPUB 模板库、自定义配置及计费规则的导出函数
 * [POS]: qq-bot 的导出组合边界，把平台无关生成与结算能力接到 QQ 富媒体文件投递而不复制业务规则
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { createEpubBuilder } = require("../bot/epub-builder");
const { createExportBuilder } = require("../bot/export-builder");
const { createExportDelivery } = require("../bot/export-delivery");
const { asExportError, formatExportFailure } = require("../bot/export-errors");
const { EPUB_EXPORT_STYLE_CHOICES, normalizeEpubCustomConfig, normalizeEpubStyleChoice } = require("../bot/epub-style-picker");
const { createPo18Client } = require("../bot/po18-client");
const { createBotUi } = require("../bot/ui-formatters");
const {
    chapterPlainText,
    cleanText,
    finishWriteStream,
    isVolumeChapter,
    safeFileName,
    writeStreamChunk,
    yieldToEventLoop
} = require("../bot/text-share-utils");

function createQqExportRuntime(options = {}) {
    const client = options.client;
    const sendMessage = options.sendMessage;
    const sendFile = options.sendFile;
    const exportMaxChapters = Number(options.exportMaxChapters || process.env.QQ_BOT_EXPORT_MAX_CHAPTERS || 5000);
    const { makeEpubFiles, buildZip } = createEpubBuilder({ cleanText, chapterPlainText, isVolumeChapter, yieldToEventLoop });
    const { hasPo18Auth, fetchPo18PurchasedChapters } = createPo18Client({ cleanText });
    const ui = createBotUi({ cleanText, isVolumeChapter });
    const { buildExport } = createExportBuilder({
        client,
        exportMaxChapters,
        isVolumeChapter,
        hasPo18Auth,
        fetchPo18PurchasedChapters,
        asExportError,
        safeFileName,
        writeStreamChunk,
        finishWriteStream,
        yieldToEventLoop,
        chapterPlainText,
        paidExportChapterCount: ui.paidExportChapterCount,
        makeEpubFiles,
        buildZip
    });

    async function ensureRegistered(profile = {}) {
        const current = await client.getUser(profile.id).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
        if (current) return current;
        const result = await client.registerUser(profile);
        return result.user || result;
    }

    const delivery = createExportDelivery({
        client,
        telegram: async () => ({}),
        sendMessage,
        editMessage: (target, _messageId, text) => sendMessage(target, text),
        sendDocument: (target, filePath) => sendFile(target, filePath),
        isGroup: () => false,
        escapeHtml: (value) => String(value ?? ""),
        asExportError,
        formatExportFailure,
        isPrivateChatUnavailableError: () => false,
        normalizeEpubCustomConfig,
        normalizeEpubStyleChoice,
        epubStyleChoices: EPUB_EXPORT_STYLE_CHOICES,
        epubStyleSelectionMarkup: () => undefined,
        callback: (parts) => parts.join("|"),
        ensureRegistered,
        buildExport,
        normalizeExportPricing: ui.normalizeExportPricing,
        exportQuote: ui.exportQuote,
        exportQuoteText: ui.exportQuoteText,
        freeExportText: ui.freeExportText,
        source: "qq_bot"
    });

    async function exportBook(event, bookId, format, epubStyleId = "", epubConfig = null) {
        const profile = {
            id: event.identity,
            username: `qq_${event.userOpenId.slice(-12)}`,
            first_name: cleanText(event.raw?.author?.username || event.raw?.author?.nickname || "QQ 用户")
        };
        return delivery.sendExport(
            { id: event.targetKey, type: event.kind },
            profile,
            String(bookId || ""),
            format,
            null,
            {
                epubStyleId: normalizeEpubStyleChoice(epubStyleId),
                ...(epubConfig ? { epubConfig: normalizeEpubCustomConfig(epubConfig) } : {}),
                settlementKey: `qq:${event.messageId}:${format}:${bookId}:${epubStyleId || "default"}`
            }
        );
    }

    return { ensureRegistered, epubStyles: EPUB_EXPORT_STYLE_CHOICES.map((item) => ({ ...item })), exportBook };
}

module.exports = { createQqExportRuntime };
