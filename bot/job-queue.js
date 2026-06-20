function positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function createJobQueue(options = {}) {
    const concurrency = positiveInt(options.concurrency, 2);
    const queue = [];
    const locks = new Map();
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
        if (index < 0) return null;
        const [job] = queue.splice(index, 1);
        if (job.lockKey) locks.delete(job.lockKey);
        options.onCancel?.(job);
        drain();
        return job;
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
                try {
                    if (typeof options.beforeStart === "function") {
                        const shouldStart = await options.beforeStart(job);
                        if (shouldStart === false) return;
                    }
                    options.onStart?.(job);
                    const result = await job.task();
                    options.onSuccess?.(job, Date.now() - startedAt, result);
                } catch (err) {
                    options.onError?.(job, err, Date.now() - startedAt);
                } finally {
                    if (job.lockKey) locks.delete(job.lockKey);
                    running -= 1;
                    options.onDone?.(job, Date.now() - startedAt);
                    drain();
                }
            });
        }
    }

    return { cancel, enqueue, stats };
}

module.exports = { createJobQueue };
