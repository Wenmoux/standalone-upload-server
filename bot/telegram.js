/**
 * [INPUT]: 依赖 Node 文件/Blob 能力、Fetch 和 Telegram Bot HTTP API 的请求与错误语义
 * [OUTPUT]: 对外提供统一 Telegram 请求、幂等消息编辑、文档/图片发送、回调应答和传输统计客户端
 * [POS]: bot 的 Telegram 网络适配层，集中处理超时、429 退避、编辑无变化、文件上传、文本截断与可观测性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const { openAsBlob } = require("fs");
const path = require("path");

function truncate(value, max = 600) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function telegramNetworkMessage(method, err) {
    const code = err?.cause?.code || err?.code || "";
    const detail = err?.cause?.message || err?.message || String(err || "unknown error");
    return `Telegram ${method} network failed${code ? ` (${code})` : ""}: ${detail}`;
}

function isMessageNotModified(method, data = {}) {
    return (
        String(method || "") === "editMessageText" &&
        Number(data.error_code || 0) === 400 &&
        /message is not modified/i.test(String(data.description || ""))
    );
}

async function fileBlob(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error(`Telegram file is empty: ${path.basename(filePath)}`);
    if (typeof openAsBlob === "function") return openAsBlob(filePath);
    return new Blob([await fs.readFile(filePath)]);
}

function createTelegramClient({ token, apiBase, requestTimeoutMs }) {
    const base = String(apiBase || "https://api.telegram.org").replace(/\/+$/, "");
    const timeoutMs = Number.isFinite(Number(requestTimeoutMs)) ? Number(requestTimeoutMs) : 60000;
    const metrics = {
        requests: 0,
        failures: 0,
        sendFailures: 0,
        rateLimited: 0,
        unreachable: 0,
        lastError: "",
        lastErrorAt: null,
        durations: []
    };

    function isSendMethod(method) {
        return /^(send|editMessage)/.test(String(method || ""));
    }

    function recordFailure(method, status = 0, description = "") {
        metrics.failures += 1;
        if (isSendMethod(method)) metrics.sendFailures += 1;
        if (Number(status) === 429) metrics.rateLimited += 1;
        if (Number(status) === 403 || /bot was blocked|chat not found|user is deactivated|forbidden/i.test(String(description || ""))) {
            metrics.unreachable += 1;
        }
        metrics.lastError = truncate(description || `HTTP ${status || 0}`, 500);
        metrics.lastErrorAt = new Date().toISOString();
    }

    function percentile(values, ratio) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    }

    function stats() {
        return {
            requests_total: metrics.requests,
            failures_total: metrics.failures,
            send_failures_total: metrics.sendFailures,
            rate_limited_total: metrics.rateLimited,
            unreachable_total: metrics.unreachable,
            latency_p50_ms: percentile(metrics.durations, 0.5),
            latency_p95_ms: percentile(metrics.durations, 0.95),
            last_error: metrics.lastError,
            last_error_at: metrics.lastErrorAt
        };
    }

    function tgUrl(method) {
        return `${base}/bot${token}/${method}`;
    }

    async function telegramFetch(method, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();
        metrics.requests += 1;
        try {
            const response = await fetch(tgUrl(method), { ...options, signal: controller.signal });
            return response;
        } catch (err) {
            recordFailure(method, 0, telegramNetworkMessage(method, err));
            throw new Error(telegramNetworkMessage(method, err), { cause: err });
        } finally {
            clearTimeout(timer);
            metrics.durations.push(Math.max(0, Date.now() - startedAt));
            if (metrics.durations.length > 500) metrics.durations.splice(0, metrics.durations.length - 500);
        }
    }

    async function telegram(method, body = {}) {
        const response = await telegramFetch(method, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (isMessageNotModified(method, data)) return { message_not_modified: true };
        if (!response.ok || data.ok === false) recordFailure(method, data.error_code || response.status, data.description);
        if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
        return data.result;
    }

    function sendMessage(chatId, text, extra = {}) {
        return telegram("sendMessage", {
            chat_id: chatId,
            text: truncate(text, 3900),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...extra
        });
    }

    function editMessage(chatId, messageId, text, extra = {}) {
        return telegram("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text: truncate(text, 3900),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...extra
        });
    }

    async function sendDocument(chatId, filePath, caption = "") {
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("caption", truncate(caption, 900));
        form.append("parse_mode", "HTML");
        form.append("document", await fileBlob(filePath), path.basename(filePath));
        const response = await telegramFetch("sendDocument", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) recordFailure("sendDocument", data.error_code || response.status, data.description);
        if (!response.ok || data.ok === false) throw new Error(data.description || "sendDocument failed");
        return data.result;
    }

    async function sendPhoto(chatId, bytes, fileName = "captcha.jpg", caption = "") {
        if (!bytes || !Number(bytes.length)) throw new Error(`Telegram photo is empty: ${fileName}`);
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("caption", truncate(caption, 900));
        form.append("photo", new Blob([bytes]), fileName);
        const response = await telegramFetch("sendPhoto", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) recordFailure("sendPhoto", data.error_code || response.status, data.description);
        if (!response.ok || data.ok === false) throw new Error(data.description || "sendPhoto failed");
        return data.result;
    }

    function answerCallback(id, text = "") {
        return telegram("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});
    }

    return {
        apiBase: base,
        telegram,
        telegramFetch,
        sendMessage,
        editMessage,
        sendDocument,
        sendPhoto,
        answerCallback,
        stats
    };
}

module.exports = { createTelegramClient, isMessageNotModified, truncate };
