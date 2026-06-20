const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
    assertBackupType,
    expectedRestoreConfirm,
    normalizeBackupType,
    validateRestoreRequest
} = require("../services/backups");
const {
    providerConfig,
    remoteBackupStatus,
    s3ObjectUrl,
    uploadBackupToRemote
} = require("../services/remote-backups");

test("backup service normalizes and validates supported types", () => {
    assert.equal(normalizeBackupType(" PG "), "pg");
    assert.equal(assertBackupType("database"), "database");
    assert.equal(assertBackupType("diagnostics"), "diagnostics");
    assert.throws(
        () => assertBackupType("zip"),
        (err) => err.status === 400 && /unsupported backup type/.test(err.message)
    );
});

test("backup restore confirmation uses the basename only", () => {
    assert.equal(expectedRestoreConfirm("po18-pg-20260604.dump"), "RESTORE po18-pg-20260604.dump");

    const valid = validateRestoreRequest("po18-pg-20260604.dump", "RESTORE po18-pg-20260604.dump");
    assert.equal(valid.ok, true);

    const empty = validateRestoreRequest("", "");
    assert.equal(empty.ok, false);
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "backup file is required");

    const invalid = validateRestoreRequest("../po18-pg-20260604.dump", "RESTORE ../po18-pg-20260604.dump");
    assert.equal(invalid.ok, false);
    assert.equal(invalid.body.expectedConfirm, "RESTORE po18-pg-20260604.dump");
});

test("remote backup config reports readiness without exposing secrets", () => {
    const config = providerConfig({
        PO18_REMOTE_BACKUP_PROVIDER: "r2",
        PO18_REMOTE_BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com/",
        PO18_REMOTE_BACKUP_S3_BUCKET: "reader",
        PO18_REMOTE_BACKUP_S3_REGION: "auto",
        PO18_REMOTE_BACKUP_S3_ACCESS_KEY: "access-key",
        PO18_REMOTE_BACKUP_S3_SECRET_KEY: "secret-key",
        PO18_REMOTE_BACKUP_S3_PREFIX: "/daily/backups/"
    });
    const status = remoteBackupStatus(config);

    assert.equal(config.provider, "r2");
    assert.equal(config.s3Prefix, "daily/backups");
    assert.equal(status.configured, true);
    assert.equal(status.provider, "r2");
    assert.equal(status.s3.configured, true);
    assert.equal(status.s3.bucket, "reader");
    assert.equal(status.s3.secretKey, undefined);
    assert.equal(status.webdav.password, undefined);
    assert.equal(
        s3ObjectUrl(config, "daily/backups/po18 pg.dump"),
        "https://example.r2.cloudflarestorage.com/reader/daily/backups/po18%20pg.dump"
    );
});

test("remote backup upload fails clearly when not configured", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-remote-backup-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, "po18-pg-test.dump"), "dump");

    await assert.rejects(
        () => uploadBackupToRemote("po18-pg-test.dump", { backupDir: dir, config: providerConfig({}) }),
        /remote backup is not configured/
    );
});
