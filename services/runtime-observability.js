/**
 * [INPUT]: 依赖运行时缓存、请求上下文、状态采集器、结构化事件和进程错误分类器
 * [OUTPUT]: 对外提供短期缓存、慢搜索记录、系统状态复用及致命错误监听装配
 * [POS]: services 的运行观测适配层，使组合根只声明策略参数而不实现缓存与错误分支
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function getFreshCache(cache, ttlMs, now = Date.now) {
    if (!ttlMs || ttlMs <= 0 || !cache.payload) return null;
    return now() - cache.at <= ttlMs ? cache.payload : null;
}

function setFreshCache(cache, payload, now = Date.now) {
    cache.at = now();
    cache.payload = payload;
    return payload;
}

function slowSearchContext(req, extra = {}) {
    const queryParams = req.query || {};
    return {
        path: req.originalUrl || req.path,
        q: queryParams.q || "",
        keyword: queryParams.keyword || "",
        tag: queryParams.tag || "",
        author: queryParams.author || "",
        platform: queryParams.platform || "",
        sort: queryParams.sort || "",
        page: queryParams.page || "",
        limit: queryParams.limit || "",
        ...extra
    };
}

function createSlowSearchLogger(options = {}) {
    const thresholdMs = Number(options.thresholdMs || 0);
    const logEvent = options.logEvent || (() => {});
    const logger = options.logger || console;
    const now = options.now || Date.now;
    return function logSlowSearch(label, startedAt, context = {}) {
        const ms = now() - startedAt;
        if (thresholdMs <= 0 || ms < thresholdMs) return;
        logger.warn(`[slow-search] ${label} ${ms}ms ${JSON.stringify({ ...context, elapsedMs: ms })}`);
        logEvent("warn", "server-pg", "slow-search", { label, duration_ms: ms, context });
    };
}

function createCachedSystemStatusCollector(options = {}) {
    const cache = options.cache || { at: 0, payload: null };
    const ttlMs = Number(options.ttlMs || 0);
    const collectStatus = options.collectStatus;
    const configFile = options.configFile;
    const now = options.now || Date.now;
    return async function collectCachedSystemStatus() {
        const cached = getFreshCache(cache, ttlMs, now);
        if (cached) return cached;
        return setFreshCache(cache, await collectStatus(configFile), now);
    };
}

function installProcessErrorHandlers(options = {}) {
    const processRef = options.processRef || process;
    const isDatabaseError = options.isDatabaseError || (() => false);
    const logger = options.logger || console;
    processRef.on("unhandledRejection", (reason) => {
        const message = reason && reason.message ? reason.message : String(reason || "");
        if (isDatabaseError(reason)) {
            logger.warn(`[unhandled-db] ${message}`);
            return;
        }
        logger.error(`[unhandled-rejection] ${message}`);
        processRef.exit(1);
    });
    processRef.on("uncaughtException", (err) => {
        const message = err && err.message ? err.message : String(err || "");
        if (isDatabaseError(err)) {
            logger.warn(`[uncaught-db] ${message}`);
            return;
        }
        logger.error(`[uncaught-exception] ${message}`);
        processRef.exit(1);
    });
}

module.exports = {
    createCachedSystemStatusCollector,
    createSlowSearchLogger,
    getFreshCache,
    installProcessErrorHandlers,
    setFreshCache,
    slowSearchContext
};
