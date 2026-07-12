/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供内存限流窗口和响应元数据的自动化回归断言
 * [POS]: tests 的内存限流窗口和响应元数据守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createRateLimiter, createRateWindow } = require("../services/rate-limit");

function response() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test("rate limiter rejects requests over the window limit", () => {
    let time = 1_000;
    const limiter = createRateLimiter({ max: 2, windowMs: 10_000, now: () => time });
    const req = { ip: "127.0.0.1" };

    for (let index = 0; index < 2; index++) {
        const res = response();
        let continued = false;
        limiter(req, res, () => { continued = true; });
        assert.equal(continued, true);
        assert.equal(res.headers["RateLimit-Limit"], "2");
    }

    const blocked = response();
    limiter(req, blocked, () => assert.fail("request should be blocked"));
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers["Retry-After"], "10");
    assert.equal(blocked.body.error, "请求过于频繁，请稍后再试");

    time += 10_001;
    const reset = response();
    let continued = false;
    limiter(req, reset, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(reset.headers["RateLimit-Remaining"], "1");
});

test("rate limiter keeps independent keys", () => {
    const limiter = createRateLimiter({ max: 1, key: (req) => req.token });
    for (const token of ["a", "b"]) {
        const res = response();
        let continued = false;
        limiter({ token }, res, () => { continued = true; });
        assert.equal(continued, true);
    }
    assert.equal(limiter.size(), 2);
});

test("rate window can protect non-Express authentication flows", () => {
    let time = 5_000;
    const window = createRateWindow({ max: 1, windowMs: 2_000, now: () => time });
    assert.deepEqual(window.consume("client-a"), {
        allowed: true,
        count: 1,
        limit: 1,
        remaining: 0,
        resetAt: 7_000,
        retryAfter: 2
    });
    assert.equal(window.consume("client-a").allowed, false);
    window.reset("client-a");
    assert.equal(window.consume("client-a").allowed, true);
    time += 2_001;
    assert.equal(window.consume("client-b").allowed, true);
});
