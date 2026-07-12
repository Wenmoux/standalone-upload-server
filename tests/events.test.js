/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供领域事件发布和监听隔离的自动化回归断言
 * [POS]: tests 的领域事件发布和监听隔离守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createEventService } = require("../services/events");

test("event service records upload event with cleaned details", async () => {
    const calls = [];
    const service = createEventService({
        cleanPgText: (value) => typeof value === "string" ? value.replace(/\u0000/g, "") : value,
        cleanPgValue: (value) => JSON.parse(JSON.stringify(value).replace(/\\u0000/g, "")),
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [{ id: 1, event_type: params[0], details: params[9] }] };
        }
    });

    const row = await service.recordEvent({
        eventType: "chapter",
        action: "save",
        bookId: "b\u00001",
        chapterId: "c1",
        title: "Title",
        details: { source: "bot\u0000" }
    });

    assert.equal(row.id, 1);
    assert.match(calls[0].sql, /INSERT INTO upload_events/);
    assert.equal(calls[0].params[2], "b1");
    assert.equal(calls[0].params[9], '{"source":"bot"}');
});
