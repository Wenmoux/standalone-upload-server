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
