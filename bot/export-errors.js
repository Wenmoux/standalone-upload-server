/**
 * [INPUT]: 依赖 server API、Telegram 发送和网络异常暴露的状态码、错误码与消息特征
 * [OUTPUT]: 对外提供稳定导出错误码、错误构造、私聊不可达识别、分类、用户提示和失败摘要格式化能力
 * [POS]: bot 导出域的错误语义防腐层，使任务运行时不依赖底层异常文案的偶然形态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const EXPORT_ERROR_CODES = {
    MISSING_BOOK_ID: "EXPORT_MISSING_BOOK_ID",
    NO_CONTENT: "EXPORT_NO_CONTENT",
    FREE_QUOTA_USED: "EXPORT_FREE_QUOTA_USED",
    INSUFFICIENT_BALANCE: "EXPORT_INSUFFICIENT_BALANCE",
    PRIVATE_CHAT_REQUIRED: "EXPORT_PRIVATE_CHAT_REQUIRED",
    TELEGRAM_SEND_FAILED: "EXPORT_TELEGRAM_SEND_FAILED",
    BOT_API_TIMEOUT: "EXPORT_BOT_API_TIMEOUT",
    NETWORK: "EXPORT_NETWORK",
    UNKNOWN: "EXPORT_UNKNOWN"
};

const NON_RETRYABLE_EXPORT_CODES = new Set([
    EXPORT_ERROR_CODES.MISSING_BOOK_ID,
    EXPORT_ERROR_CODES.NO_CONTENT,
    EXPORT_ERROR_CODES.FREE_QUOTA_USED,
    EXPORT_ERROR_CODES.INSUFFICIENT_BALANCE,
    EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED
]);

function isPrivateChatUnavailableError(err) {
    return /bot.*blocked|bot can't initiate conversation|chat not found|forbidden|peer[_ ]id[_ ]invalid|user is deactivated/i.test(
        `${String(err?.code || "")} ${String(err?.message || err || "")}`
    );
}

function asExportError(code, message, cause = null) {
    const err = new Error(message);
    err.code = code;
    if (NON_RETRYABLE_EXPORT_CODES.has(code)) err.retryable = false;
    if (cause) err.cause = cause;
    return err;
}

function classifyExportError(err) {
    const message = String(err?.message || err || "");
    const status = Number(err?.status || 0);
    const code = String(err?.code || "");

    if (code && Object.values(EXPORT_ERROR_CODES).includes(code)) {
        return { code, message: exportErrorText(code, message), raw: message };
    }
    if (/用法|missing book|book id/i.test(message))
        return { code: EXPORT_ERROR_CODES.MISSING_BOOK_ID, message: exportErrorText(EXPORT_ERROR_CODES.MISSING_BOOK_ID), raw: message };
    if (/没有正文缓存|no content|no chapters|empty/i.test(message))
        return { code: EXPORT_ERROR_CODES.NO_CONTENT, message: exportErrorText(EXPORT_ERROR_CODES.NO_CONTENT), raw: message };
    if (status === 409 && /free|quota|额度|免费/i.test(message))
        return { code: EXPORT_ERROR_CODES.FREE_QUOTA_USED, message: exportErrorText(EXPORT_ERROR_CODES.FREE_QUOTA_USED), raw: message };
    if (status === 409 || /余额不足|insufficient|not enough/i.test(message))
        return {
            code: EXPORT_ERROR_CODES.INSUFFICIENT_BALANCE,
            message: exportErrorText(EXPORT_ERROR_CODES.INSUFFICIENT_BALANCE),
            raw: message
        };
    if (isPrivateChatUnavailableError(err))
        return {
            code: EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED,
            message: exportErrorText(EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED),
            raw: message
        };
    if (/sendDocument|Telegram/i.test(message))
        return {
            code: EXPORT_ERROR_CODES.TELEGRAM_SEND_FAILED,
            message: exportErrorText(EXPORT_ERROR_CODES.TELEGRAM_SEND_FAILED),
            raw: message
        };
    if (/timeout|abort/i.test(message))
        return { code: EXPORT_ERROR_CODES.BOT_API_TIMEOUT, message: exportErrorText(EXPORT_ERROR_CODES.BOT_API_TIMEOUT), raw: message };
    if (/ECONN|ENOTFOUND|network|fetch failed/i.test(message))
        return { code: EXPORT_ERROR_CODES.NETWORK, message: exportErrorText(EXPORT_ERROR_CODES.NETWORK), raw: message };
    return { code: EXPORT_ERROR_CODES.UNKNOWN, message: exportErrorText(EXPORT_ERROR_CODES.UNKNOWN), raw: message };
}

function exportErrorText(code, fallback = "") {
    switch (code) {
        case EXPORT_ERROR_CODES.MISSING_BOOK_ID:
            return "缺少书号，请使用 /exporttxt 书号 或 /exportepub 书号。";
        case EXPORT_ERROR_CODES.NO_CONTENT:
            return "本地没有可导出的正文缓存。请先在阅读器缓存正文，或绑定 PO18 后再导出。";
        case EXPORT_ERROR_CODES.FREE_QUOTA_USED:
            return "今日免费导出额度已用完。可以开通导出授权后重试。";
        case EXPORT_ERROR_CODES.INSUFFICIENT_BALANCE:
            return "余额不足，导出已取消。请充值或调整导出范围后重试。";
        case EXPORT_ERROR_CODES.PRIVATE_CHAT_REQUIRED:
            return "私聊发送失败。请先私聊 Bot 发送 /start，再回到群里重试。";
        case EXPORT_ERROR_CODES.TELEGRAM_SEND_FAILED:
            return "Telegram 文件发送失败，请稍后重试。";
        case EXPORT_ERROR_CODES.BOT_API_TIMEOUT:
            return "后端响应超时，导出已取消。请稍后重试。";
        case EXPORT_ERROR_CODES.NETWORK:
            return "网络连接失败，导出已取消。请检查后端和 Telegram 网络。";
        default:
            return fallback || "导出失败，请稍后重试。";
    }
}

function formatExportFailure(err) {
    const classified = classifyExportError(err);
    return {
        ...classified,
        text: `${classified.message}\n错误码：${classified.code}`
    };
}

module.exports = {
    EXPORT_ERROR_CODES,
    asExportError,
    classifyExportError,
    exportErrorText,
    formatExportFailure,
    isPrivateChatUnavailableError
};
