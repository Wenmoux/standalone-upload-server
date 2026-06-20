const assert = require("assert/strict");
const test = require("node:test");
const { createJobQueue } = require("../bot/job-queue");

test("bot job queue passes task result to success hook and releases locks", async () => {
    const events = [];
    let doneResolve;
    const done = new Promise((resolve) => {
        doneResolve = resolve;
    });
    const queue = createJobQueue({
        concurrency: 1,
        onSuccess(job, ms, result) {
            events.push({ name: job.name, result });
        },
        onDone() {
            doneResolve();
        }
    });

    assert.equal(queue.enqueue({
        name: "export:test",
        lockKey: "export:42",
        task: async () => ({ ok: true, chapters: 12 })
    }), true);
    assert.equal(queue.enqueue({
        name: "export:duplicate",
        lockKey: "export:42",
        task: async () => ({ ok: false })
    }), false);

    await done;

    assert.deepEqual(events, [{ name: "export:test", result: { ok: true, chapters: 12 } }]);
    assert.deepEqual(queue.stats(), { running: 0, queued: 0, locks: 0, concurrency: 1 });
});

test("bot job queue cancels queued jobs and releases their lock", async () => {
    let releaseFirst;
    const firstDone = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const canceled = [];
    const queue = createJobQueue({
        concurrency: 1,
        onCancel(job) {
            canceled.push(job.name);
        }
    });

    queue.enqueue({
        name: "export:first",
        lockKey: "export:first",
        task: async () => firstDone
    });
    queue.enqueue({
        name: "export:queued",
        lockKey: "export:queued",
        systemJobId: 42,
        task: async () => ({ ok: true })
    });

    await new Promise((resolve) => setImmediate(resolve));
    const job = queue.cancel("42");
    assert.equal(job.name, "export:queued");
    assert.deepEqual(canceled, ["export:queued"]);
    assert.equal(queue.enqueue({
        name: "export:replacement",
        lockKey: "export:queued",
        task: async () => ({ ok: true })
    }), true);

    releaseFirst();
    await new Promise((resolve) => setImmediate(resolve));
});

test("bot job queue beforeStart can skip a task without success hook", async () => {
    const events = [];
    let doneResolve;
    const done = new Promise((resolve) => {
        doneResolve = resolve;
    });
    const queue = createJobQueue({
        concurrency: 1,
        beforeStart(job) {
            events.push(`before:${job.name}`);
            return false;
        },
        onStart(job) {
            events.push(`start:${job.name}`);
        },
        onSuccess(job) {
            events.push(`success:${job.name}`);
        },
        onDone(job) {
            events.push(`done:${job.name}`);
            doneResolve();
        }
    });

    queue.enqueue({
        name: "export:skip",
        lockKey: "export:skip",
        task: async () => {
            events.push("task");
            return { ok: true };
        }
    });

    await done;

    assert.deepEqual(events, ["before:export:skip", "done:export:skip"]);
    assert.deepEqual(queue.stats(), { running: 0, queued: 0, locks: 0, concurrency: 1 });
});
