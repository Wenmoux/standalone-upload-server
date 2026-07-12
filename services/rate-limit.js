/**
 * [INPUT]: 依赖请求身份/IP、时间窗口预算与 Express next/response 能力
 * [OUTPUT]: 对外提供进程内限流窗口、限流中间件、正整数配置和请求 IP 解析函数
 * [POS]: services 的轻量入口节流原语，为登录、指标和敏感路由生成统一 429/Retry-After 响应
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function requestIp(req) {
    return String(req.ip || req.socket?.remoteAddress || "unknown").trim() || "unknown";
}

function createRateWindow(options = {}) {
    const windowMs = positiveInteger(options.windowMs, 60_000);
    const max = positiveInteger(options.max, 60);
    const maxKeys = positiveInteger(options.maxKeys, 10_000);
    const now = options.now || Date.now;
    const entries = new Map();
    let operations = 0;

    function cleanup(time) {
        for (const [entryKey, entry] of entries) {
            if (entry.resetAt <= time) entries.delete(entryKey);
        }
        if (entries.size <= maxKeys) return;
        const oldest = [...entries.entries()]
            .sort((left, right) => left[1].resetAt - right[1].resetAt)
            .slice(0, entries.size - maxKeys);
        for (const [entryKey] of oldest) entries.delete(entryKey);
    }

    function consume(key) {
        const time = now();
        if (++operations % 256 === 0 || entries.size > maxKeys) cleanup(time);
        const entryKey = String(key || "unknown");
        let entry = entries.get(entryKey);
        if (!entry || entry.resetAt <= time) {
            entry = { count: 0, resetAt: time + windowMs };
            entries.set(entryKey, entry);
        }
        entry.count += 1;
        return {
            allowed: entry.count <= max,
            count: entry.count,
            limit: max,
            remaining: Math.max(0, max - entry.count),
            resetAt: entry.resetAt,
            retryAfter: Math.max(1, Math.ceil((entry.resetAt - time) / 1000))
        };
    }

    return {
        consume,
        reset(key) {
            if (key === undefined) entries.clear();
            else entries.delete(String(key || "unknown"));
        },
        size: () => entries.size
    };
}

function createRateLimiter(options = {}) {
    const key = options.key || requestIp;
    const window = createRateWindow(options);

    function middleware(req, res, next) {
        if (typeof options.skip === "function" && options.skip(req)) return next();
        const result = window.consume(key(req));
        res.setHeader("RateLimit-Limit", String(result.limit));
        res.setHeader("RateLimit-Remaining", String(result.remaining));
        res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
        if (result.allowed) return next();
        res.setHeader("Retry-After", String(result.retryAfter));
        return res.status(429).json({ error: options.message || "请求过于频繁，请稍后再试" });
    }

    middleware.reset = (entryKey) => window.reset(entryKey);
    middleware.size = window.size;
    return middleware;
}

module.exports = {
    createRateLimiter,
    createRateWindow,
    positiveInteger,
    requestIp
};
