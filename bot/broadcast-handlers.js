/**
 * [INPUT]: 依赖 PgBotClient、Telegram 消息/编辑接口、管理员身份查询、短期广播草稿与 HTML 转义能力
 * [OUTPUT]: 对外提供管理员广播的输入、预览确认、取消、持久任务发布与注册用户批量发送处理器
 * [POS]: bot 的全员通知交互与执行层，把危险发布动作留在二次确认之后，并把收件人读取委托给 server API
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createBroadcastHandlers(options = {}) {
    const {
        client,
        ensureRegistered,
        sendMessage,
        editMessage,
        escapeHtml,
        drafts,
        delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    } = options;
    const configuredDelay = Number(process.env.TELEGRAM_BROADCAST_SEND_DELAY_MS || 60);
    const sendDelayMs = options.sendDelayMs !== undefined
        ? Math.max(0, Number(options.sendDelayMs || 0))
        : Number.isFinite(configuredDelay) ? Math.max(35, configuredDelay) : 60;

    async function requireBotAdmin(from) {
        const user = await ensureRegistered(from);
        if (!user?.is_admin) {
            const err = new Error("只有管理员可以发布全员通知。");
            err.status = 403;
            throw err;
        }
        return user;
    }

    function confirmationMarkup(token) {
        return {
            inline_keyboard: [[
                { text: "确认推送", callback_data: `broadcastsend|${token}`.slice(0, 64) },
                { text: "取消", callback_data: `broadcastcancel|${token}`.slice(0, 64) }
            ]]
        };
    }

    async function showPreview(message, content) {
        const checked = drafts.capture({ chatId: message.chat.id, userId: message.from.id, content });
        if (checked.status === "too_long") {
            return sendMessage(message.chat.id, `通知过长，最多 ${checked.maxLength} 字（当前 ${checked.length} 字）。`);
        }
        if (checked.status !== "ready") return sendMessage(message.chat.id, "通知内容不能为空。");
        return sendMessage(
            message.chat.id,
            [
                "<b>全员通知预览</b>",
                `将私聊推送给所有已注册、未封禁且绑定 Telegram 的用户。`,
                "",
                escapeHtml(checked.draft.content),
                "",
                "确认后进入后台任务，无法撤回已经送达的消息。"
            ].join("\n"),
            { reply_markup: confirmationMarkup(checked.draft.token) }
        );
    }

    async function handleBroadcast(message, args = "") {
        await requireBotAdmin(message.from);
        const content = String(args || "").trim();
        if (content) return showPreview(message, content);
        const prompt = await sendMessage(message.chat.id, [
            "<b>发布全员通知</b>",
            "请回复这条消息输入通知内容。",
            "消息只会私聊发送给已注册且绑定 Telegram 的用户；回复“取消”退出。"
        ].join("\n"), {
            reply_markup: {
                force_reply: true,
                selective: true,
                input_field_placeholder: "输入全员通知"
            }
        });
        drafts.begin({ chatId: message.chat.id, userId: message.from.id, promptMessageId: prompt?.message_id });
        return prompt;
    }

    function broadcastDraftContext(message, content = "") {
        const draft = drafts.get({ chatId: message.chat.id, userId: message.from.id });
        if (!draft || draft.content) return null;
        const text = String(content || "").trim();
        if (text.startsWith("/") && !/^\/cancel(?:@\w+)?$/i.test(text)) return null;
        const grouped = message.chat.type === "group" || message.chat.type === "supergroup";
        if (grouped && String(message.reply_to_message?.message_id || "") !== draft.promptMessageId) return null;
        return draft;
    }

    async function handleBroadcastDraft(message, content = "") {
        await requireBotAdmin(message.from);
        const text = String(content || "").trim();
        if (/^(?:取消|\/cancel(?:@\w+)?)$/i.test(text)) {
            drafts.cancel({ chatId: message.chat.id, userId: message.from.id });
            await sendMessage(message.chat.id, "已取消全员通知。");
            return true;
        }
        await showPreview(message, text);
        return true;
    }

    async function handleBroadcastConfirm(message, token, editTarget) {
        await requireBotAdmin(message.from);
        const draft = drafts.consume({ chatId: message.chat.id, userId: message.from.id, token });
        if (!draft?.content) return "通知草稿已过期或已处理";
        const result = await client.createBroadcast(message.from.id, draft.content, message.chat.id);
        const jobId = result.job?.id || "-";
        if (editTarget) {
            await editMessage(editTarget.chatId, editTarget.messageId, `全员通知已进入后台队列。\n任务 #${jobId}`).catch(() => {});
        }
        return `已入队，任务 #${jobId}`;
    }

    async function handleBroadcastCancel(message, token, editTarget) {
        const canceled = drafts.consume({ chatId: message.chat.id, userId: message.from.id, token });
        if (editTarget) {
            await editMessage(editTarget.chatId, editTarget.messageId, canceled ? "已取消全员通知。" : "通知草稿已过期或已处理。").catch(() => {});
        }
        return canceled ? "已取消" : "草稿已过期";
    }

    async function sendRegisteredUserBroadcast(content, signal) {
        let afterId = 0;
        let targeted = 0;
        let sent = 0;
        let failed = 0;
        const failures = [];
        let deliveryStarted = false;
        while (true) {
            let page;
            try {
                page = await client.broadcastRecipients(afterId, 100);
            } catch (err) {
                if (deliveryStarted) err.retryable = false;
                throw err;
            }
            const rows = page.rows || [];
            if (!rows.length) break;
            for (const row of rows) {
                if (signal?.aborted) throw signal.reason || new Error("broadcast canceled");
                targeted += 1;
                deliveryStarted = true;
                try {
                    await sendMessage(row.telegram_id, `<b>站内通知</b>\n\n${escapeHtml(content)}`);
                    sent += 1;
                } catch (err) {
                    failed += 1;
                    if (failures.length < 20) failures.push({ user_id: row.id, error: String(err.message || err).slice(0, 300) });
                }
                if (sendDelayMs > 0) await delay(sendDelayMs);
            }
            afterId = Number(rows[rows.length - 1]?.id || afterId);
            if (!page.has_more) break;
        }
        return { targeted, sent, failed, failures };
    }

    return {
        broadcastDraftContext,
        handleBroadcast,
        handleBroadcastCancel,
        handleBroadcastConfirm,
        handleBroadcastDraft,
        sendRegisteredUserBroadcast
    };
}

module.exports = { createBroadcastHandlers };
