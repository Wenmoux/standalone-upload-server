/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供API Token 创建、哈希、权限与吊销语义的自动化回归断言
 * [POS]: tests 的API Token 创建、哈希、权限与吊销语义守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { botScopeForRequest, createApiTokenService, tokenHash } = require("../services/api-tokens");

test("API token service stores hashes and enforces scopes and source IP", async () => {
    const rawToken = "test-token-value-that-is-long";
    const calls = [];
    const row = {
        id: 1,
        name: "bot",
        kind: "bot",
        token_prefix: "test...long",
        scopes_json: ["bot:read"],
        allowed_ips_json: ["127.0.0.1"],
        revoked_at: null
    };
    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (/INSERT INTO api_tokens/.test(sql)) return { rows: [row] };
        if (/FROM api_tokens WHERE token_hash/.test(sql)) return { rows: [params[0] === tokenHash(rawToken) ? row : undefined].filter(Boolean) };
        if (/UPDATE api_tokens SET last_used_at/.test(sql)) return { rows: [] };
        return { rows: [] };
    };
    const service = createApiTokenService({ query, cacheTtlMs: 1000 });
    await service.syncToken({ name: "bot", kind: "bot", token: rawToken, scopes: ["bot:read"], allowedIps: ["127.0.0.1"] });
    assert.equal(calls[0].params.includes(rawToken), false);
    assert.equal(calls[0].params[2], tokenHash(rawToken));

    const allowed = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:read", req: { ip: "127.0.0.1" } });
    assert.equal(allowed.ok, true);
    const deniedScope = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:admin", req: { ip: "127.0.0.1" } });
    assert.equal(deniedScope.status, 403);
    const deniedIp = await service.authenticate({ token: rawToken, kind: "bot", scope: "bot:read", req: { ip: "10.0.0.1" } });
    assert.equal(deniedIp.status, 403);
});

test("Bot request scope separates admin currency from normal rewards", () => {
    assert.equal(botScopeForRequest({ method: "GET", path: "/bot-api/commands" }), "bot:read");
    assert.equal(botScopeForRequest({ method: "POST", path: "/bot-api/jobs" }), "bot:export");
    assert.equal(botScopeForRequest({ method: "GET", path: "/bot-api/users/1/po18/credentials" }), "bot:po18");
    assert.equal(botScopeForRequest({ method: "PATCH", path: "/bot-api/users/1/currency", body: {} }), "bot:admin");
    assert.equal(botScopeForRequest({ method: "PATCH", path: "/bot-api/users/1/currency", body: { type: "po18_bookshelf_share_reward" } }), "bot:user");
});
