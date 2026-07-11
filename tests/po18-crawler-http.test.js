const test = require("node:test");
const assert = require("node:assert/strict");
const { createPo18HttpClient, isRetriableRequestError } = require("../services/po18-crawler-http");

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
