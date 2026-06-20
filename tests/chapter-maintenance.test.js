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
    assert.deepEqual(updates, [[2, 12]]);
});
