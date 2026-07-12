/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供内容来源熔断与健康评分的自动化回归断言
 * [POS]: tests 的内容来源熔断与健康评分守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createSourceHealthCircuit } = require("../services/source-health");

test("source health circuit opens after transient failures and recovers", () => {
    let now = Date.parse("2026-07-11T00:00:00.000Z");
    const circuit = createSourceHealthCircuit({
        source: "po18",
        failureThreshold: 2,
        cooldownMs: 5000,
        now: () => now
    });

    circuit.recordFailure(Object.assign(new Error("timeout"), { status: 503 }), { transient: true });
    assert.equal(circuit.snapshot().state, "closed");
    circuit.recordFailure(Object.assign(new Error("timeout"), { status: 503 }), { transient: true });
    assert.equal(circuit.snapshot().state, "open");
    assert.throws(() => circuit.assertAvailable(), (err) => err.code === "SOURCE_CIRCUIT_OPEN" && err.retryAfterMs === 5000);

    now += 5000;
    assert.equal(circuit.snapshot().state, "half_open");
    circuit.assertAvailable();
    circuit.recordSuccess(200);
    const snapshot = circuit.snapshot();
    assert.equal(snapshot.state, "closed");
    assert.equal(snapshot.consecutiveFailures, 0);
    assert.equal(snapshot.successes, 1);
});

test("source health does not open the circuit for non-transient failures", () => {
    const circuit = createSourceHealthCircuit({ source: "po18", failureThreshold: 1 });
    circuit.recordFailure(Object.assign(new Error("not found"), { status: 404 }), { transient: false });
    assert.equal(circuit.snapshot().state, "closed");
});

test("source health separates auth rate-limit and parse failures with latency quantiles", () => {
    const circuit = createSourceHealthCircuit({ source: "po18" });
    circuit.recordSuccess(200, { durationMs: 10 });
    circuit.recordFailure(Object.assign(new Error("cookie invalid"), { status: 403 }), { durationMs: 20 });
    circuit.recordFailure(Object.assign(new Error("请求频繁"), { status: 429 }), { transient: true, durationMs: 30 });
    circuit.recordFailure(Object.assign(new Error("parse structure changed"), { code: "PARSE_FAILED" }), { durationMs: 40 });
    const snapshot = circuit.snapshot();
    assert.equal(snapshot.authFailures, 1);
    assert.equal(snapshot.rateLimits, 1);
    assert.equal(snapshot.parseFailures, 1);
    assert.equal(snapshot.latencyP50Ms, 20);
    assert.equal(snapshot.latencyP95Ms, 40);
});
