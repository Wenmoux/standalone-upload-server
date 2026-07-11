const assert = require("assert/strict");
const crypto = require("crypto");
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
const { decryptBackupFile, encryptedBackupFile } = require("../services/backup-crypto");
const { databaseBackupMetadata, fileSha256, verifyBackupChecksum } = require("../docker/backup-pg");

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

test("backup checksum detects truncated or changed files", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-backup-checksum-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, "po18-pg-check.dump");
    await fs.writeFile(file, "original-backup");
    const digest = await fileSha256(file);
    assert.equal(await verifyBackupChecksum(file, digest), digest);
    await fs.appendFile(file, "-changed");
    await assert.rejects(() => verifyBackupChecksum(file, digest), /checksum mismatch/);
});

test("database backup metadata records postgres and schema versions", async () => {
    const calls = [];
    const meta = await databaseBackupMetadata("postgres://user:secret@db.example.com:5432/po18", {
        runProcess: async (command, args, options) => {
            calls.push({ command, args, options });
            return { stdout: "16.4\t018_data_quality_guards\n" };
        }
    });
    assert.deepEqual(meta, { postgres_version: "16.4", schema_version: "018_data_quality_guards" });
    assert.equal(calls[0].command, "psql");
    assert.equal(calls[0].options.env.PGPASSWORD, "secret");
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

test("WebDAV remote backup streams the file and sends its checksum", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-webdav-stream-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const content = Buffer.from("streaming-backup-content");
    await fs.writeFile(path.join(dir, "po18-pg-stream.dump"), content);
    let request;
    const result = await uploadBackupToRemote("po18-pg-stream.dump", {
        backupDir: dir,
        config: providerConfig({
            PO18_REMOTE_BACKUP_PROVIDER: "webdav",
            PO18_REMOTE_BACKUP_WEBDAV_URL: "https://backup.example.com/dav/",
            PO18_REMOTE_BACKUP_WEBDAV_USERNAME: "reader",
            PO18_REMOTE_BACKUP_WEBDAV_PASSWORD: "secret"
        }),
        fetchImpl: async (url, options = {}) => {
            if (options.method === undefined) return { ok: false, status: 404 };
            if (String(url).endsWith(".po18-backups.json")) return { ok: true, status: 201 };
            assert.equal(Buffer.isBuffer(options.body), false);
            const chunks = [];
            for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
            request = { url: String(url), options, body: Buffer.concat(chunks) };
            return { ok: true, status: 201 };
        }
    });

    assert.deepEqual(result, {
        provider: "webdav",
        url: "https://backup.example.com/dav/po18-pg-stream.dump",
        bytes: content.length,
        retention: { keep: 8, removed: [] }
    });
    assert.deepEqual(request.body, content);
    assert.equal(request.options.duplex, "half");
    assert.equal(request.options.headers["Content-Length"], String(content.length));
    assert.equal(request.options.headers["X-PO18-Backup-SHA256"], crypto.createHash("sha256").update(content).digest("hex"));
});

test("S3 remote backup signs a streamed payload checksum", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-s3-stream-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const content = Buffer.from("s3-streaming-backup");
    await fs.writeFile(path.join(dir, "po18-pg-s3.dump"), content);
    let request;
    const result = await uploadBackupToRemote("po18-pg-s3.dump", {
        backupDir: dir,
        config: providerConfig({
            PO18_REMOTE_BACKUP_PROVIDER: "s3",
            PO18_REMOTE_BACKUP_S3_ENDPOINT: "https://s3.example.com",
            PO18_REMOTE_BACKUP_S3_BUCKET: "reader",
            PO18_REMOTE_BACKUP_S3_REGION: "auto",
            PO18_REMOTE_BACKUP_S3_ACCESS_KEY: "access",
            PO18_REMOTE_BACKUP_S3_SECRET_KEY: "secret"
        }),
        fetchImpl: async (url, options = {}) => {
            if (options.method === undefined) return { ok: false, status: 404 };
            if (String(url).endsWith(".po18-backups.json")) return { ok: true, status: 200 };
            const chunks = [];
            for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
            request = { url: String(url), options, body: Buffer.concat(chunks) };
            return { ok: true, status: 200 };
        }
    });

    assert.equal(result.provider, "s3");
    assert.equal(result.bytes, content.length);
    assert.deepEqual(request.body, content);
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(request.options.headers["x-amz-content-sha256"], digest);
    assert.equal(request.options.headers["x-amz-meta-sha256"], digest);
    assert.match(request.options.headers.Authorization, /x-amz-content-sha256;x-amz-date;x-amz-meta-sha256/);
});

