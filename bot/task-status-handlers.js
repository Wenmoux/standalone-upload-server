/**
 * [INPUT]: 依赖 PgBotClient 的 system_jobs 查询/取消接口、用户注册守卫和 Telegram 文本发送能力
 * [OUTPUT]: 对外提供任务列表、任务详情和所有权受控的取消命令处理器
 * [POS]: bot 任务域的用户查询边界，将持久任务状态转换为可读 Telegram 视图并执行所有权校验
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function createTaskStatusHandlers(options = {}) {
    const { client, ensureRegistered, sendMessage, escapeHtml } = options;

    const statusLabels = {
        queued: "排队中",
        running: "运行中",
        succeeded: "已完成",
        failed: "失败",
        canceled: "已取消"
    };
    const typeLabels = {
        bot_export_txt: "TXT 导出",
        bot_export_epub: "EPUB 导出",
        bot_po18_bookshelf_sync: "PO18 书架同步",
        bot_share_upload: "单书共享",
        bot_po18_bookshelf_share: "PO18 书架共享"
    };

    function isOwner(job, telegramId) {
        const id = String(telegramId || "");
        return String(job?.created_by || "") === `telegram:${id}` || String(job?.input_json?.telegram_id || "") === id;
    }

    function taskTitle(job = {}) {
        return typeLabels[job.type] || job.type || "后台任务";
    }

    function taskStatus(job = {}) {
        return statusLabels[job.status] || job.status || "未知";
    }

    function taskLine(job = {}) {
        const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
        return `#${job.id} · ${escapeHtml(taskTitle(job))} · ${escapeHtml(taskStatus(job))} · ${progress}%`;
    }

    function taskCard(job = {}) {
        const input = job.input_json || {};
        const lines = [
            `<b>任务 #${job.id}</b>`,
            `类型：${escapeHtml(taskTitle(job))}`,
            `状态：${escapeHtml(taskStatus(job))}`,
            `进度：${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`,
            `尝试：${Number(job.attempt || 0)}/${Number(job.max_attempts || 0)}`,
            input.book_id ? `书号：<code>${escapeHtml(input.book_id)}</code>` : "",
            input.format ? `格式：${escapeHtml(String(input.format).toUpperCase())}` : "",
            job.error ? `原因：${escapeHtml(String(job.error).slice(0, 500))}` : "",
            job.next_run_at ? `下次重试：${escapeHtml(String(job.next_run_at).slice(0, 19).replace("T", " "))}` : "",
            ["queued", "running"].includes(String(job.status || "")) ? `取消：<code>/canceljob ${job.id}</code>` : ""
        ];
        return lines.filter(Boolean).join("\n");
    }

    async function handleTasks(message) {
        await ensureRegistered(message.from);
        const payload = await client.listSystemJobs(message.from.id, { limit: 8 });
        const rows = payload.rows || [];
        if (!rows.length) return sendMessage(message.chat.id, "你还没有后台任务。");
        return sendMessage(message.chat.id, [
            "<b>我的后台任务</b>",
            ...rows.map(taskLine),
            "",
            "详情：<code>/task 任务号</code>"
        ].join("\n"));
    }

    async function handleTask(message, args) {
        await ensureRegistered(message.from);
        const id = String(args || "").trim().split(/\s+/)[0];
        if (!/^\d+$/.test(id)) return sendMessage(message.chat.id, "用法：/task 任务号");
        const job = await client.getSystemJob(id);
        if (!job || !isOwner(job, message.from.id)) return sendMessage(message.chat.id, "任务不存在，或不属于当前账号。");
        return sendMessage(message.chat.id, taskCard(job));
    }

    async function handleCancelJob(message, args) {
        await ensureRegistered(message.from);
        const id = String(args || "").trim().split(/\s+/)[0];
        if (!/^\d+$/.test(id)) return sendMessage(message.chat.id, "用法：/canceljob 任务号");
        try {
            const job = await client.cancelSystemJob(id, message.from.id);
            return sendMessage(message.chat.id, `任务 #${id} 已提交取消。\n当前状态：${escapeHtml(taskStatus(job))}`);
        } catch (err) {
            return sendMessage(message.chat.id, `取消失败：${escapeHtml(err.message || String(err))}`);
        }
    }

    return { handleTasks, handleTask, handleCancelJob, _internals: { isOwner, taskCard, taskLine } };
}

module.exports = { createTaskStatusHandlers };
