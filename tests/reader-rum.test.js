/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供Reader 性能事件采样和写入的自动化回归断言
 * [POS]: tests 的Reader 性能事件采样和写入守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { cleanEvent, createReaderRumService } = require("../services/reader-rum");

test("reader RUM sanitizer accepts known metrics and rejects unsafe samples", () => {
    assert.deepEqual(cleanEvent({ metric: "LCP", value: 1234.5, route: "Book", metadata: { source: "navigation" } }), {
        sessionId: "",
        route: "Book",
        metric: "lcp",
        value: 1234.5,
        rating: "",
        navigationType: "",
        metadata: { source: "navigation" }
    });
    assert.equal(cleanEvent({ metric: "chapter_text", value: 10 }), null);
    assert.equal(cleanEvent({ metric: "lcp", value: -1 }), null);
});

test("reader RUM service batches inserts and builds percentile summaries", async () => {
    const calls = [];
    const service = createReaderRumService({
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (/GROUP BY metric/.test(sql)) return { rows: [{ metric: "lcp", samples: 2, p50: 1000, p95: 1500 }] };
            if (/metric='route'/.test(sql)) return { rows: [{ route: "Book", samples: 2, p95: 300 }] };
            if (/COUNT\(DISTINCT session_id\)/.test(sql)) return { rows: [{ samples: 4, sessions: 2, users: 1 }] };
            return { rows: [] };
        }
    });
    const recorded = await service.recordEvents(7, [
        { metric: "lcp", value: 1200, session_id: "s1", route: "Book", rating: "good" },
        { metric: "unknown", value: 1 }
    ]);
    assert.equal(recorded.accepted, 1);
    assert.match(calls[0].sql, /INSERT INTO reader_performance_events/);
    assert.equal(calls[0].params[0], 7);

    const summary = await service.summary({ days: 14 });
    assert.equal(summary.days, 14);
    assert.equal(summary.metrics[0].metric, "lcp");
    assert.equal(summary.routes[0].route, "Book");
    assert.equal(summary.sessions, 2);
});
