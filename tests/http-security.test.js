const assert = require("assert/strict");
const test = require("node:test");
const {
    isCorsOriginAllowed,
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
    assert.equal(errors.length, 3);
    assert.match(errors.join(" "), /SESSION_SECRET/);
    assert.match(errors.join(" "), /ADMIN_PASSWORD/);
});

test("trust proxy parser handles booleans counts and named ranges", () => {
    assert.equal(trustProxySetting(""), false);
    assert.equal(trustProxySetting("true"), true);
    assert.equal(trustProxySetting("1"), 1);
    assert.equal(trustProxySetting("loopback, linklocal"), "loopback, linklocal");
});
