/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供持久任务领取、执行、续租、完成及最终导出失败耗时反馈语义的自动化回归断言
 * [POS]: tests 的持久任务领取、执行、续租和完成语义守卫，防止导出终态反馈或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBotTaskRuntime } = require("../bot/task-runtime");

function waitFor(check, timeoutMs = 1000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (check()) return resolve();
            if (Date.now() - started > timeoutMs) return reject(new Error("condition timeout"));
            setTimeout(poll, 5);
        };
        poll();
    });
}

function fakeClient() {
    const calls = [];
    const jobs = new Map();
    let nextId = 1;
    return {
        calls,
        jobs,
        async createSystemJob(payload) {
            const job = { id: nextId++, status: "queued", attempt: 0, max_attempts: payload.max_attempts || 3, ...payload };
            jobs.set(job.id, job);
            calls.push(["create", payload]);
            return job;
        },
        async claimSystemJob(id, payload) {
            const job = jobs.get(id);
            if (!job || job.status !== "queued") return null;
            Object.assign(job, { status: "running", attempt: job.attempt + 1, locked_by: payload.worker_id });
            calls.push(["claim", id, payload]);
            return { ...job };
        },
        async claimSystemJobs(payload) {
            calls.push(["claim-many", payload]);
            return [];
        },
        async getSystemJob(id) {
            return jobs.get(id) ? { ...jobs.get(id) } : null;
        },
        async heartbeatSystemJob(id) {
            return jobs.get(id) ? { ...jobs.get(id) } : null;
        },
        async updateSystemJob(id, patch) {
            const job = jobs.get(id) || { id };
            Object.assign(job, patch);
            jobs.set(id, job);
            calls.push(["update", id, patch]);
            return { ...job };
        }
    };
}

test("bot task runtime persists and claims a job before executing it", async () => {
    const client = fakeClient();
    let executed = false;
    const runtime = createBotTaskRuntime({
        client,
        sendMessage: async () => {},
        escapeHtml: String,
        formatExportFailure: () => null,
        recordBotAudit: async () => {},
        concurrency: 1,
        workerId: "test-worker"
    });
    const accepted = await runtime.botTaskQueue.enqueue({
        name: "share:1:2",
        label: "共享上传",
        chatId: "1",
        systemJobType: "bot_share_upload",
        systemJobInput: { telegram_id: "1", book_id: "2" },
        idempotencyKey: "bot:share:1:2",
        task: async () => {
            executed = true;
            return { uploaded: 1 };
        }
    });
    assert.equal(accepted, true);
    await waitFor(() => executed && runtime.botTaskQueue.stats().running === 0);
    assert.equal(client.calls[0][0], "create");
    assert.equal(client.calls[0][1].idempotency_key, "bot:share:1:2");
    assert.equal(
        client.calls.some((call) => call[0] === "claim"),
        true
    );
    const succeeded = client.calls.find((call) => call[0] === "update" && call[2].status === "succeeded");
    assert.equal(succeeded[2].worker_id, "test-worker");
    assert.equal(succeeded[2].attempt, 1);
    assert.equal(
        client.calls.some((call) => call[0] === "update" && call[2].status === "queued"),
        false
    );
});

test("bot task runtime rebuilds jobs claimed during startup recovery", async () => {
    const client = fakeClient();
    client.claimSystemJobs = async (payload) => {
        client.calls.push(["claim-many", payload]);
        client.jobs.set(91, { id: 91, status: "running", attempt: 2, max_attempts: 4 });
        return [{ id: 91, type: "bot_export_txt", input_json: { telegram_id: "7", chat_id: "8", book_id: "9", format: "txt" } }];
    };
    let recovered = false;
    const runtime = createBotTaskRuntime({
        client,
        sendMessage: async () => {},
        escapeHtml: String,
        formatExportFailure: () => null,
        recordBotAudit: async () => {},
        concurrency: 1,
        workerId: "recovery-worker"
    });
    const count = await runtime.recoverPersistentJobs(["bot_export_txt"], (row) => ({
        name: `recovered:${row.id}`,
        label: "恢复导出",
        chatId: "8",
        systemJobType: row.type,
        systemJobInput: row.input_json,
        task: async () => {
            recovered = true;
        }
    }));
    assert.equal(count, 1);
    await waitFor(() => recovered && runtime.botTaskQueue.stats().running === 0);
    assert.equal(client.calls[0][0], "claim-many");
    assert.equal(
        client.calls.some((call) => call[0] === "create"),
        false
    );
});

test("bot task runtime includes export duration in the terminal failure notice", async () => {
    const client = fakeClient();
    const messages = [];
    const audits = [];
    const runtime = createBotTaskRuntime({
        client,
        sendMessage: async (_chatId, text) => messages.push(text),
        escapeHtml: String,
        formatExportFailure: () => ({ code: "EXPORT_TEST", message: "导出失败", raw: "zip failed", text: "导出失败" }),
        recordBotAudit: async (payload) => audits.push(payload),
        concurrency: 1,
        workerId: "failure-worker"
    });
    await runtime.botTaskQueue.enqueue({
        name: "export:epub:1:9",
        label: "EPUB 导出",
        chatId: "1",
        bookId: "9",
        format: "epub",
        systemJobType: "bot_export_epub",
        systemJobInput: { telegram_id: "1", chat_id: "1", book_id: "9", format: "epub" },
        maxAttempts: 1,
        task: async () => {
            throw Object.assign(new Error("zip failed"), {
                retryable: false,
                exportDurationMs: 62_000,
                exportDurationText: "1 分 2 秒"
            });
        }
    });
    await waitFor(() => runtime.botTaskQueue.stats().running === 0 && audits.length === 1);
    assert.ok(messages.some((text) => /导出失败\n耗时：1 分 2 秒/.test(text)));
    assert.equal(audits[0].duration_ms, 62_000);
});
