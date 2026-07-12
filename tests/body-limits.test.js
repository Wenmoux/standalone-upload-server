/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供分路由请求体限制与拒绝语义的自动化回归断言
 * [POS]: tests 的分路由请求体限制与拒绝语义守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const express = require("express");
const {
    DEFAULT_BODY_LIMITS,
    ROUTE_BODY_LIMITS,
    bodyLimitConfig,
    installRouteBodyParsers,
    normalizedLimit
} = require("../services/body-limits");

async function withApp(env, callback) {
    const app = express();
    installRouteBodyParsers(app, express, env);
    app.post("*", (req, res) => res.json({ bytes: Buffer.byteLength(String(req.body?.value || "")) }));
    app.use((err, req, res, next) => {
        if (err?.type === "entity.too.large") return res.status(413).json({ code: "PAYLOAD_TOO_LARGE" });
        next(err);
    });
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("body limit configuration validates overrides and keeps safe defaults", () => {
    const config = bodyLimitConfig({
        PO18_BODY_LIMIT_AUTH: "48KB",
        PO18_BODY_LIMIT_CHAPTER: "20mb",
        PO18_BODY_LIMIT_DEFAULT: "unlimited"
    });
    assert.equal(config.auth, "48kb");
    assert.equal(config.chapter, "20mb");
    assert.equal(config.default, DEFAULT_BODY_LIMITS.default);
    assert.equal(normalizedLimit("0.5mb", "1mb"), "0.5mb");
    assert.ok(ROUTE_BODY_LIMITS.some((item) => item.name === "metadata"));
    assert.ok(ROUTE_BODY_LIMITS.some((item) => item.name === "manifest"));
});

test("auth requests are rejected before the larger default JSON limit", async () => {
    await withApp({
        PO18_BODY_LIMIT_AUTH: "1kb",
        PO18_BODY_LIMIT_DEFAULT: "32kb"
    }, async (base) => {
        const oversized = await fetch(`${base}/reader-auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: "x".repeat(2048) })
        });
        assert.equal(oversized.status, 413);

        const ordinary = await fetch(`${base}/bot-api/example`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: "x".repeat(2048) })
        });
        assert.equal(ordinary.status, 200);
    });
});
