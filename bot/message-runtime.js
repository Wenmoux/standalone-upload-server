function createMessageRuntime(deps = {}) {
    const {
        client,
        rateLimiter,
        formatWait,
        sendMessage,
        editMessage,
        escapeHtml,
        classifyExportError,
        botUserProvider = () => null,
        longTextThreshold = 1600
    } = deps;

function commandOf(text = "") {
    const first = text.trim().split(/\s+/)[0] || "";
    return first.replace(/@\w+$/, "").toLowerCase();
}

function argsOf(text = "") {
    return text.trim().split(/\s+/).slice(1).join(" ").trim();
}

function isGroup(chat = {}) {
    return chat.type === "group" || chat.type === "supergroup";
}

async function withCooldown(message, action, cooldownMs, label, handler) {
    const userId = String(message.from?.id || "anonymous");
    const key = `${action}:${userId}`;
    const result = rateLimiter.check(key, cooldownMs);
    if (!result.allowed) {
        return sendMessage(message.chat.id, `${escapeHtml(label)} 操作太频繁，请 ${formatWait(result.retryAfterMs)} 后再试。`);
    }
    return handler();
}

function mentionsMe(text = "") {
    const botUser = botUserProvider() || {};
    if (!botUser?.username) return false;
    return new RegExp(`@${botUser.username}\\b`, "i").test(text);
}

function auditUser(message = {}) {
    const from = message.from || {};
    return {
        telegram_id: String(from.id || ""),
        telegram_username: String(from.username || "").replace(/^@+/, ""),
        chat_id: String(message.chat?.id || ""),
        chat_type: String(message.chat?.type || "")
    };
}

async function recordBotAudit(payload = {}) {
    try {
        await client.recordAudit(payload);
    } catch (err) {
        console.warn(`[bot-audit] ${err.message || String(err)}`);
    }
}

async function withBotAudit(message, command, action, details, handler) {
    const started = Date.now();
    try {
        const result = await handler();
        await recordBotAudit({
            ...auditUser(message),
            command,
            action,
            status: "succeeded",
            duration_ms: Date.now() - started,
            details
        });
        return result;
    } catch (err) {
        const classified = /^export/i.test(String(action || "")) || /^\/export/i.test(String(command || ""))
            ? classifyExportError(err)
            : { code: String(err?.code || "BOT_COMMAND_FAILED"), raw: err?.message || String(err || "") };
        await recordBotAudit({
            ...auditUser(message),
            command,
            action,
            status: "failed",
            error_code: classified.code,
            error: classified.raw || err?.message || String(err || ""),
            duration_ms: Date.now() - started,
            details
        });
        throw err;
    }
}

function longResultSummary(title = "结果") {
    return `${escapeHtml(title)} 内容较长，完整内容已私聊发送。`;
}

async function deliverLongGroupResult(message, text, extra = {}, options = {}) {
    const value = String(text || "");
    const editTarget = options.editTarget || null;
    const title = options.title || "结果";
    if (!isGroup(message.chat) || !message.from?.id || !longTextThreshold || value.length <= longTextThreshold) {
        if (editTarget) return editMessage(editTarget.chatId, editTarget.messageId, value, extra);
        return sendMessage(message.chat.id, value, extra);
    }

    try {
        await sendMessage(message.from.id, value, extra);
        const summary = options.summary || longResultSummary(title);
        if (editTarget) return editMessage(editTarget.chatId, editTarget.messageId, summary);
        return sendMessage(message.chat.id, summary);
    } catch (err) {
        const fallback = [
            `${escapeHtml(title)} 内容较长，私聊发送失败。`,
            "请先私聊 Bot 发送 /start，再回到群里重试。",
            `原因：${escapeHtml(err.message || String(err))}`
        ].join("\n");
        if (editTarget) return editMessage(editTarget.chatId, editTarget.messageId, fallback).catch(() => {});
        return sendMessage(message.chat.id, fallback).catch(() => {});
    }
}

    return {
        commandOf,
        argsOf,
        isGroup,
        withCooldown,
        mentionsMe,
        auditUser,
        recordBotAudit,
        withBotAudit,
        longResultSummary,
        deliverLongGroupResult
    };
}

module.exports = { createMessageRuntime };
