const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createPo18HttpClient,
    isRetriableRequestError,
    looksLikeRateLimitPage,
    parseRetryHintMs
} = require("../services/po18-crawler-http");

test("PO18 HTTP client retries transient responses and records recovery", async () => {
    let calls = 0;
    const retries = [];
    const health = [];
    const client = createPo18HttpClient({
        fetchImpl: async () => {
            calls += 1;
            return calls === 1 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
        },
        sourceHealth: {
            assertAvailable() {},
            recordSuccess(status) {
                health.push(["success", status]);
            },
            recordFailure(error, meta) {
                health.push(["failure", error.message, meta]);
            }
        },
        configProvider: () => ({
            requestRetries: 2,
            requestRetryDelayMs: 0,
            requestIntervalMs: 0,
            timeoutMs: 1000,
            userAgent: "test"
        }),
        onRetry: (row) => retries.push(row),
        defaults: { requestRetryDelayMs: 0 }
    });
    assert.equal(await client.requestText("https://www.po18.tw/test"), "ok");
    assert.equal(calls, 2);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].attempt, 1);
    assert.deepEqual(health, [["success", 200]]);
});

test("PO18 HTTP retry classification excludes cookie and stop errors", () => {
    assert.equal(isRetriableRequestError(Object.assign(new Error("cookie"), { code: "PO18_COOKIE_INVALID" })), false);
    assert.equal(isRetriableRequestError(Object.assign(new Error("stop"), { code: "PO18_CRAWLER_STOPPED" })), false);
    assert.equal(isRetriableRequestError(Object.assign(new Error("busy"), { status: 429 })), true);
    assert.equal(isRetriableRequestError(new Error("fetch failed: ECONNRESET")), true);
    assert.equal(isRetriableRequestError(Object.assign(new Error("not found"), { status: 404 })), false);
});

test("PO18 HTTP client honors dynamic Chinese retry hints with bounded jitter", async () => {
    let calls = 0;
    const delays = [];
    const retries = [];
    const client = createPo18HttpClient({
        fetchImpl: async () => {
            calls += 1;
            return calls === 1 ? new Response("请求频繁，请 7 秒后再试", { status: 200 }) : new Response("chapter body", { status: 200 });
        },
        sourceHealth: { assertAvailable() {}, recordSuccess() {}, recordFailure() {} },
        configProvider: () => ({ requestRetries: 1, requestRetryDelayMs: 100, requestIntervalMs: 0, timeoutMs: 1000 }),
        sleepImpl: async (ms) => delays.push(ms),
        random: () => 0.5,
        onRetry: (row) => retries.push(row)
    });
    assert.equal(await client.requestText("https://www.po18.tw/chapter"), "chapter body");
    assert.equal(retries[0].error.code, "PO18_RATE_LIMITED");
    assert.equal(retries[0].delay, 7700);
    assert.deepEqual(delays, [7700]);
});

test("PO18 retry hint parser supports Retry-After and never stores prompt pages as content", () => {
    assert.equal(looksLikeRateLimitPage("操作过于频繁，稍后再试"), true);
    assert.equal(parseRetryHintMs("", { get: () => "3" }), 3000);
    assert.equal(parseRetryHintMs("请求频繁，请 2 分钟后再试"), 120000);
});
