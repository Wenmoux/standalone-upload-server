const { cookieHeader, cookieProfileToHeader, mergeCookies, parseCookieString, parseSetCookieHeaders } = require("./po18-crawler-cookies");
const { CookieInvalidError, authErrorFromResponse } = require("./po18-crawler-parsers");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function isRetriableRequestError(err) {
    if (!err) return false;
    if (err instanceof CookieInvalidError || err?.code === "PO18_COOKIE_INVALID") return false;
    if (err?.code === "PO18_CRAWLER_STOPPED") return false;
    const status = Number(err.status || err.statusCode || 0);
    if (status === 408 || status === 429 || status >= 500) return true;
    const message = String(err.message || err.code || err.name || err || "").toLowerCase();
    return /abort|timeout|timed out|fetch failed|network|econnreset|etimedout|eai_again|socket|terminated/.test(message);
}

function looksLikeRateLimitPage(body = "") {
    return /请求(?:过于)?频繁|操作(?:过于)?频繁|稍后再试|too many requests|rate limit/i.test(String(body || ""));
}

function parseRetryHintMs(body = "", headers, now = Date.now()) {
    const retryAfter = String(headers?.get?.("retry-after") || "").trim();
    if (/^\d+(?:\.\d+)?$/.test(retryAfter)) return Math.min(10 * 60 * 1000, Math.ceil(Number(retryAfter) * 1000));
    if (retryAfter) {
        const timestamp = Date.parse(retryAfter);
        if (Number.isFinite(timestamp)) return Math.min(10 * 60 * 1000, Math.max(0, timestamp - now));
    }
    const text = String(body || "");
    const match =
        text.match(/(?:频繁|稍后再试|等待)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(秒|分钟|分)/i) ||
        text.match(/请\s*(\d+(?:\.\d+)?)\s*(秒|分钟|分)[^。\n]{0,20}(?:再试|重试)/i);
    if (!match) return 0;
    const multiplier = match[2] === "秒" ? 1000 : 60 * 1000;
    return Math.min(10 * 60 * 1000, Math.ceil(Number(match[1]) * multiplier));
}

function jitterRetryDelay(delayMs, random = Math.random) {
    const base = Math.max(0, Number(delayMs || 0));
    if (!base) return 0;
    return Math.min(10 * 60 * 1000, Math.round(base * (1 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.2)));
}

function createPo18HttpClient(options = {}) {
    const {
        fetchImpl = globalThis.fetch,
        sourceHealth,
        configProvider = () => ({}),
        activeCookieProfile = () => null,
        saveActiveCookieProfile = async () => {},
        checkStopped = () => {},
        waitWhilePaused = async () => {},
        onRetry = () => {},
        sleepImpl = sleep,
        random = Math.random,
        defaults = {}
    } = options;
    if (typeof fetchImpl !== "function") throw new Error("fetch is not available for po18 crawler");

    let requestChain = Promise.resolve();
    let lastRequestAt = 0;

    async function waitForRequestSlot(config) {
        requestChain = requestChain
            .catch(() => {})
            .then(async () => {
                const interval = Number(config.requestIntervalMs || 0);
                const waitMs = Math.max(0, interval - (Date.now() - lastRequestAt));
                if (waitMs > 0) await sleepImpl(waitMs);
                lastRequestAt = Date.now();
            });
        return requestChain;
    }

    async function requestText(url, requestOptions = {}) {
        sourceHealth?.assertAvailable?.();
        const config = configProvider() || {};
        const maxRetries = Math.max(0, Number(config.requestRetries ?? defaults.requestRetries ?? 2));
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            checkStopped();
            await waitWhilePaused();
            await waitForRequestSlot(config);
            const profile = activeCookieProfile(config);
            const headers = {
                "User-Agent": config.userAgent || defaults.userAgent || "Mozilla/5.0",
                Accept: requestOptions.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-TW,zh-CN;q=0.9,zh;q=0.8,en;q=0.6",
                ...(requestOptions.headers || {})
            };
            const cookie = profile ? cookieProfileToHeader(profile) : String(config.cookie || "").trim();
            if (cookie) headers.Cookie = cookie;
            if (requestOptions.referer) headers.Referer = requestOptions.referer;

            const controller = new AbortController();
            let timeout = setTimeout(() => controller.abort(), config.timeoutMs || defaults.timeoutMs || 20000);
            const attemptStartedAt = Date.now();
            try {
                const response = await fetchImpl(url, {
                    method: requestOptions.method || "GET",
                    headers,
                    body: requestOptions.body,
                    redirect: "follow",
                    signal: controller.signal
                });
                const body = await response.text();
                const incoming = parseSetCookieHeaders(response.headers);
                if (profile && incoming.length) {
                    const currentCookies = profile.cookies?.length ? profile.cookies : parseCookieString(cookie);
                    const mergedCookies = mergeCookies(currentCookies, incoming);
                    await saveActiveCookieProfile({
                        cookies: mergedCookies,
                        cookie: cookieHeader(mergedCookies),
                        lastStatus: `HTTP ${response.status}`,
                        lastUsedAt: new Date().toISOString()
                    }).catch(() => {});
                }
                if (response.status === 429 || looksLikeRateLimitPage(body)) {
                    const err = new Error(`PO18 rate limited for ${url}`);
                    err.status = 429;
                    err.code = "PO18_RATE_LIMITED";
                    err.retryAfterMs = parseRetryHintMs(body, response.headers);
                    throw err;
                }
                const authError = authErrorFromResponse(response, body);
                if (authError) {
                    if (profile) {
                        await saveActiveCookieProfile({
                            lastStatus: authError.message || "cookie invalid",
                            lastUsedAt: new Date().toISOString()
                        }).catch(() => {});
                    }
                    throw authError;
                }
                if (!response.ok) {
                    const err = new Error(`PO18 HTTP ${response.status} for ${url}`);
                    err.status = response.status;
                    throw err;
                }
                sourceHealth?.recordSuccess?.(response.status, { durationMs: Date.now() - attemptStartedAt });
                return body;
            } catch (err) {
                lastError = err;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                const retriable = isRetriableRequestError(err);
                if (attempt >= maxRetries || !retriable) {
                    sourceHealth?.recordFailure?.(err, { transient: retriable, durationMs: Date.now() - attemptStartedAt });
                    throw err;
                }
                const configuredDelay =
                    Math.max(0, Number(config.requestRetryDelayMs ?? defaults.requestRetryDelayMs ?? 1200)) * (attempt + 1);
                const delay = jitterRetryDelay(Math.max(configuredDelay, Number(err.retryAfterMs || 0)), random);
                await onRetry({ attempt: attempt + 1, maxRetries, delay, error: err });
                if (delay > 0) await sleepImpl(delay);
            } finally {
                if (timeout) clearTimeout(timeout);
            }
        }
        throw lastError || new Error(`PO18 request failed for ${url}`);
    }

    return { requestText, waitForRequestSlot };
}

module.exports = {
    createPo18HttpClient,
    isRetriableRequestError,
    jitterRetryDelay,
    looksLikeRateLimitPage,
    parseRetryHintMs
};