test("backup encryption round-trips and detects the encrypted format", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-backup-crypto-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const source = path.join(dir, "po18-pg-secret.dump");
    const content = Buffer.from("private postgres backup\nwith credentials");
    await fs.writeFile(source, content);
    const encrypted = await encryptedBackupFile(source, { passphrase: "test-backup-key", outputDir: dir });
    assert.notDeepEqual(await fs.readFile(encrypted.file), content);
    assert.deepEqual(await decryptBackupFile(encrypted.file, { passphrase: "test-backup-key" }), content);
    await assert.rejects(() => decryptBackupFile(encrypted.file, { passphrase: "wrong-key" }));
});

test("remote backup encryption uploads ciphertext with an enc suffix", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po18-webdav-encrypted-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const content = Buffer.from("plain-backup-body");
    await fs.writeFile(path.join(dir, "po18-pg-private.dump"), content);
    let uploaded = Buffer.alloc(0);
    const result = await uploadBackupToRemote("po18-pg-private.dump", {
        backupDir: dir,
        config: providerConfig({
            PO18_REMOTE_BACKUP_PROVIDER: "webdav",
            PO18_REMOTE_BACKUP_WEBDAV_URL: "https://backup.example.com/dav/",
            PO18_REMOTE_BACKUP_WEBDAV_USERNAME: "reader",
            PO18_REMOTE_BACKUP_WEBDAV_PASSWORD: "secret",
            PO18_BACKUP_ENCRYPTION_KEY: "remote-encryption-key"
        }),
        fetchImpl: async (url, options = {}) => {
            if (options.method === undefined) return { ok: false, status: 404 };
            if (String(url).endsWith(".po18-backups.json")) return { ok: true, status: 201 };
            const chunks = [];
            for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
            uploaded = Buffer.concat(chunks);
            assert.match(String(url), /po18-pg-private\.dump\.enc$/);
            return { ok: true, status: 201 };
        }
    });
    assert.equal(result.encrypted, true);
    assert.equal(result.encryption, "aes-256-gcm");
    assert.equal(result.remote_file, "po18-pg-private.dump.enc");
    assert.equal(uploaded.includes(content), false);
});

test("remote retention removes entries beyond the configured keep count", async () => {
    const removed = [];
    let savedIndex = null;
    const previous = Array.from({ length: 8 }, (_, index) => ({
        file: `old-${index}.dump`,
        created_at: new Date(Date.now() - (index + 1) * 1000).toISOString(),
        bytes: index + 1
    }));
    const result = await require("../services/remote-backups").applyRemoteRetention(
        providerConfig({
            PO18_REMOTE_BACKUP_PROVIDER: "webdav",
            PO18_REMOTE_BACKUP_WEBDAV_URL: "https://backup.example.com/dav/",
            PO18_REMOTE_BACKUP_WEBDAV_USERNAME: "reader",
            PO18_REMOTE_BACKUP_WEBDAV_PASSWORD: "secret",
            PO18_REMOTE_BACKUP_KEEP: "3"
        }),
        { file: "new.dump", bytes: 99, sha256: "abc", encrypted: false },
        async (url, options = {}) => {
            if (options.method === undefined) return { ok: true, status: 200, json: async () => ({ rows: previous }) };
            if (options.method === "DELETE") {
                removed.push(decodeURIComponent(String(url).split("/").pop()));
                return { ok: true, status: 204 };
            }
            if (options.method === "PUT") {
                savedIndex = JSON.parse(String(options.body));
                return { ok: true, status: 201 };
            }
            throw new Error(`unexpected ${options.method}`);
        }
    );
    assert.equal(result.keep, 3);
    assert.equal(result.removed.length, 6);
    assert.equal(savedIndex.rows.length, 3);
    assert.equal(savedIndex.rows[0].file, "new.dump");
    assert.deepEqual(removed.sort(), result.removed.slice().sort());
});
