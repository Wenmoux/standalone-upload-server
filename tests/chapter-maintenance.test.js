/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供章节顺序、同名分卷去重及合并章节结构整理的自动化回归断言
 * [POS]: tests 的章节维护领域操作守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createChapterMaintenanceService } = require("../services/chapter-maintenance");

test("chapter maintenance previews and repairs duplicate chapter order groups", async () => {
    const updates = [];
    const client = {
        query: async (sql, params = []) => {
            if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
            if (/WITH ranked_duplicates AS/.test(sql)) {
                updates.push({ sql, params });
                return { rows: [{ book_id: "b1", updated_chapters: 1 }] };
            }
            if (/chapter_order = -chapter_order/.test(sql)) {
                updates.push({ sql, params });
                return { rows: [], rowCount: 1 };
            }
            return { rows: [] };
        },
        release: () => {}
    };
    const service = createChapterMaintenanceService({
        query: async () => ({
            rows: [{ book_id: "b1", platform: "po18", duplicate_order_groups: 1, affected_chapters: 2, title: "Book" }]
        }),
        pool: { connect: async () => client },
        chapterListOrderSql: () => "id ASC"
    });

    const preview = await service.previewChapterOrderRepairs({ limit: 5 });
    assert.equal(preview.rows[0].book_id, "b1");

    const repaired = await service.repairChapterOrderDuplicates({ limit: 5 });
    assert.equal(repaired.repairedBooks, 1);
    assert.equal(repaired.updatedChapters, 1);
    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map((call) => call.params), [[['b1']], [['b1']]]);
    assert.match(updates[0].sql, /PARTITION BY book_id, chapter_order/);
    assert.match(updates[0].sql, /duplicate_rank > 1/);
    assert.match(updates[0].sql, /MAX\(chapter_order\)/);
});

test("chapter maintenance previews duplicate volume names and reports changed books", async () => {
    const previewSql = [];
    const clientCalls = [];
    const client = {
        async query(sql, params = []) {
            clientCalls.push({ sql, params });
            if (/DELETE FROM chapter_cache/.test(sql)) {
                return { rowCount: 2, rows: [{ book_id: "b1", title: "正文卷" }, { book_id: "b1", title: " 正文卷 " }] };
            }
            if (/WITH ranked_duplicates AS/.test(sql)) {
                return { rows: [] };
            }
            if (/chapter_order = -chapter_order/.test(sql)) {
                return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        },
        release() {}
    };
    const service = createChapterMaintenanceService({
        query: async (sql) => {
            previewSql.push(sql);
            return {
                rows: [
                    {
                        book_id: "b1",
                        title: "Book",
                        platform: "po18",
                        duplicate_volumes: 2,
                        duplicate_titles: ["正文卷"]
                    }
                ]
            };
        },
        pool: { connect: async () => client }
    });

    const preview = await service.previewDuplicateVolumeCleanup({ limit: 5 });
    assert.equal(preview.rows[0].duplicate_volumes, 2);
    assert.match(previewSql[0], /PARTITION BY book_id, BTRIM\(title\)/);
    assert.match(previewSql[0], /COALESCE\(is_volume, FALSE\) = TRUE/);

    const result = await service.cleanupDuplicateVolumes({ limit: 5 });
    assert.equal(result.changedBookCount, 1);
    assert.equal(result.removedVolumes, 2);
    assert.deepEqual(result.changedBooks[0].removed_titles, ["正文卷"]);
    assert.equal(result.changedBooks[0].updated_chapters, 0);
    const deletion = clientCalls.find((call) => /DELETE FROM chapter_cache/.test(call.sql));
    assert.ok(deletion);
    assert.match(deletion.sql, /PARTITION BY book_id, BTRIM\(title\)/);
    assert.match(deletion.sql, /duplicate_rank > 1/);
    assert.equal(clientCalls.filter((call) => /WITH ranked_duplicates AS/.test(call.sql)).length, 1);
    assert.equal(clientCalls.filter((call) => /chapter_order = -chapter_order/.test(call.sql)).length, 1);
});

test("chapter structure preview merges order and duplicate volume findings", async () => {
    const service = createChapterMaintenanceService({
        query: async (sql) => {
            if (/WITH duplicate_groups/.test(sql)) {
                return { rows: [{ book_id: "b1", affected_chapters: 2, title: "Book" }] };
            }
            return {
                rows: [{ book_id: "b1", duplicate_volumes: 1, duplicate_titles: ["正文卷"], title: "Book" }]
            };
        },
        pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }
    });

    const preview = await service.previewChapterStructureRepairs({ limit: 5 });
    assert.equal(preview.affectedBooks, 1);
    assert.equal(preview.affectedChapters, 2);
    assert.equal(preview.duplicateVolumes, 1);
    assert.equal(preview.orderRows[0].book_id, "b1");
    assert.equal(preview.duplicateVolumeRows[0].duplicate_titles[0], "正文卷");
});

test("chapter structure repair processes every previewed book with set-based updates", async () => {
    const previewCalls = [];
    const clientCalls = [];
    const client = {
        async query(sql, params = []) {
            clientCalls.push({ sql, params });
            if (/DELETE FROM chapter_cache/.test(sql)) {
                return { rowCount: 1, rows: [{ book_id: "b1", title: "正文卷" }] };
            }
            if (/WITH ranked_duplicates AS/.test(sql)) {
                return {
                    rows: [{ book_id: "b2", updated_chapters: 1 }]
                };
            }
            return { rows: [], rowCount: 0 };
        },
        release() {}
    };
    const service = createChapterMaintenanceService({
        query: async (sql, params) => {
            previewCalls.push({ sql, params });
            if (/WITH duplicate_groups/.test(sql)) {
                return { rows: [{ book_id: "b2", title: "Order Book", affected_chapters: 2 }] };
            }
            return {
                rows: [
                    { book_id: "b1", title: "Volume Book", duplicate_volumes: 1, duplicate_titles: ["正文卷"] }
                ]
            };
        },
        pool: { connect: async () => client }
    });

    const result = await service.repairChapterStructure();
    assert.equal(result.scannedBooks, 2);
    assert.equal(result.changedBookCount, 2);
    assert.equal(result.removedVolumes, 1);
    assert.equal(result.updatedChapters, 1);
    assert.deepEqual(result.changedBooks.map((row) => row.book_id).sort(), ["b1", "b2"]);
    assert.ok(previewCalls.every((call) => call.params.length === 0));
    assert.equal(clientCalls.filter((call) => /WITH ranked_duplicates AS/.test(call.sql)).length, 1);
});
