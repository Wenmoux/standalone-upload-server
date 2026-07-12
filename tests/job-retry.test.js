/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供持久任务重试分类、退避和耗尽行为的自动化回归断言
 * [POS]: tests 的持久任务重试分类、退避和耗尽行为守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createSystemJobRetryService } = require("../services/job-retry");

function createService(job, calls = []) {
    return createSystemJobRetryService({
        getSystemJob: async () => job,
        runTrackedJob: async (req, type, input, worker) => {
            calls.push({ type, input });
            return { ...(await worker()), job: { id: 99, type } };
        },
        rankService: {
            getPayload: async () => null,
            statusPayload: () => ({ ready: true, total: 3 })
        },
        createBackupPayload: async (input) => ({ success: true, backup: { type: input.type, file: "a.dump" } }),
        restoreBackupPayload: async () => ({ success: true, restore: { file: "a.dump" } }),
        bookMaintenanceService: {
            cleanupStalePo18Books: async () => ({ success: true, deletedMetadata: 1 })
        },
        chapterMaintenanceService: {
            repairChapterOrderDuplicates: async () => ({ success: true, updatedChapters: 2 })
        },
        configFile: "/config/app.env",
        backupDir: "/config/backups",
        collectDiagnostics: async () => ({}),
        collectCachedSystemStatus: async () => ({}),
        restartProcess: () => {},
        restartDelayMsProvider: () => 1
    });
}

test("system job retry reruns chapter order repair jobs", async () => {
    const calls = [];
    const service = createService({ id: 7, type: "chapters_repair_order", status: "failed", input_json: { limit: 3 } }, calls);
    const result = await service.retrySystemJob({ body: {}, session: { adminUser: { username: "admin" } } }, 7);
    assert.equal(result.updatedChapters, 2);
    assert.deepEqual(calls, [{ type: "chapters_repair_order", input: { limit: 3, retryOf: 7 } }]);
});

test("system job retry requires confirmation for stale cleanup", async () => {
    const service = createService({ id: 8, type: "books_cleanup_stale", status: "failed", input_json: {} });
    await assert.rejects(
        () => service.retrySystemJob({ body: {}, session: { adminUser: { username: "admin" } } }, 8),
        /confirmation phrase mismatch/
    );
    const result = await service.retrySystemJob({ body: { confirm: "RETRY 8" }, session: { adminUser: { username: "admin" } } }, 8);
    assert.equal(result.deletedMetadata, 1);
});
