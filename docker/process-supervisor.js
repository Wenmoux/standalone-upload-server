/**
 * [INPUT]: 依赖 Node.js child_process、计时器、信号与调用方注入的日志/致命退出回调
 * [OUTPUT]: 对外提供 createProcessSupervisor 与指数退避 restartDelay
 * [POS]: docker 的通用子进程生命周期原语，由 run-all 组合 server、Reader 和 Bot，保持兄弟进程故障隔离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { spawn } = require("child_process");

function positiveNumber(value, fallback, minimum = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function restartDelay(attempt, baseDelayMs, maxDelayMs) {
    const exponent = Math.max(0, Math.trunc(Number(attempt || 1)) - 1);
    return Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
}

function createProcessSupervisor(options = {}) {
    const spawnImpl = options.spawnImpl || spawn;
    const now = options.now || Date.now;
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const logger = options.logger || console;
    const logEvent = options.logEvent || (() => {});
    const appendLog = options.appendLog || ((name, chunk, stream) => stream.write(chunk));
    const baseDelayMs = positiveNumber(options.baseDelayMs, 1000);
    const maxDelayMs = positiveNumber(options.maxDelayMs, 30000);
    const stableMs = positiveNumber(options.stableMs, 120000);
    const maxRestarts = Math.trunc(positiveNumber(options.maxRestarts, 10));
    const stopTimeoutMs = positiveNumber(options.stopTimeoutMs, 10000);
    const onFatal = options.onFatal || (() => {});
    const states = new Map();
    let stopping = false;
    let fatal = false;

    function scheduleRestart(state, code, signal) {
        const uptimeMs = Math.max(0, now() - state.startedAt);
        if (uptimeMs >= stableMs) state.restartAttempts = 0;
        state.restartAttempts += 1;
        if (state.restartAttempts > maxRestarts) {
            fatal = true;
            logger.error(`[run-all] ${state.name} exceeded restart limit (${maxRestarts})`);
            logEvent("error", "run-all", "child-restart-exhausted", {
                child: state.name,
                code,
                signal: signal || "",
                restart_attempts: state.restartAttempts,
                uptime_ms: uptimeMs
            });
            onFatal({ name: state.name, code, signal, restartAttempts: state.restartAttempts });
            return;
        }
        const delayMs = restartDelay(state.restartAttempts, baseDelayMs, maxDelayMs);
        logger.warn(`[run-all] restarting ${state.name} in ${delayMs}ms (attempt ${state.restartAttempts}/${maxRestarts})`);
        logEvent("warn", "run-all", "child-restart-scheduled", {
            child: state.name,
            code,
            signal: signal || "",
            delay_ms: delayMs,
            restart_attempt: state.restartAttempts,
            uptime_ms: uptimeMs
        });
        state.restartTimer = setTimer(() => {
            state.restartTimer = null;
            if (!stopping && !fatal) spawnState(state);
        }, delayMs);
    }

    function spawnState(state) {
        state.startedAt = now();
        const child = spawnImpl(state.args[0], state.args.slice(1), {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...state.env }
        });
        state.child = child;
        state.pid = child.pid || null;
        child.stdout?.on("data", (chunk) => appendLog(state.name, chunk, process.stdout));
        child.stderr?.on("data", (chunk) => appendLog(state.name, chunk, process.stderr));
        child.once("error", (err) => {
            logger.error(`[run-all] failed to start ${state.name}: ${err.message || err}`);
            logEvent("error", "run-all", "child-spawn-error", { child: state.name, error: err.message || String(err) });
        });
        child.once("close", (code, signal) => {
            if (state.child !== child) return;
            state.child = null;
            state.pid = null;
            const exitCode = code === null || code === undefined ? 1 : code;
            logger.error(`[run-all] ${state.name} exited${signal ? ` by ${signal}` : ` with ${exitCode}`}`);
            logEvent(exitCode === 0 ? "info" : "error", "run-all", "child-exit", {
                child: state.name,
                code: exitCode,
                signal: signal || "",
                uptime_ms: Math.max(0, now() - state.startedAt)
            });
            if (stopping || fatal) return;
            if (state.restart === false) {
                onFatal({ name: state.name, code: exitCode, signal, restartAttempts: state.restartAttempts });
                return;
            }
            scheduleRestart(state, exitCode, signal);
        });
        logger.log(`[run-all] started ${state.name}: ${state.args.join(" ")}`);
        logEvent("info", "run-all", "child-start", {
            child: state.name,
            command: state.args.join(" "),
            pid: state.pid,
            restart_attempt: state.restartAttempts
        });
        return child;
    }

    function start(name, args, env = {}, settings = {}) {
        if (states.has(name)) throw new Error(`child already registered: ${name}`);
        const state = {
            name,
            args: [...args],
            env: { ...env },
            restart: settings.restart !== false,
            restartAttempts: 0,
            restartTimer: null,
            child: null,
            pid: null,
            startedAt: 0
        };
        states.set(name, state);
        return spawnState(state);
    }

    async function stopAll(signal = "SIGTERM") {
        if (stopping) return;
        stopping = true;
        const active = [];
        for (const state of states.values()) {
            if (state.restartTimer) {
                clearTimer(state.restartTimer);
                state.restartTimer = null;
            }
            const child = state.child;
            if (!child) continue;
            active.push(new Promise((resolve) => child.once("close", resolve)));
            if (!child.killed) child.kill(signal);
        }
        if (!active.length) return;
        let timeout;
        await Promise.race([
            Promise.allSettled(active),
            new Promise((resolve) => {
                timeout = setTimer(() => {
                    for (const state of states.values()) {
                        if (state.child) state.child.kill("SIGKILL");
                    }
                    resolve();
                }, stopTimeoutMs);
            })
        ]);
        if (timeout) clearTimer(timeout);
    }

    function snapshot() {
        return [...states.values()].map((state) => ({
            name: state.name,
            pid: state.pid,
            running: !!state.child,
            restartAttempts: state.restartAttempts,
            restartScheduled: !!state.restartTimer
        }));
    }

    return { snapshot, start, stopAll };
}

module.exports = { createProcessSupervisor, restartDelay };
