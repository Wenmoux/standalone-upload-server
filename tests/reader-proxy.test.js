/**
 * [INPUT]: 依赖 node:test、assert 与 cirno-src/reader-server 的请求头代理纯函数
 * [OUTPUT]: 提供 Reader 3200→3100 转发时公网 Host、协议和上游 Host 隔离的回归断言
 * [POS]: tests 的 Reader 反向代理契约守卫，防止代理升级再次破坏会话 Cookie 或 CSRF 来源判断
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const assert = require("assert/strict");
const test = require("node:test");
const { proxyRequestHeaders } = require("../cirno-src/reader-server");

test("Reader proxy preserves the public host and HTTPS protocol for server CSRF checks", () => {
    const headers = proxyRequestHeaders(
        {
            protocol: "http",
            headers: {
                host: "reader.example.com",
                origin: "https://reader.example.com",
                "x-forwarded-proto": "https"
            },
            socket: { encrypted: false }
        },
        new URL("http://127.0.0.1:3100/reader-auth/login")
    );

    assert.equal(headers.host, "127.0.0.1:3100");
    assert.equal(headers["x-forwarded-host"], "reader.example.com");
    assert.equal(headers["x-forwarded-proto"], "https");
    assert.equal(headers.origin, "https://reader.example.com");
});

test("Reader proxy derives protocol from its own TLS connection without forwarded metadata", () => {
    const headers = proxyRequestHeaders(
        { protocol: "https", headers: { host: "books.example.net" }, socket: { encrypted: true } },
        new URL("http://server-pg:3100/reader-api/me/bookshelf")
    );
    assert.equal(headers.host, "server-pg:3100");
    assert.equal(headers["x-forwarded-host"], "books.example.net");
    assert.equal(headers["x-forwarded-proto"], "https");
});
