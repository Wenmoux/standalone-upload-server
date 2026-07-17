/**
 * [INPUT]: 依赖 node:test、assert、相关生产模块及受控替身/夹具
 * [OUTPUT]: 提供schema snapshot 与迁移目录一致性的自动化回归断言
 * [POS]: tests 的schema snapshot 与迁移目录一致性守卫，防止实现或部署契约在后续变更中静默退化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require("assert/strict");
const test = require("node:test");
const { checkSchemaDrift, migrationSnapshot, unexpectedRuntimeDdl } = require("../scripts/check-schema-drift");

test("committed schema snapshot exactly matches the forward migration chain", () => {
    const result = checkSchemaDrift();
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.actual.latest, "024_chapter_order_uniqueness");
    assert.equal(result.actual.migration_count, 23);
    assert.equal(result.actual.aggregate_sha256.length, 64);
});

test("runtime source contains no application schema DDL outside migrations", () => {
    assert.deepEqual(unexpectedRuntimeDdl(), []);
    assert.equal(migrationSnapshot().migrations.every((row) => row.sha256.length === 64), true);
});
