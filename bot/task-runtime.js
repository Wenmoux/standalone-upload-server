const { createJobQueue } = require("./job-queue");

function createBotTaskRuntime(deps = {}) {
    const {
        client,
        sendMessage,
        escapeHtml,
        formatExportFailure,
        recordBotAudit,
        concurrency = 2
    } = deps;

function compactBotJobResult(job, ms, result = {}) {
    const payload = result && typeof result === "object" ? result : {};
    return {
        name: job.name || "",
        label: job.label || "",
        duration_ms: Math.max(0, Number(ms || 0)),
        chat_id: String(job.chatId || ""),
        book_id: job.bookId || "",
        format: job.format || "",
        ...payload
    };
}

async function ensureSystemJob(job) {
    if (!job?.systemJobType) return null;
    if (job.systemJobId) return { id: job.systemJobId };
    if (job.systemJobPromise) return job.systemJobPromise;
    job.systemJobPromise = client.createSystemJob({
        type: job.systemJobType,
        input: job.systemJobInput || {},
        created_by: job.systemJobCreatedBy || "telegram_bot"
    }).then((created) => {
        job.systemJobId = created?.id || null;
        return created || null;
    }).catch((err) => {
        console.warn(`[bot-task] system job create failed for ${job.name}: ${err.message || String(err)}`);
        return null;
    }).finally(() => {
        job.systemJobPromise = null;
    });
    return job.systemJobPromise;
}

function updateTrackedSystemJob(job, fields = {}) {
    if (!job?.systemJobType) return;
    ensureSystemJob(job).then((created) => {
        const id = job.systemJobId || created?.id;
        if (!id) return null;
        return client.updateSystemJob(id, fields);
    }).catch((err) => {
        console.warn(`[bot-task] system job update failed for ${job.name}: ${err.message || String(err)}`);
    });
}

async function isSystemJobCanceled(job) {
    const created = await ensureSystemJob(job);
    const id = job.systemJobId || created?.id;
    if (!id || typeof client.getSystemJob !== "function") return false;
    const current = await client.getSystemJob(id).catch(() => null);
    return String(current?.status || "") === "canceled";
}

const botTaskQueue = createJobQueue({
    concurrency,
    onDuplicate(job) {
        sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已在后台执行中，请等当前任务完成。`).catch(() => {});
    },
    onQueued(job, queuedAhead) {
        updateTrackedSystemJob(job, { status: "queued", progress: 0 });
        ensureSystemJob(job).then((created) => {
            const idLine = created?.id ? `\n任务 #${created.id}` : "";
            return sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已加入后台队列，前面还有 ${queuedAhead} 个任务。${idLine}`);
        }).catch(() => {});
    },
    async beforeStart(job) {
        if (!(await isSystemJobCanceled(job))) return true;
        sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已取消，未开始执行。`).catch(() => {});
        return false;
    },
    onStart(job) {
        console.log(`[bot-task] start ${job.name}`);
        ensureSystemJob(job).then((created) => {
            updateTrackedSystemJob(job, { status: "running", progress: 10, started: true });
            if (created?.id) {
                return sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 开始执行。\n任务 #${created.id}`).catch(() => {});
            }
            return null;
        }).catch(() => {});
    },
    onSuccess(job, ms, result) {
        updateTrackedSystemJob(job, {
            status: "succeeded",
            progress: 100,
            result: compactBotJobResult(job, ms, result),
            finished: true
        });
        if (String(job.name || "").startsWith("export:")) {
            recordBotAudit({
                telegram_id: String(job.systemJobInput?.telegram_id || ""),
                chat_id: String(job.systemJobInput?.chat_id || job.chatId || ""),
                chat_type: job.systemJobInput?.group_chat ? "group" : "",
                command: `/export${job.format || ""}`,
                action: `export_${job.format || ""}`,
                status: "succeeded",
                duration_ms: Math.max(0, Number(ms || 0)),
                details: compactBotJobResult(job, ms, result)
            }).catch(() => {});
        }
    },
    onError(job, err) {
        const exportFailure = String(job.name || "").startsWith("export:") ? formatExportFailure(err) : null;
        const message = exportFailure ? `${exportFailure.code}: ${exportFailure.raw || exportFailure.message}` : (err?.message || String(err || "unknown error"));
        console.error(`[bot-task] ${job.name} failed: ${message}`);
        updateTrackedSystemJob(job, {
            status: "failed",
            progress: 100,
            error: message,
            finished: true
        });
        if (job.chatId && !err?.userNotified) {
            const text = exportFailure
                ? exportFailure.text
                : `${escapeHtml(job.label || "后台任务")}失败：${escapeHtml(message)}`;
            sendMessage(job.chatId, text).catch(() => {});
        }
        if (exportFailure) {
            recordBotAudit({
                telegram_id: String(job.systemJobInput?.telegram_id || ""),
                chat_id: String(job.systemJobInput?.chat_id || job.chatId || ""),
                chat_type: job.systemJobInput?.group_chat ? "group" : "",
                command: `/export${job.format || ""}`,
                action: `export_${job.format || ""}`,
                status: "failed",
                error_code: exportFailure.code,
                error: exportFailure.raw || exportFailure.message,
                details: { book_id: job.bookId || "", format: job.format || "" }
            }).catch(() => {});
        }
    },
    onDone(job, ms) {
        console.log(`[bot-task] done ${job.name} ${ms}ms`);
    }
});

    return { botTaskQueue };
}

module.exports = { createBotTaskRuntime };
