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

async function fileBlob(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.size) throw new Error(`Telegram file is empty: ${path.basename(filePath)}`);
    if (typeof openAsBlob === "function") return openAsBlob(filePath);
    return new Blob([await fs.readFile(filePath)]);
}

function createTelegramClient({ token, apiBase, requestTimeoutMs }) {
    const base = String(apiBase || "https://api.telegram.org").replace(/\/+$/, "");
    const timeoutMs = Number.isFinite(Number(requestTimeoutMs)) ? Number(requestTimeoutMs) : 60000;

    function tgUrl(method) {
        return `${base}/bot${token}/${method}`;
    }

    async function telegramFetch(method, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(tgUrl(method), { ...options, signal: controller.signal });
        } catch (err) {
            throw new Error(telegramNetworkMessage(method, err), { cause: err });
        } finally {
            clearTimeout(timer);
        }
    }

    async function telegram(method, body = {}) {
        const response = await telegramFetch(method, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
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
        answerCallback
    };
}

module.exports = { createTelegramClient, truncate };
