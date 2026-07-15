/**
 * [INPUT]: 依赖 Node 主机身份、job-queue、PgBotClient 的 system_jobs 契约、导出错误格式化及任务生命周期消息/审计适配器
 * [OUTPUT]: 对外提供携带 worker/attempt fencing token 的租约、心跳、带原因反馈的重试、取消和重启恢复运行时
 * [POS]: bot 后台任务域的可靠性核心，把进程内执行与 server-pg 持久状态连接起来并拒绝旧租约迟到回写
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const os = require("os");
const { createJobQueue } = require("./job-queue");

function createBotTaskRuntime(deps = {}) {
    const {
        client,
        sendMessage,
        escapeHtml,
        formatExportFailure,
        recordBotAudit,
        concurrency = 2,
        leaseSeconds = Number(process.env.PO18_BOT_JOB_LEASE_SECONDS || 120),
        heartbeatMs = Number(process.env.PO18_BOT_JOB_HEARTBEAT_MS || 30000),
        workerId = `bot:${os.hostname()}:${process.pid}`
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
        job.systemJobPromise = client
            .createSystemJob({
                type: job.systemJobType,
                input: job.systemJobInput || {},
                created_by: job.systemJobCreatedBy || "telegram_bot",
                priority: job.priority || 0,
                max_attempts: job.maxAttempts || 3,
                idempotency_key: job.idempotencyKey || ""
            })
            .then((created) => {
                job.systemJobId = created?.id || null;
                return created || null;
            })
            .catch((err) => {
                console.warn(`[bot-task] system job create failed for ${job.name}: ${err.message || String(err)}`);
                return null;
            })
            .finally(() => {
                job.systemJobPromise = null;
            });
        return job.systemJobPromise;
    }

    function updateTrackedSystemJob(job, fields = {}) {
        if (!job?.systemJobType) return;
        ensureSystemJob(job)
            .then((created) => {
                const id = job.systemJobId || created?.id;
                if (!id) return null;
                const ownership = job.systemJobClaimed ? { worker_id: workerId, attempt: Number(job.systemJobRow?.attempt || 0) } : {};
                return client.updateSystemJob(id, { ...fields, ...ownership });
            })
            .catch((err) => {
                console.warn(`[bot-task] system job update failed for ${job.name}: ${err.message || String(err)}`);
            });
    }

    async function currentSystemJob(job) {
        const created = await ensureSystemJob(job);
        const id = job.systemJobId || created?.id;
        if (!id || typeof client.getSystemJob !== "function") return null;
        return client.getSystemJob(id).catch(() => null);
    }

    async function isSystemJobCanceled(job) {
        const current = await currentSystemJob(job);
        return String(current?.status || "") === "canceled" || !!current?.cancel_requested_at;
    }

    async function claimJob(job) {
        if (!job?.systemJobType || job.systemJobClaimed) return true;
        const created = await ensureSystemJob(job);
        const id = job.systemJobId || created?.id;
        if (!id || created?.duplicate) return false;
        if (typeof client.claimSystemJob !== "function") return true;
        const claimed = await client
            .claimSystemJob(id, {
                worker_id: workerId,
                lease_seconds: leaseSeconds
            })
            .catch(() => null);
        if (!claimed) return false;
        job.systemJobClaimed = true;
        job.systemJobRow = claimed;
        return true;
    }

    function isRetryableError(error) {
        if (error?.retryable === true) return true;
        if (error?.retryable === false) return false;
        return /timeout|timed out|fetch failed|ECONN|EAI_AGAIN|temporar|database unavailable|aborted/i.test(
            String(error?.message || error || "")
        );
    }

    async function scheduleRetry(job, current, error) {
        const attempt = Number(current?.attempt || 0);
        const maxAttempts = Number(current?.max_attempts || job.maxAttempts || 3);
        if (!job.systemJobId || attempt >= maxAttempts || !isRetryableError(error)) return false;
        const delayMs = Math.min(5 * 60 * 1000, 5000 * 2 ** Math.max(0, attempt - 1));
        const nextRunAt = new Date(Date.now() + delayMs).toISOString();
        await client.updateSystemJob(job.systemJobId, {
            status: "queued",
            progress: Math.max(0, Number(current?.progress || 0)),
            error: String(error?.message || error || "retryable error").slice(0, 2000),
            next_run_at: nextRunAt,
            worker_id: workerId,
            attempt
        });
        if (job.chatId) {
            const exportFailure = String(job.name || "").startsWith("export:") ? formatExportFailure(error) : null;
            const reason = exportFailure?.message ? `\n原因：${escapeHtml(exportFailure.message)}` : "";
            sendMessage(
                job.chatId,
                `${escapeHtml(job.label || "后台任务")}遇到临时网络或后端异常，将在 ${Math.ceil(delayMs / 1000)} 秒后自动重试（${attempt}/${maxAttempts}）。${reason}`
            ).catch(() => {});
        }
        const timer = setTimeout(() => {
            job.systemJobClaimed = false;
            job.systemJobRow = null;
            botTaskQueue.enqueue(job).catch((retryError) => {
                console.warn(`[bot-task] retry enqueue failed for ${job.name}: ${retryError.message || String(retryError)}`);
            });
        }, delayMs + 100);
        timer.unref?.();
        return true;
    }

    const memoryQueue = createJobQueue({
        concurrency,
        onDuplicate(job) {
            sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已在后台执行中，请等当前任务完成。`).catch(() => {});
        },
        onQueued(job, queuedAhead) {
            ensureSystemJob(job)
                .then((created) => {
                    const idLine = created?.id ? `\n任务 #${created.id}` : "";
                    return sendMessage(
                        job.chatId,
                        `${escapeHtml(job.label || "后台任务")} 已加入后台队列，前面还有 ${queuedAhead} 个任务。${idLine}`
                    );
                })
                .catch(() => {});
        },
        async beforeStart(job) {
            if (!(await claimJob(job))) {
                sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已由其他 Worker 领取或不可执行。`).catch(() => {});
                return false;
            }
            if (!(await isSystemJobCanceled(job))) return true;
            sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已取消，未开始执行。`).catch(() => {});
            return false;
        },
        async onStart(job) {
            console.log(`[bot-task] start ${job.name}`);
            const created = await ensureSystemJob(job);
            updateTrackedSystemJob(job, { status: "running", progress: 10, started: true });
            if (created?.id && job.chatId)
                await sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 开始执行。\n任务 #${created.id}`).catch(() => {});
            if (job.systemJobId && typeof client.heartbeatSystemJob === "function") {
                job.heartbeatTimer = setInterval(
                    async () => {
                        const current = await client
                            .heartbeatSystemJob(job.systemJobId, {
                                worker_id: workerId,
                                attempt: Number(job.systemJobRow?.attempt || 0),
                                lease_seconds: leaseSeconds
                            })
                            .catch(() => null);
                        if (!current || current.cancel_requested_at) job.abortController?.abort(new Error("job cancellation requested"));
                    },
                    Math.max(5000, heartbeatMs)
                );
                job.heartbeatTimer.unref?.();
            }
        },
        async onSuccess(job, ms, result) {
            const current = await currentSystemJob(job);
            if (job.signal?.aborted || current?.cancel_requested_at || current?.status === "canceled") {
                updateTrackedSystemJob(job, {
                    status: "canceled",
                    progress: Number(current?.progress || 0),
                    error: "canceled",
                    finished: true
                });
                return;
            }
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
        async onError(job, err) {
            const current = await currentSystemJob(job);
            if (job.signal?.aborted || current?.cancel_requested_at || current?.status === "canceled") {
                updateTrackedSystemJob(job, {
                    status: "canceled",
                    progress: Number(current?.progress || 0),
                    error: "canceled",
                    finished: true
                });
                if (job.chatId) sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")}已取消。`).catch(() => {});
                return;
            }
            if (await scheduleRetry(job, current, err)) return;
            const exportFailure = String(job.name || "").startsWith("export:") ? formatExportFailure(err) : null;
            const message = exportFailure
                ? `${exportFailure.code}: ${exportFailure.raw || exportFailure.message}`
                : err?.message || String(err || "unknown error");
            console.error(`[bot-task] ${job.name} failed: ${message}`);
            updateTrackedSystemJob(job, { status: "failed", progress: 100, error: message, finished: true });
            if (job.chatId && !err?.userNotified) {
                const text = exportFailure ? exportFailure.text : `${escapeHtml(job.label || "后台任务")}失败：${escapeHtml(message)}`;
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
            if (job.heartbeatTimer) clearInterval(job.heartbeatTimer);
            console.log(`[bot-task] done ${job.name} ${ms}ms`);
        }
    });

    const botTaskQueue = {
        cancel: memoryQueue.cancel,
        stats: memoryQueue.stats,
        async enqueue(job) {
            const created = await ensureSystemJob(job);
            if (!created || created.duplicate) {
                sendMessage(job.chatId, `${escapeHtml(job.label || "后台任务")} 已存在或正在由其他 Worker 执行。`).catch(() => {});
                return false;
            }
            return memoryQueue.enqueue(job);
        }
    };

    async function recoverPersistentJobs(types, factory, options = {}) {
        if (typeof client.claimSystemJobs !== "function" || typeof factory !== "function") return 0;
        const rows = await client
            .claimSystemJobs({
                worker_id: workerId,
                types,
                limit: Math.max(1, Math.min(20, Number(options.limit || concurrency * 4))),
                lease_seconds: leaseSeconds
            })
            .catch((err) => {
                console.warn(`[bot-task] recovery claim failed: ${err.message || String(err)}`);
                return [];
            });
        let recovered = 0;
        for (const row of rows) {
            const job = factory(row);
            if (!job) continue;
            job.systemJobId = row.id;
            job.systemJobClaimed = true;
            job.systemJobRow = row;
            if (memoryQueue.enqueue(job)) recovered += 1;
        }
        return recovered;
    }

    return { botTaskQueue, recoverPersistentJobs, workerId };
}

module.exports = { createBotTaskRuntime };
