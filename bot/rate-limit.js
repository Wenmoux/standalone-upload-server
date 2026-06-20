function positiveMs(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function formatWait(ms) {
    const seconds = Math.ceil(Math.max(0, ms) / 1000);
    if (seconds <= 1) return "1 秒";
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} 分钟`;
}

function createRateLimiter(options = {}) {
    const buckets = new Map();
    const maxKeys = Math.max(100, Number(options.maxKeys || 5000));

    function cleanup(now = Date.now()) {
        if (buckets.size <= maxKeys) return;
        for (const [key, row] of buckets) {
            if (row.expiresAt <= now) buckets.delete(key);
            if (buckets.size <= maxKeys) break;
        }
    }

    function check(key, cooldownMs, now = Date.now()) {
        const ttl = positiveMs(cooldownMs, 0);
        if (!ttl) return { allowed: true, retryAfterMs: 0 };
        const row = buckets.get(key);
        if (row && row.expiresAt > now) {
            return { allowed: false, retryAfterMs: row.expiresAt - now };
        }
        buckets.set(key, { expiresAt: now + ttl });
        cleanup(now);
        return { allowed: true, retryAfterMs: 0 };
    }

    function reset(key) {
        buckets.delete(key);
    }

    function stats() {
        return { keys: buckets.size, maxKeys };
    }

    return { check, reset, stats };
}

module.exports = { createRateLimiter, formatWait, positiveMs };
