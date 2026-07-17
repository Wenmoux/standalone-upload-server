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
            if (/SELECT id, book_id, chapter_id/.test(sql)) {
                return {
                    rows: [
                        { id: 11, chapter_order: 1 },
                        { id: 12, chapter_order: 1 },
                        { id: 13, chapter_order: 3 }
                    ]
                };
            }
            if (/UPDATE chapter_cache SET chapter_order/.test(sql)) {
                updates.push(params);
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
    assert.deepEqual(updates, [
        [-2, 12],
        [2, 12]
    ]);
});

test("chapter maintenance previews duplicate volume names and reports changed books", async () => {
    const previewSql = [];
    const clientCalls = [];
    const client = {
        async query(sql, params = []) {
            clientCalls.push({ sql, params });
            if (/DELETE FROM chapter_cache/.test(sql)) {
                return { rowCount: 2, rows: [{ title: "正文卷" }, { title: " 正文卷 " }] };
            }
            if (/SELECT id, book_id, chapter_id/.test(sql)) {
                return { rows: [{ id: 11, chapter_order: 1 }, { id: 13, chapter_order: 4 }] };
            }
            if (/UPDATE chapter_cache SET chapter_order/.test(sql)) {
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
    assert.equal(result.changedBooks[0].updated_chapters, 1);
    const deletion = clientCalls.find((call) => /DELETE FROM chapter_cache/.test(call.sql));
    assert.ok(deletion);
    assert.match(deletion.sql, /PARTITION BY BTRIM\(title\)/);
    assert.match(deletion.sql, /duplicate_rank > 1/);
    const orderUpdates = clientCalls.filter((call) => /UPDATE chapter_cache SET chapter_order/.test(call.sql));
    assert.deepEqual(
        orderUpdates.map((call) => call.params),
        [
            [-2, 13],
            [2, 13]
        ]
    );
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
