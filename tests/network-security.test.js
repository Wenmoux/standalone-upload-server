/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供出站 URL、私网与代理安全规则的自动化回归断言
 * [POS]: tests 的出站 URL、私网与代理安全规则守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const {
    assertSafeHttpTarget,
    hostMatchesRule,
    isBlockedAddress
} = require("../services/network-security");
const { readLimitedBody } = require("../routes/reader-tts");

test("network security blocks local and private TTS targets", async () => {
    for (const target of [
        "http://127.0.0.1:3100/health",
        "http://10.1.2.3/",
        "http://[::1]/",
        "http://localhost/"
    ]) {
        await assert.rejects(() => assertSafeHttpTarget(target), /不允许访问本机或内网地址/);
    }

    await assert.rejects(
        () => assertSafeHttpTarget("https://tts.example.com/api", {
            lookup: async () => [{ address: "192.168.1.10", family: 4 }]
        }),
        /不允许访问本机或内网地址/
    );
});

test("network security allows public TTS targets and optional host rules", async () => {
    const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
    const target = await assertSafeHttpTarget("https://api.example.com/speech", {
        lookup,
        allowedHosts: ["*.example.com"]
    });
    assert.equal(target.href, "https://api.example.com/speech");
    await assert.rejects(
        () => assertSafeHttpTarget("https://other.example.net/speech", {
            lookup,
            allowedHosts: ["*.example.com"]
        }),
        /域名不在允许列表/
    );
});

test("network security recognizes host rules and reserved addresses", () => {
    assert.equal(hostMatchesRule("api.example.com", "*.example.com"), true);
    assert.equal(hostMatchesRule("example.com", "*.example.com"), false);
    assert.equal(hostMatchesRule("example.com", "example.com"), true);
    assert.equal(isBlockedAddress("169.254.169.254"), true);
    assert.equal(isBlockedAddress("100.64.0.1"), true);
    assert.equal(isBlockedAddress("8.8.8.8"), false);
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
});

test("TTS proxy response reader enforces its byte limit", async () => {
    let aborted = false;
    const response = new Response(Buffer.alloc(2048));
    await assert.rejects(
        () => readLimitedBody(response, 1024, () => { aborted = true; }),
        /响应过大/
    );
    assert.equal(aborted, true);
});
