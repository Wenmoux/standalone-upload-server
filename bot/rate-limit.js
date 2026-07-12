/**
 * [INPUT]: 依赖调用方提供的动作键、冷却时长和时间戳
 * [OUTPUT]: 对外提供进程内动作冷却限流器、等待时间格式化和毫秒配置规范化
 * [POS]: bot 交互保护层，为高成本命令提供轻量用户级节流；它不是跨实例的配额或安全鉴权机制
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
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
