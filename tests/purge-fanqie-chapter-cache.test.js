/**
 * [INPUT]: 依赖 node:test、assert、番茄正文缓存清理 CLI 及受控 PostgreSQL client 替身
 * [OUTPUT]: 提供确认词、删除边界、事务提交/回滚、结果数组与 Docker 收录契约的回归断言
 * [POS]: tests 的破坏性缓存维护守卫，证明脚本只清章节缓存且发布镜像具备同一运维入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const {
    CONFIRM_PHRASE,
    FANQIE_ALIASES,
    PURGE_SQL,
    assertConfirmed,
    parseArgs,
    purgeFanqieChapterCache
} = require("../scripts/purge-fanqie-chapter-cache");

function createPool({ deleteResult, deleteError } = {}) {
    const calls = [];
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql === PURGE_SQL) {
                if (deleteError) throw deleteError;
                return deleteResult || { rows: [{ deleted_chapters: 0, book_ids: [] }] };
            }
            return { rows: [] };
        },
        release() {
            calls.push({ sql: "RELEASE" });
        }
    };
    return {
        calls,
        pool: {
            async connect() {
                return client;
            }
        }
    };
}

test("fanqie cache purge requires its exact destructive confirmation phrase", () => {
    assert.equal(parseArgs(["--confirm", CONFIRM_PHRASE]).confirm, CONFIRM_PHRASE);
    assert.throws(() => assertConfirmed(""), /refusing to purge/);
    assert.doesNotThrow(() => assertConfirmed(CONFIRM_PHRASE));
});

test("fanqie cache purge SQL deletes only chapter cache with safe legacy attribution", () => {
    assert.match(PURGE_SQL, /DELETE FROM chapter_cache/);
    assert.doesNotMatch(PURGE_SQL, /(?:DELETE|UPDATE)\s+(?:FROM\s+)?book_metadata/i);
    assert.match(PURGE_SQL, /NOT EXISTS/);
    assert.deepEqual(FANQIE_ALIASES, ["fanqie", "fq", "tomato"]);
});

test("fanqie cache purge commits once and returns unique sorted book ids", async () => {
    const fixture = createPool({ deleteResult: { rows: [{ deleted_chapters: 7, book_ids: ["9", "2", "9"] }] } });
    const result = await purgeFanqieChapterCache(fixture.pool);

    assert.deepEqual(result, { success: true, deletedChapters: 7, bookIds: ["2", "9"] });
    assert.deepEqual(
        fixture.calls.map((call) => call.sql),
        [
            "BEGIN",
            "SET LOCAL statement_timeout = 0",
            "SET LOCAL lock_timeout = '30s'",
            "LOCK TABLE chapter_cache IN SHARE ROW EXCLUSIVE MODE",
            PURGE_SQL,
            "COMMIT",
            "RELEASE"
        ]
    );
    assert.deepEqual(fixture.calls[4].params, [FANQIE_ALIASES]);
});

test("fanqie cache purge rolls back and releases its client when deletion fails", async () => {
    const fixture = createPool({ deleteError: new Error("delete failed") });
    await assert.rejects(() => purgeFanqieChapterCache(fixture.pool), /delete failed/);
    assert.deepEqual(
        fixture.calls.slice(-2).map((call) => call.sql),
        ["ROLLBACK", "RELEASE"]
    );
});

test("Docker runtime stages include the fanqie cache purge command", () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
    assert.equal((dockerfile.match(/scripts\/purge-fanqie-chapter-cache\.js/g) || []).length, 2);
});
