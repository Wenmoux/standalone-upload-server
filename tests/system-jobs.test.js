/**
 * [INPUT]: 依赖 node:test、assert、system-jobs 可注入服务工厂及受控 PostgreSQL query/Pool 替身
 * [OUTPUT]: 提供任务参数收敛、幂等创建、原子取消、租约领取/回滚、心跳、列表、跟踪执行和指标回归
 * [POS]: tests 的持久任务状态机守卫，锁定 Bot/Admin/Crawler/Backup 共用的并发所有权与失败恢复语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { boundedInteger, compactJobResult, createSystemJobService } = require("../services/system-jobs");

test("system job helpers bound invalid numbers and compact domain results", () => {
    assert.equal(boundedInteger("bad", 7, 1, 10), 7);
    assert.equal(boundedInteger(99.9, 7, 1, 10), 10);
    assert.equal(boundedInteger(-2, 7, 1, 10), 1);
    assert.deepEqual(compactJobResult({ jobResult: { success: true, id: 9 } }), { success: true, id: 9 });
    assert.deepEqual(compactJobResult({ backup: { file: "db.sql", bytes: 12, type: "postgres" }, backups: [{}, {}] }), {
        success: true,
        file: "db.sql",
        type: "postgres",
        bytes: 12,
        restarting: false,
        pre_restore_backup: "",
        deleted_metadata: undefined,
        deleted_chapters: undefined,
        updated_chapters: undefined,
        repaired_books: undefined,
        backup_count: 2
    });
});

test("system jobs create safely, recover idempotent duplicates and build bounded updates", async () => {
    const calls = [];
    const service = createSystemJobService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/^INSERT INTO system_jobs/.test(sql)) return { rows: [{ id: 4, status: "queued" }] };
            return { rows: [{ id: params.at(-1), status: "running", progress: 25 }] };
        }
    });
    const created = await service.createSystemJob({
        type: "x".repeat(130),
        input: { a: 1 },
        priority: "invalid",
        maxAttempts: Infinity,
        idempotencyKey: ` key-${"z".repeat(260)} `
    });
    assert.equal(created.id, 4);
    assert.deepEqual(calls[0].params.slice(3, 5), [0, 3]);
    assert.equal(calls[0].params[0].length, 120);
    assert.equal(calls[0].params[5].length, 240);
    assert.equal(await service.updateSystemJob(null, { status: "running" }), null);
    assert.equal(await service.updateSystemJob(4, {}), null);
    await service.updateSystemJob(4, { status: "running", progress: 25, result: { ok: true }, heartbeat: true, started: true });
    assert.match(calls.at(-1).sql, /result_json = \$3::jsonb/);
    assert.match(calls.at(-1).sql, /heartbeat_at = CURRENT_TIMESTAMP/);
    assert.deepEqual(calls.at(-1).params, ["running", 25, '{"ok":true}', 4]);
    await service.updateSystemJob(4, { status: "succeeded", progress: 100, workerId: "worker-a", attempt: 2 });
    assert.match(calls.at(-1).sql, /status='running' AND locked_by=\$4 AND attempt=\$5/);
    assert.deepEqual(calls.at(-1).params, ["succeeded", 100, 4, "worker-a", 2]);
    await assert.rejects(
        () => service.updateSystemJob(4, { status: "succeeded", workerId: "worker-a" }),
        (err) => err.status === 400
    );

    const duplicateError = Object.assign(new Error("duplicate"), { code: "23505" });
    const duplicateService = createSystemJobService({
        query: async (sql) => {
            if (/^INSERT/.test(sql)) throw duplicateError;
            return { rows: [{ id: 8, status: "running" }] };
        }
    });
    assert.deepEqual(await duplicateService.createSystemJob({ type: "export", idempotencyKey: "same" }), {
        id: 8,
        status: "running",
        duplicate: true
    });
    const noKeyService = createSystemJobService({
        query: async () => {
            throw duplicateError;
        }
    });
    await assert.rejects(() => noKeyService.createSystemJob({ type: "export" }), duplicateError);
});

test("system job cancellation is one atomic queued/running transition", async () => {
    const calls = [];
    const service = createSystemJobService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ id: 7, status: "canceled", error: params[1] }] };
        }
    });
    const canceled = await service.cancelSystemJob(7, { actor: "owner" });
    assert.equal(canceled.status, "canceled");
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /status=CASE WHEN status='queued' THEN 'canceled'/);
    assert.match(calls[0].sql, /WHERE id=\$1 AND status IN \('queued','running'\)/);
    assert.deepEqual(calls[0].params, [7, "canceled by owner", "cancel requested by owner"]);

    let terminalCall = 0;
    const terminal = createSystemJobService({
        query: async () => (++terminalCall === 1 ? { rows: [] } : { rows: [{ id: 7, status: "succeeded" }] })
    });
    await assert.rejects(
        () => terminal.cancelSystemJob(7),
        (err) => err.status === 409
    );
    const missing = createSystemJobService({ query: async () => ({ rows: [] }) });
    assert.equal(await missing.cancelSystemJob(404), null);
});

test("system job claims commit ownership and rollback failed transactions", async () => {
    const calls = [];
    let released = false;
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (/WITH candidates/.test(sql)) return { rows: [{ id: 11, locked_by: params[2] }] };
            return { rows: [] };
        },
        release() {
            released = true;
        }
    };
    const service = createSystemJobService({ pool: { connect: async () => client }, query: async () => ({ rows: [] }) });
    const claimed = await service.claimSystemJobs({ workerId: " worker-a ", types: ["export", ""], limit: "bad", leaseSeconds: -5 });
    assert.equal(claimed[0].id, 11);
    assert.deepEqual(
        calls.map((item) => item.sql),
        ["BEGIN", calls[1].sql, "COMMIT"]
    );
    assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(calls[1].params, [["export"], 1, "worker-a", 15]);
    assert.equal(released, true);

    const rollbackCalls = [];
    const failedClient = {
        async query(sql) {
            rollbackCalls.push(sql);
            if (/WITH candidates/.test(sql)) throw new Error("claim failed");
            return { rows: [] };
        },
        release() {
            rollbackCalls.push("RELEASE");
        }
    };
    const failed = createSystemJobService({ pool: { connect: async () => failedClient } });
    await assert.rejects(() => failed.claimSystemJobs({ workerId: "w" }), /claim failed/);
    assert.deepEqual(rollbackCalls.slice(-2), ["ROLLBACK", "RELEASE"]);
});

test("system job single claim, heartbeat and filtered list preserve ownership and bounds", async () => {
    const calls = [];
    const service = createSystemJobService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/SELECT COUNT/.test(sql)) return { rows: [{ count: 2 }] };
            if (/ORDER BY created_at DESC, id DESC/.test(sql)) return { rows: [{ id: 2 }] };
            return { rows: [{ id: params[0], status: "running" }] };
        }
    });
    await service.claimSystemJob(2, { workerId: "w", leaseSeconds: "bad" });
    assert.deepEqual(calls[0].params, [2, "w", 120]);
    assert.match(calls[0].sql, /attempt < max_attempts/);
    await service.heartbeatSystemJob(2, { workerId: "w", attempt: 2, progress: 120, leaseSeconds: 5 });
    assert.deepEqual(calls[1].params, [2, "w", 2, 15, 100]);
    assert.match(calls[1].sql, /locked_by=\$2 AND attempt=\$3/);
    assert.match(calls[1].sql, /lease_expires_at >= CURRENT_TIMESTAMP/);
    await assert.rejects(
        () => service.heartbeatSystemJob(2, { workerId: "w" }),
        (err) => err.status === 400
    );
    const listed = await service.listSystemJobs({ page: "bad", limit: Infinity, status: "queued", type: "export", createdBy: "owner" });
    assert.deepEqual({ total: listed.total, page: listed.page, limit: listed.limit }, { total: 2, page: 1, limit: 30 });
    assert.deepEqual(calls.at(-1).params, ["queued", "export", "owner", 30, 0]);
});

test("system job info, metrics and tracked execution expose stable semantics", async () => {
    let updateCall = 0;
    const service = createSystemJobService({
        query: async (sql, params) => {
            if (/to_regclass/.test(sql)) return { rows: [{ regclass: "system_jobs" }] };
            if (/GROUP BY status/.test(sql))
                return {
                    rows: [
                        { status: "queued", count: 2 },
                        { status: "failed", count: 1 }
                    ]
                };
            if (/ORDER BY created_at DESC/.test(sql)) return { rows: [{ id: 3 }] };
            if (/COUNT\(\*\) FILTER/.test(sql)) return { rows: [{ queued: 2, failure_rate: 0.25 }] };
            if (/^INSERT/.test(sql)) return { rows: [{ id: 5, status: "queued" }] };
            if (/^UPDATE/.test(sql)) {
                updateCall += 1;
                return { rows: [{ id: params.at(-1), status: updateCall === 1 ? "running" : "succeeded" }] };
            }
            return { rows: [] };
        }
    });
    const info = await service.collectSystemJobInfo();
    assert.deepEqual(
        { available: info.available, total: info.total, byStatus: info.byStatus },
        {
            available: true,
            total: 3,
            byStatus: { queued: 2, failed: 1 }
        }
    );
    assert.equal((await service.collectSystemJobMetrics()).failure_rate, 0.25);
    const payload = await service.runTrackedJob({ session: { adminUser: { username: "owner" } } }, "backup", {}, async (job) => ({
        success: true,
        jobId: job.id
    }));
    assert.equal(payload.job.id, 5);
    assert.equal(payload.jobId, 5);
    const unavailable = createSystemJobService({
        query: async () => {
            throw new Error("db down");
        }
    });
    assert.match((await unavailable.collectSystemJobInfo()).error, /db down/);
    assert.equal((await unavailable.collectSystemJobMetrics()).available, false);
});
