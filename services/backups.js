/**
 * [INPUT]: 依赖 docker/backup-pg 的创建/校验/恢复原语、文件系统、远程上传适配器与 system-jobs 跟踪能力
 * [OUTPUT]: 对外提供备份创建、上传、校验、下载解析、恢复和恢复演练的载荷构建与任务入口
 * [POS]: services 的备份用例编排层，把底层命令封装成 Admin 可追踪的持久任务而不复制存储实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("fs/promises");
const path = require("path");
const {
    DEFAULT_BACKUP_DIR,
    createConfigBackup,
    createDiagnosticsBackup,
    createPostgresBackup,
    createUploadedPostgresBackup,
    drillPostgresBackup,
    listBackups,
    restorePostgresBackup,
    resolveBackupFile,
    verifyPostgresBackup
} = require("../docker/backup-pg");
const { runTrackedJob } = require("./system-jobs");

const SUPPORTED_BACKUP_TYPES = new Set(["config", "diagnostics", "postgres", "database", "pg"]);

function httpError(status, message, extra = {}) {
    const err = new Error(message);
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function normalizeBackupType(type = "postgres") {
    return String(type || "postgres").trim().toLowerCase();
}

function assertBackupType(type) {
    const normalized = normalizeBackupType(type);
    if (!SUPPORTED_BACKUP_TYPES.has(normalized)) throw httpError(400, "unsupported backup type");
    return normalized;
}

function expectedRestoreConfirm(fileName) {
    return `RESTORE ${path.basename(String(fileName || ""))}`;
}

function validateRestoreRequest(fileName, confirmation) {
    const safeName = String(fileName || "").trim();
    if (!safeName) {
        return { ok: false, status: 400, body: { error: "backup file is required" } };
    }
    const expectedConfirm = expectedRestoreConfirm(safeName);
    if (String(confirmation || "").trim() !== expectedConfirm) {
        return { ok: false, status: 400, body: { error: "confirmation phrase mismatch", expectedConfirm } };
    }
    return { ok: true, fileName: safeName, expectedConfirm };
}

async function backupListPayload({ backupDir = DEFAULT_BACKUP_DIR } = {}) {
    return { dir: backupDir, rows: await listBackups({ backupDir }) };
}

async function createBackupPayload({ type = "postgres", configFile, backupDir = DEFAULT_BACKUP_DIR, getDiagnostics } = {}) {
    const backupType = assertBackupType(type);
    let backup;
    if (backupType === "config") {
        backup = await createConfigBackup({ configFile, backupDir });
    } else if (backupType === "diagnostics") {
        if (typeof getDiagnostics !== "function") throw httpError(500, "diagnostics provider is not configured");
        backup = await createDiagnosticsBackup(await getDiagnostics(), { backupDir });
    } else {
        backup = await createPostgresBackup({ configFile, backupDir });
    }
    return { success: true, file: backup.file, backup, backups: await listBackups({ backupDir }) };
}

async function createBackupJob(req, { type = "postgres", configFile, backupDir = DEFAULT_BACKUP_DIR, getDiagnostics } = {}) {
    const backupType = assertBackupType(type);
    return runTrackedJob(req, `backup:${backupType}`, { type: backupType, backupDir }, async () => {
        return createBackupPayload({ type: backupType, configFile, backupDir, getDiagnostics });
    });
}

async function uploadBackupJob(req, { originalName = "upload.dump", backupDir = DEFAULT_BACKUP_DIR } = {}) {
    return runTrackedJob(req, "backup:upload", { originalName, backupDir }, async () => {
        const backup = await createUploadedPostgresBackup(req, { backupDir, originalName });
        return { success: true, file: backup.file, backup, backups: await listBackups({ backupDir }) };
    });
}

async function restoreBackupJob(req, { fileName, configFile, backupDir = DEFAULT_BACKUP_DIR, restarting = true } = {}) {
    const safeName = String(fileName || "").trim();
    return runTrackedJob(req, "restore:postgres", { file: path.basename(safeName), backupDir }, async () => {
        return restoreBackupPayload({ fileName: safeName, configFile, backupDir, restarting });
    });
}

async function restoreBackupPayload({ fileName, configFile, backupDir = DEFAULT_BACKUP_DIR, restarting = true } = {}) {
    const safeName = String(fileName || "").trim();
    const restore = await restorePostgresBackup({ configFile, backupDir, file: safeName });
    return {
        success: true,
        restarting,
        restore,
        backups: await listBackups({ backupDir })
    };
}

async function verifyBackupPayload({ fileName, backupDir = DEFAULT_BACKUP_DIR } = {}) {
    const verification = await verifyPostgresBackup({ file: String(fileName || "").trim(), backupDir });
    return { success: true, verification, backups: await listBackups({ backupDir }) };
}

async function drillBackupPayload({ fileName, configFile, backupDir = DEFAULT_BACKUP_DIR } = {}) {
    const safeName = String(fileName || "").trim();
    let selected = safeName;
    if (!selected) {
        const backups = await listBackups({ backupDir });
        selected = backups.find((item) => item.type === "postgres")?.file || "";
    }
    if (!selected) throw httpError(404, "no postgres backup available for restore drill");
    const drill = await drillPostgresBackup({ file: selected, configFile, backupDir });
    return { success: true, drill, backups: await listBackups({ backupDir }) };
}

async function drillBackupJob(req, options = {}) {
    return runTrackedJob(req, "backup:restore-drill", { file: path.basename(String(options.fileName || "latest")) }, async () => {
        return drillBackupPayload(options);
    });
}

async function resolveBackupDownload(fileName, { backupDir = DEFAULT_BACKUP_DIR } = {}) {
    let safeName = String(fileName || "");
    if (!safeName) {
        const backups = await listBackups({ backupDir });
        safeName = backups.find((item) => item.type === "postgres")?.file || backups[0]?.file || "";
    }
    if (!safeName) throw httpError(404, "no backup file");
    const file = resolveBackupFile(safeName, backupDir);
    await fs.access(file);
    return file;
}

module.exports = {
    DEFAULT_BACKUP_DIR,
    assertBackupType,
    backupListPayload,
    createBackupJob,
    createBackupPayload,
    drillBackupJob,
    drillBackupPayload,
    expectedRestoreConfirm,
    normalizeBackupType,
    resolveBackupDownload,
    restoreBackupJob,
    restoreBackupPayload,
    uploadBackupJob,
    validateRestoreRequest,
    verifyBackupPayload
};
