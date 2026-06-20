const assert = require("assert/strict");
const test = require("node:test");
const { listMigrationFiles, listRollbackFiles } = require("../pg-store");

test("migration files use sortable versioned names", async () => {
    const files = await listMigrationFiles();
    assert.ok(files.length > 0, "expected at least one migration file");

    const versions = files.map((file) => file.version);
    const sorted = [...versions].sort((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(versions, sorted);

    for (const file of files) {
        assert.match(file.file, /^\d{3}_[a-z0-9_]+\.sql$/);
        assert.ok(file.name);
    }
});

test("rollback files match migration versions and use sortable names", async () => {
    const migrations = await listMigrationFiles();
    const rollbacks = await listRollbackFiles();
    assert.ok(rollbacks.length > 0, "expected at least one rollback file");

    const migrationVersions = new Set(migrations.map((file) => file.version));
    const rollbackVersions = rollbacks.map((file) => file.version);
    const sorted = [...rollbackVersions].sort((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(rollbackVersions, sorted);

    for (const file of rollbacks) {
        assert.match(file.file, /^\d{3}_[a-z0-9_]+\.down\.sql$/);
        assert.ok(migrationVersions.has(file.version), `missing forward migration for ${file.version}`);
    }
});
