/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供生产绑定、Metrics Token 与安全响应头的自动化回归断言
 * [POS]: tests 的生产绑定、Metrics Token 与安全响应头守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    isCorsOriginAllowed,
    isLoopbackHost,
    productionSecurityErrors,
    trustProxySetting
} = require("../services/http-security");

test("production CORS only allows configured origins", () => {
    const env = { NODE_ENV: "production", PO18_CORS_ORIGINS: "https://reader.example.com, https://admin.example.com" };
    assert.equal(isCorsOriginAllowed(undefined, env), true);
    assert.equal(isCorsOriginAllowed("https://reader.example.com", env), true);
    assert.equal(isCorsOriginAllowed("https://evil.example.com", env), false);
});

test("development CORS remains compatible when no allowlist is configured", () => {
    assert.equal(isCorsOriginAllowed("http://127.0.0.1:5173", { NODE_ENV: "development" }), true);
});

test("production configuration rejects known insecure defaults", () => {
    const errors = productionSecurityErrors({
        NODE_ENV: "production",
        PO18_UPLOAD_SESSION_SECRET: "po18-upload-pg-change-me",
        PO18_UPLOAD_ADMIN_PASSWORD: "admin123",
        PO18_SETUP_AUTH_DISABLED: "1"
    });
    assert.equal(errors.length, 4);
    assert.match(errors.join(" "), /SESSION_SECRET/);
    assert.match(errors.join(" "), /ADMIN_PASSWORD/);
});

test("public production metrics require authentication", () => {
    const base = {
        NODE_ENV: "production",
        PO18_UPLOAD_SESSION_SECRET: "a-long-random-session-secret",
        PO18_UPLOAD_ADMIN_PASSWORD: "a-long-random-admin-password",
        PO18_UPLOAD_HOST: "0.0.0.0"
    };
    assert.match(productionSecurityErrors(base).join(" "), /METRICS_TOKEN/);
    assert.deepEqual(productionSecurityErrors({ ...base, PO18_METRICS_TOKEN: "metrics-secret" }), []);
    assert.deepEqual(productionSecurityErrors({ ...base, PO18_UPLOAD_HOST: "127.0.0.1" }), []);
    assert.equal(isLoopbackHost("[::1]"), true);
    assert.equal(isLoopbackHost("0.0.0.0"), false);
});

test("trust proxy parser handles booleans counts and named ranges", () => {
    assert.equal(trustProxySetting(""), false);
    assert.equal(trustProxySetting("true"), true);
    assert.equal(trustProxySetting("1"), 1);
    assert.equal(trustProxySetting("loopback, linklocal"), "loopback, linklocal");
});
