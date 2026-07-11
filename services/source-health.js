function positiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function createSourceHealthCircuit(options = {}) {
    const source = String(options.source || "source").trim() || "source";
    const failureThreshold = positiveInt(options.failureThreshold, 5, 1, 100);
    const cooldownMs = positiveInt(options.cooldownMs, 60000, 1000, 60 * 60 * 1000);
    const now = options.now || Date.now;
    const state = {
        requests: 0,
        successes: 0,
        failures: 0,
        transientFailures: 0,
        consecutiveFailures: 0,
        circuitOpenUntil: 0,
        lastStatus: 0,
        lastError: "",
        lastSuccessAt: null,
        lastFailureAt: null
    };

    function circuitState() {
        if (state.circuitOpenUntil > now()) return "open";
        if (state.consecutiveFailures >= failureThreshold) return "half_open";
        return "closed";
    }

    function assertAvailable() {
        if (state.circuitOpenUntil <= now()) return;
        const err = new Error(`${source} circuit open until ${new Date(state.circuitOpenUntil).toISOString()}`);
        err.code = "SOURCE_CIRCUIT_OPEN";
        err.status = 503;
        err.retryAfterMs = Math.max(0, state.circuitOpenUntil - now());
        throw err;
    }

    function recordSuccess(status = 200) {
        state.requests += 1;
        state.successes += 1;
        state.consecutiveFailures = 0;
        state.circuitOpenUntil = 0;
        state.lastStatus = Number(status || 0);
        state.lastError = "";
        state.lastSuccessAt = new Date(now()).toISOString();
    }

    function recordFailure(error, { transient = false } = {}) {
        state.requests += 1;
        state.failures += 1;
        state.lastStatus = Number(error?.status || error?.statusCode || 0);
        state.lastError = String(error?.message || error || "source request failed").slice(0, 500);
        state.lastFailureAt = new Date(now()).toISOString();
        if (!transient) {
            state.consecutiveFailures = 0;
            return;
        }
        state.transientFailures += 1;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= failureThreshold) state.circuitOpenUntil = now() + cooldownMs;
    }

    function snapshot() {
        return {
            source,
            state: circuitState(),
            failureThreshold,
            cooldownMs,
            requests: state.requests,
            successes: state.successes,
            failures: state.failures,
            transientFailures: state.transientFailures,
            consecutiveFailures: state.consecutiveFailures,
            circuitOpenUntil: state.circuitOpenUntil ? new Date(state.circuitOpenUntil).toISOString() : null,
            lastStatus: state.lastStatus,
            lastError: state.lastError,
            lastSuccessAt: state.lastSuccessAt,
            lastFailureAt: state.lastFailureAt
        };
    }

    return { assertAvailable, recordFailure, recordSuccess, snapshot };
}

module.exports = { createSourceHealthCircuit };
