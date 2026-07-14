/**
 * [INPUT]: 依赖 node:test、assert 与 book-maintenance 可注入 query/Pool/事件服务工厂
 * [OUTPUT]: 提供陈旧 PO18 预览、事务锁定、平台隔离删除、审计事件及回滚释放回归
 * [POS]: tests 的破坏性书库维护守卫，确保清理只能作用于事务中重新锁定的目标集合
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createBookMaintenanceService } = require("../services/book-maintenance");

test("book maintenance preview returns stable PO18 scope and samples", async () => {
    const calls = [];
    const service = createBookMaintenanceService({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/metadata_count/.test(sql)) return { rows: [{ metadata_count: 2, book_count: 2, chapter_count: 7 }] };
            return { rows: [{ id: 1, book_id: "100", title: "旧书" }] };
        }
    });
    const preview = await service.stalePo18BooksPreview();
    assert.deepEqual(
        {
            platform: preview.platform,
            cutoff: preview.cutoff,
            maxChapterCount: preview.maxChapterCount,
            metadataCount: preview.metadataCount,
            bookCount: preview.bookCount,
            chapterCount: preview.chapterCount
        },
        {
            platform: "po18",
            cutoff: "2025-01-01",
            maxChapterCount: 10,
            metadataCount: 2,
            bookCount: 2,
            chapterCount: 7
        }
    );
    assert.equal(preview.sample[0].book_id, "100");
    assert.deepEqual(calls[0].params, ["po18", "2025-01-01", 10]);
});

test("book maintenance cleanup locks targets, isolates platform and records committed facts", async () => {
    const calls = [];
    const events = [];
    let released = false;
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/SELECT id, book_id/.test(sql)) {
                return {
                    rows: [
                        { id: 1, book_id: "100", title: "A" },
                        { id: 2, book_id: "100", title: "A2" },
                        { id: 3, book_id: "200", title: "B" }
                    ]
                };
            }
            if (/DELETE FROM chapter_cache/.test(sql)) return { rowCount: 5 };
            if (/DELETE FROM book_metadata/.test(sql)) return { rowCount: 3 };
            return { rows: [] };
        },
        release() {
            released = true;
        }
    };
    const service = createBookMaintenanceService({
        pool: { connect: async () => client },
        recordEvent: async (event) => events.push(event)
    });
    const result = await service.cleanupStalePo18Books({ actor: "owner" });
    assert.equal(result.deletedChapters, 5);
    assert.equal(result.deletedMetadata, 3);
    assert.equal(result.bookCount, 2);
    assert.match(calls[1].sql, /FOR UPDATE/);
    assert.deepEqual(calls[2].params, [["100", "200"], "po18"]);
    assert.deepEqual(
        calls.map((item) => item.sql).filter((sql) => /^(BEGIN|COMMIT)$/.test(sql)),
        ["BEGIN", "COMMIT"]
    );
    assert.equal(released, true);
    assert.equal(events[0].uploader, "owner");
    assert.equal(events[0].details.deletedMetadata, 3);
});

test("book maintenance cleanup rolls back and releases on target failure", async () => {
    const calls = [];
    const client = {
        async query(sql) {
            calls.push(sql);
            if (/SELECT id, book_id/.test(sql)) throw new Error("target failed");
            return { rows: [] };
        },
        release() {
            calls.push("RELEASE");
        }
    };
    const service = createBookMaintenanceService({ pool: { connect: async () => client } });
    await assert.rejects(() => service.cleanupStalePo18Books(), /target failed/);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "RELEASE"]);
});
