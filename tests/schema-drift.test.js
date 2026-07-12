const assert = require("assert/strict");
const test = require("node:test");
const { checkSchemaDrift, migrationSnapshot, unexpectedRuntimeDdl } = require("../scripts/check-schema-drift");

test("committed schema snapshot exactly matches the forward migration chain", () => {
    const result = checkSchemaDrift();
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.actual.latest, "022_review_governance");
    assert.equal(result.actual.migration_count, 20);
    assert.equal(result.actual.aggregate_sha256.length, 64);
});

test("runtime source contains no application schema DDL outside migrations", () => {
    assert.deepEqual(unexpectedRuntimeDdl(), []);
    assert.equal(migrationSnapshot().migrations.every((row) => row.sha256.length === 64), true);
});
