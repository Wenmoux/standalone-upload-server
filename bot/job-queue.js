/**
 * [INPUT]: 依赖调用方提供的并发上限、任务生命周期回调、互斥键和可选取消信号
 * [OUTPUT]: 对外提供进程内有界并发队列、同键互斥、取消与运行统计
 * [POS]: bot 任务域的内存执行器；跨重启状态、租约和恢复语义由 task-runtime 与服务端 system_jobs 负责
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function createJobQueue(options = {}) {
    const concurrency = positiveInt(options.concurrency, 2);
    const queue = [];
    const locks = new Map();
    const active = new Map();
    let running = 0;

    function stats() {
        return {
            running,
            queued: queue.length,
            locks: locks.size,
            concurrency
        };
    }

    function cancel(match) {
        const matcher = typeof match === "function"
            ? match
            : (job) => String(job.name || "") === String(match || "") || String(job.systemJobId || "") === String(match || "");
        const index = queue.findIndex(matcher);
        if (index >= 0) {
            const [job] = queue.splice(index, 1);
            if (job.lockKey) locks.delete(job.lockKey);
            options.onCancel?.(job);
            drain();
            return job;
        }
        const runningJob = [...active.values()].find(matcher);
        if (!runningJob) return null;
        runningJob.abortController?.abort(new Error("job canceled"));
        options.onCancelRequested?.(runningJob);
        return runningJob;
    }

    function enqueue(job) {
        const task = typeof job.task === "function" ? job.task : null;
        if (!task) throw new Error("job task is required");
        if (job.lockKey && locks.has(job.lockKey)) {
            options.onDuplicate?.(job, locks.get(job.lockKey));
            return false;
        }
        if (job.lockKey) locks.set(job.lockKey, { name: job.name, at: Date.now() });
        const queuedAhead = queue.length;
        queue.push({ ...job, enqueuedAt: Date.now() });
        if (running >= concurrency) options.onQueued?.(job, queuedAhead);
        drain();
        return true;
    }

    function drain() {
        while (running < concurrency && queue.length) {
            const job = queue.shift();
            running += 1;
            setImmediate(async () => {
                const startedAt = Date.now();
                const activeKey = job.name || `${startedAt}:${running}`;
                job.abortController = new AbortController();
                job.signal = job.abortController.signal;
                active.set(activeKey, job);
                try {
                    if (typeof options.beforeStart === "function") {
                        const shouldStart = await options.beforeStart(job);
                        if (shouldStart === false) return;
                    }
                    await options.onStart?.(job);
                    const result = await job.task(job.signal, job);
                    await options.onSuccess?.(job, Date.now() - startedAt, result);
                } catch (err) {
                    await options.onError?.(job, err, Date.now() - startedAt);
                } finally {
                    active.delete(activeKey);
                    if (job.lockKey) locks.delete(job.lockKey);
                    running -= 1;
                    await options.onDone?.(job, Date.now() - startedAt);
                    drain();
                }
            });
        }
    }

    return { cancel, enqueue, stats };
}

module.exports = { createJobQueue };
