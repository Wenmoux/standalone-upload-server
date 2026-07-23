/**
 * [INPUT]: 依赖 node:test、assert、Reader 章节配额服务及受控事务型 PostgreSQL 替身
 * [OUTPUT]: 提供每日限额、重复章节、批量原子拒绝和分卷豁免的回归断言
 * [POS]: tests 的 Reader 正文配额守卫，防止并发序列化和按日去重语义静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { createReaderChapterQuotaService, normalizedChapterRefs } = require("../services/reader-chapter-quota");

function quotaFixture({ limit = 2, existing = [] } = {}) {
    const committed = new Set(existing);
    let pending = new Set(committed);
    const calls = [];
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (sql === "BEGIN") {
                pending = new Set(committed);
                return { rows: [] };
            }
            if (sql === "COMMIT") {
                committed.clear();
                for (const key of pending) committed.add(key);
                return { rows: [] };
            }
            if (sql === "ROLLBACK") {
                pending = new Set(committed);
                return { rows: [] };
            }
            if (/FROM reader_users/.test(sql)) return { rows: [{ daily_chapter_limit: limit }] };
            if (/INSERT INTO reader_chapter_usage/.test(sql)) {
                const rows = [];
                for (let index = 0; index < params[2].length; index += 1) {
                    const key = `${params[2][index]}:${params[3][index]}`;
                    if (pending.has(key)) continue;
                    pending.add(key);
                    rows.push({ book_id: params[2][index], chapter_id: params[3][index] });
                }
                return { rows, rowCount: rows.length };
            }
            if (/COUNT\(\*\)::int used/.test(sql)) return { rows: [{ used: pending.size }] };
            throw new Error(`unexpected SQL: ${sql}`);
        },
        release() {}
    };
    return {
        calls,
        committed,
        service: createReaderChapterQuotaService({ pool: { connect: async () => client }, todayDateKey: () => "2026-07-23" })
    };
}

test("chapter refs deduplicate reads and exclude volume placeholders", () => {
    assert.deepEqual(
        normalizedChapterRefs([
            { book_id: "b1", chapter_id: "c1" },
            { bookId: "b1", chapterId: "c1" },
            { book_id: "b1", chapter_id: "v1", is_volume: true }
        ]),
        [{ bookId: "b1", chapterId: "c1" }]
    );
});

test("daily chapter quota counts a chapter once and allows duplicate requests at the limit", async () => {
    const fixture = quotaFixture({ limit: 1 });
    const input = { userId: 7, chapters: [{ book_id: "b1", chapter_id: "c1" }] };

    assert.deepEqual(await fixture.service.consumeReaderChapters(input), {
        allowed: true,
        limit: 1,
        used: 1,
        added: 1,
        remaining: 0,
        read_date: "2026-07-23"
    });
    assert.equal((await fixture.service.consumeReaderChapters(input)).allowed, true);
    assert.equal(fixture.committed.size, 1);
});

test("daily chapter quota rejects an over-limit batch atomically", async () => {
    const fixture = quotaFixture({ limit: 2, existing: ["b1:c1"] });
    const result = await fixture.service.consumeReaderChapters({
        userId: 7,
        chapters: [
            { book_id: "b1", chapter_id: "c2" },
            { book_id: "b1", chapter_id: "c3" }
        ]
    });

    assert.equal(result.allowed, false);
    assert.equal(result.status, 429);
    assert.equal(result.code, "DAILY_CHAPTER_LIMIT_EXCEEDED");
    assert.equal(result.used, 1);
    assert.equal(result.remaining, 1);
    assert.deepEqual([...fixture.committed], ["b1:c1"]);
    assert.equal(
        fixture.calls.some((call) => call.sql === "ROLLBACK"),
        true
    );
});

test("zero daily chapter limit records unique usage without blocking", async () => {
    const fixture = quotaFixture({ limit: 0 });
    const result = await fixture.service.consumeReaderChapters({
        userId: 7,
        chapters: [
            { book_id: "b1", chapter_id: "c1" },
            { book_id: "b1", chapter_id: "c2" }
        ]
    });
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 0);
    assert.equal(result.remaining, null);
    assert.equal(fixture.committed.size, 2);
});
