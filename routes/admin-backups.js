const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const {
    DEFAULT_BACKUP_DIR,
    backupListPayload,
    createBackupJob,
    resolveBackupDownload,
    restoreBackupJob,
    uploadBackupJob,
    validateRestoreRequest
} = require("../services/backups");

function createAdminBackupRoutes(options = {}) {
    const router = express.Router();
    const requireAdmin = options.requireAdmin || ((req, res, next) => next());
    const configFile = options.configFile || process.env.PO18_CONFIG_FILE || "/config/app.env";
    const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    const collectDiagnostics = options.collectDiagnostics || (async () => ({}));
    const collectCachedSystemStatus = options.collectCachedSystemStatus || (async () => ({}));
    const logEvent = options.logEvent || (() => {});
    const restartProcess = options.restartProcess || (() => process.exit(0));
    const restartDelayMsProvider = options.restartDelayMsProvider || (() => Number(process.env.PO18_ADMIN_RESTART_DELAY_MS || 1200));
    const remoteBackupStatus = options.remoteBackupStatus || (async () => ({ configured: false }));
    const uploadBackupToRemote = options.uploadBackupToRemote;
    const services = {
        backupListPayload: options.backupListPayload || backupListPayload,
        createBackupJob: options.createBackupJob || createBackupJob,
        resolveBackupDownload: options.resolveBackupDownload || resolveBackupDownload,
        restoreBackupJob: options.restoreBackupJob || restoreBackupJob,
        uploadBackupJob: options.uploadBackupJob || uploadBackupJob,
        validateRestoreRequest: options.validateRestoreRequest || validateRestoreRequest
    };

    router.get("/admin-api/backup/list", requireAdmin, async (req, res, next) => {
        try {
            res.json(await services.backupListPayload({ backupDir }));
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/backup", requireAdmin, async (req, res, next) => {
        try {
            const type = String(req.body?.type || "postgres").toLowerCase();
            const payload = await services.createBackupJob(req, {
                type,
                configFile,
                backupDir,
                getDiagnostics: async () => collectDiagnostics(configFile, await collectCachedSystemStatus())
            });
            const backup = payload.backup;
            logEvent("info", "server-pg", "backup-created", { type: backup.type, file: backup.file, bytes: backup.bytes });
            res.json(payload);
        } catch (err) {
            logEvent("error", "server-pg", "backup-failed", { error: err.message || String(err) });
            next(err);
        }
    });

    router.get("/admin-api/backup/remote/status", requireAdmin, async (req, res, next) => {
        try {
            res.json(await remoteBackupStatus());
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin-api/backup/remote/upload", requireAdmin, async (req, res, next) => {
        try {
            if (typeof uploadBackupToRemote !== "function") return res.status(503).json({ error: "remote backup unavailable" });
            const file = String(req.body?.file || req.query.file || "").trim();
            if (!file) return res.status(400).json({ error: "backup file is required" });
            const remote = await uploadBackupToRemote(file, { backupDir });
            logEvent("info", "server-pg", "backup-remote-uploaded", { file, provider: remote.provider, bytes: remote.bytes || 0 });
            res.json({ success: true, remote });
        } catch (err) {
            logEvent("error", "server-pg", "backup-remote-upload-failed", { error: err.message || String(err) });
            next(err);
        }
    });

    router.post("/admin-api/backup/upload", requireAdmin, async (req, res, next) => {
        try {
            const originalName = decodeURIComponent(String(req.get("X-Backup-File") || req.get("X-File-Name") || "upload.dump"));
            const payload = await services.uploadBackupJob(req, { originalName, backupDir });
            const backup = payload.backup;
            logEvent("info", "server-pg", "backup-uploaded", { file: backup.file, bytes: backup.bytes, original_name: backup.original_name || "" });
            res.json(payload);
        } catch (err) {
            logEvent("error", "server-pg", "backup-upload-failed", { error: err.message || String(err) });
            next(err);
        }
    });

    router.post("/admin-api/backup/restore", requireAdmin, async (req, res, next) => {
        try {
            const fileName = String(req.body?.file || "").trim();
            const restoreCheck = services.validateRestoreRequest(fileName, req.body?.confirm || req.body?.confirmation || "");
            if (!restoreCheck.ok) return res.status(restoreCheck.status).json(restoreCheck.body);
            const payload = await services.restoreBackupJob(req, {
                fileName,
                configFile,
                backupDir,
                restarting: process.env.PO18_RESTART_AFTER_RESTORE !== "0"
            });
            const restore = payload.restore;
            logEvent("info", "server-pg", "backup-restored", {
                file: restore.file,
                bytes: restore.bytes,
                pre_restore_backup: restore.pre_restore_backup?.file || ""
            });
            res.json(payload);
            if (process.env.PO18_RESTART_AFTER_RESTORE !== "0") {
                setTimeout(restartProcess, Number(restartDelayMsProvider() || 1200)).unref?.();
            }
        } catch (err) {
            logEvent("error", "server-pg", "backup-restore-failed", { error: err.message || String(err) });
            next(err);
        }
    });

    router.get("/admin-api/backup/download", requireAdmin, async (req, res, next) => {
        try {
            const file = await services.resolveBackupDownload(String(req.query.file || ""), { backupDir });
            res.download(file, path.basename(file));
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/backup/config", requireAdmin, async (req, res, next) => {
        try {
            await fs.access(configFile);
            res.download(configFile, "app.env");
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin-api/backup/diagnostics", requireAdmin, async (req, res, next) => {
        try {
            const diagnostics = await collectDiagnostics(configFile, await collectCachedSystemStatus());
            const fileName = `po18-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
            res.end(`${JSON.stringify(diagnostics, null, 2)}\n`);
        } catch (err) {
            next(err);
        }
    });

    return router;
}

module.exports = {
    createAdminBackupRoutes
};
