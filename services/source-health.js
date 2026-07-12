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
        authFailures: 0,
        rateLimits: 0,
        parseFailures: 0,
        consecutiveFailures: 0,
        circuitOpenUntil: 0,
        lastStatus: 0,
        lastError: "",
        lastSuccessAt: null,
        lastFailureAt: null,
        durations: []
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

    function recordDuration(durationMs) {
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration < 0) return;
        state.durations.push(duration);
        if (state.durations.length > 500) state.durations.splice(0, state.durations.length - 500);
    }

    function durationPercentile(ratio) {
        if (!state.durations.length) return 0;
        const sorted = state.durations.slice().sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    }

    function recordSuccess(status = 200, { durationMs } = {}) {
        state.requests += 1;
        state.successes += 1;
        state.consecutiveFailures = 0;
        state.circuitOpenUntil = 0;
        state.lastStatus = Number(status || 0);
        state.lastError = "";
        state.lastSuccessAt = new Date(now()).toISOString();
        recordDuration(durationMs);
    }

    function recordFailure(error, { transient = false, durationMs, kind = "" } = {}) {
        state.requests += 1;
        state.failures += 1;
        state.lastStatus = Number(error?.status || error?.statusCode || 0);
        state.lastError = String(error?.message || error || "source request failed").slice(0, 500);
        state.lastFailureAt = new Date(now()).toISOString();
        recordDuration(durationMs);
        const status = Number(error?.status || error?.statusCode || 0);
        const code = String(error?.code || "").toLowerCase();
        const message = String(error?.message || error || "").toLowerCase();
        const failureKind = String(kind || "").toLowerCase();
        if (failureKind === "auth" || status === 401 || status === 403 || /cookie|auth|login/.test(`${code} ${message}`)) state.authFailures += 1;
        if (failureKind === "rate_limit" || status === 429 || /rate|frequent|频繁|稍后再试/.test(message)) state.rateLimits += 1;
        if (failureKind === "parse" || /parse|structure|selector|解析|结构/.test(`${code} ${message}`)) state.parseFailures += 1;
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
            authFailures: state.authFailures,
            rateLimits: state.rateLimits,
            parseFailures: state.parseFailures,
            latencyP50Ms: durationPercentile(0.5),
            latencyP95Ms: durationPercentile(0.95),
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
