/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供CSRF Token 与受保护请求判定的自动化回归断言
 * [POS]: tests 的CSRF Token 与受保护请求判定守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供CSRF Token 与受保护请求判定的自动化回归断言
 * [POS]: tests 的CSRF Token 与受保护请求判定守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createCsrfProtection, trustedOrigins } = require("../services/csrf");

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function run(middleware, req) {
    const res = response();
    let continued = false;
    middleware(req, res, () => { continued = true; });
    return { continued, res };
}

function request(overrides = {}) {
    return {
        method: "POST",
        path: "/admin-api/books",
        protocol: "https",
        headers: {
            host: "reader.example.com",
            cookie: "po18_upload_admin_pg=session",
            origin: "https://reader.example.com"
        },
        ...overrides
    };
}

test("CSRF protection accepts same-origin and configured Reader origins", () => {
    const middleware = createCsrfProtection({ env: { NODE_ENV: "production", PO18_READER_PORT: "3200" } });
    assert.equal(run(middleware, request()).continued, true);
    assert.equal(run(middleware, request({
        headers: {
            host: "reader.example.com:3100",
            cookie: "po18_upload_admin_pg=session",
            origin: "https://reader.example.com:3200"
        }
    })).continued, true);

    const configured = createCsrfProtection({
        env: { NODE_ENV: "production", PO18_CORS_ORIGINS: "https://web.example.net" }
    });
    assert.equal(run(configured, request({
        headers: {
            host: "api.example.com",
            cookie: "po18_upload_admin_pg=session",
            origin: "https://web.example.net"
        }
    })).continued, true);

    const proxyRewrittenHost = run(middleware, request({
        headers: {
            host: "127.0.0.1:3100",
            cookie: "po18_upload_admin_pg=session",
            origin: "https://reader.example.com",
            "sec-fetch-site": "same-origin"
        }
    }));
    assert.equal(proxyRewrittenHost.continued, true);
});

test("CSRF protection rejects cross-site and origin-less Session writes", () => {
    const middleware = createCsrfProtection({ env: { NODE_ENV: "production" } });
    const crossSite = run(middleware, request({
        headers: {
            host: "reader.example.com",
            cookie: "po18_upload_admin_pg=session",
            origin: "https://evil.example.net",
            "sec-fetch-site": "cross-site"
        }
    }));
    assert.equal(crossSite.continued, false);
    assert.equal(crossSite.res.statusCode, 403);

    const missing = run(middleware, request({
        headers: { host: "reader.example.com", cookie: "po18_upload_admin_pg=session" }
    }));
    assert.equal(missing.res.statusCode, 403);
    assert.match(missing.res.body.error, /来源信息/);
});

test("CSRF protection preserves token clients and safe methods", () => {
    const middleware = createCsrfProtection({ env: { NODE_ENV: "production" } });
    assert.equal(run(middleware, request({ headers: { host: "api.example.com" } })).continued, true);
    assert.equal(run(middleware, request({ method: "GET" })).continued, true);
});

test("trusted origins include the configured public Reader and proxy port", () => {
    const origins = trustedOrigins(request({ headers: { host: "api.example.com:3100" } }), {
        PO18_READER_PUBLIC_URL: "https://books.example.net/library",
        PO18_READER_PORT: "3200"
    });
    assert.equal(origins.has("https://books.example.net"), true);
    assert.equal(origins.has("https://api.example.com:3200"), true);
});
