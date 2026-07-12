/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供子进程重启退避、信号和退出策略的自动化回归断言
 * [POS]: tests 的子进程重启退避、信号和退出策略守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const { EventEmitter } = require("events");
const test = require("node:test");
const { createProcessSupervisor, restartDelay } = require("../docker/process-supervisor");

function fakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = (signal) => {
        child.killed = true;
        child.signal = signal;
        queueMicrotask(() => child.emit("close", 0, signal));
        return true;
    };
    return child;
}

test("process supervisor calculates capped exponential restart delays", () => {
    assert.equal(restartDelay(1, 1000, 30000), 1000);
    assert.equal(restartDelay(3, 1000, 30000), 4000);
    assert.equal(restartDelay(10, 1000, 30000), 30000);
});

test("process supervisor restarts one failed child without stopping siblings", async () => {
    const spawned = [];
    const timers = [];
    const supervisor = createProcessSupervisor({
        spawnImpl: () => {
            const child = fakeChild(spawned.length + 1);
            spawned.push(child);
            return child;
        },
        setTimeout: (fn, delay) => {
            timers.push({ fn, delay, cleared: false });
            return timers.length;
        },
        clearTimeout: (id) => {
            if (timers[id - 1]) timers[id - 1].cleared = true;
        },
        appendLog: () => {},
        logger: { log() {}, warn() {}, error() {} },
        baseDelayMs: 50,
        maxDelayMs: 500,
        maxRestarts: 3
    });

    supervisor.start("server", ["node", "server.js"]);
    supervisor.start("reader", ["node", "reader.js"]);
    spawned[0].emit("close", 1, null);

    assert.equal(timers[0].delay, 50);
    assert.equal(spawned[1].killed, false);
    timers[0].fn();
    assert.equal(spawned.length, 3);
    assert.deepEqual(supervisor.snapshot().find((item) => item.name === "server"), {
        name: "server",
        pid: 3,
        running: true,
        restartAttempts: 1,
        restartScheduled: false
    });

    const stopping = supervisor.stopAll();
    await stopping;
    assert.equal(spawned[1].signal, "SIGTERM");
    assert.equal(spawned[2].signal, "SIGTERM");
});

test("process supervisor reports fatal after restart limit", () => {
    const children = [];
    const timers = [];
    let fatal = null;
    const supervisor = createProcessSupervisor({
        spawnImpl: () => {
            const child = fakeChild(children.length + 1);
            children.push(child);
            return child;
        },
        setTimeout: (fn) => {
            timers.push(fn);
            return timers.length;
        },
        clearTimeout: () => {},
        appendLog: () => {},
        logger: { log() {}, warn() {}, error() {} },
        maxRestarts: 1,
        onFatal: (event) => { fatal = event; }
    });

    supervisor.start("bot", ["node", "bot.js"]);
    children[0].emit("close", 1, null);
    timers[0]();
    children[1].emit("close", 1, null);

    assert.equal(fatal.name, "bot");
    assert.equal(fatal.restartAttempts, 2);
});
