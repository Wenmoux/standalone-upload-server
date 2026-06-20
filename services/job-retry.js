function httpError(status, message, extra = {}) {
    const err = new Error(message);
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function plainJobInput(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
}

function retryInput(previousJob, input = {}) {
    return { ...input, retryOf: Number(previousJob.id || 0) || undefined };
}

function createSystemJobRetryService(options = {}) {
    const {
        getSystemJob,
        runTrackedJob,
        rankService,
        createBackupPayload,
        restoreBackupPayload,
        bookMaintenanceService,
        chapterMaintenanceService,
        po18CrawlerService,
        configFile,
        backupDir,
        collectDiagnostics,
        collectCachedSystemStatus,
        restartProcess = () => process.exit(0),
        restartDelayMsProvider = () => 1200
    } = options;

    async function rankRefreshJobPayload(limit) {
        await rankService.getPayload({ refresh: true, limit });
        const status = rankService.statusPayload();
        return {
            success: true,
            ...status,
            jobResult: {
                success: true,
                ready: !!status.ready,
                sourceLimit: status.sourceLimit || 0,
                bookCount: status.bookCount || status.total || 0,
                refreshedAt: status.at || status.updatedAt || null
            }
        };
    }

    async function retrySystemJob(req, id) {
        const previousJob = await getSystemJob(id);
        if (!previousJob) return null;
        const status = String(previousJob.status || "");
        if (!["failed", "canceled"].includes(status)) {
            throw httpError(409, "only failed or canceled jobs can be retried");
        }

        const type = String(previousJob.type || "");
        const input = plainJobInput(previousJob.input_json);
        const inputWithRetry = retryInput(previousJob, input);

        if (type === "rank_refresh") {
            const limit = input.limit ?? input.sourceLimit ?? null;
            return runTrackedJob(req, type, inputWithRetry, () => rankRefreshJobPayload(limit));
        }

        if (type.startsWith("backup:")) {
            const backupType = type.slice("backup:".length);
            if (backupType === "upload") throw httpError(400, "uploaded dump jobs cannot be retried because the request body is no longer available");
            return runTrackedJob(req, type, inputWithRetry, () =>
                createBackupPayload({
                    type: backupType,
                    configFile,
                    backupDir: input.backupDir || backupDir,
                    getDiagnostics: async () => collectDiagnostics(configFile, await collectCachedSystemStatus())
                })
            );
        }

        if (type === "restore:postgres") {
            const expectedConfirm = `RETRY ${previousJob.id}`;
            if (String(req.body?.confirm || req.body?.confirmation || "").trim() !== expectedConfirm) {
                throw httpError(400, "restore retry confirmation phrase mismatch", { expectedConfirm });
            }
            const fileName = String(input.file || input.fileName || "").trim();
            if (!fileName) throw httpError(400, "restore job is missing backup file input");
            const payload = await runTrackedJob(req, type, inputWithRetry, () =>
                restoreBackupPayload({
                    fileName,
                    configFile,
                    backupDir: input.backupDir || backupDir,
                    restarting: process.env.PO18_RESTART_AFTER_RESTORE !== "0"
                })
            );
            if (process.env.PO18_RESTART_AFTER_RESTORE !== "0") {
                setTimeout(restartProcess, Number(restartDelayMsProvider() || 1200)).unref?.();
            }
            return payload;
        }

        if (type === "books_cleanup_stale") {
            const expectedConfirm = `RETRY ${previousJob.id}`;
            if (String(req.body?.confirm || req.body?.confirmation || "").trim() !== expectedConfirm) {
                throw httpError(400, "cleanup retry confirmation phrase mismatch", { expectedConfirm });
            }
            return runTrackedJob(req, type, inputWithRetry, () =>
                bookMaintenanceService.cleanupStalePo18Books({ actor: req.session?.adminUser?.username || "admin" })
            );
        }

        if (type === "chapters_repair_order") {
            const limit = Math.max(1, Math.min(500, Number(input.limit || 50)));
            return runTrackedJob(req, type, inputWithRetry, () =>
                chapterMaintenanceService.repairChapterOrderDuplicates({ limit })
            );
        }

        if (type === "po18_crawler_run") {
            if (!po18CrawlerService || typeof po18CrawlerService.runNow !== "function") {
                throw httpError(503, "po18 crawler is unavailable");
            }
            return {
                success: true,
                job: await po18CrawlerService.runNow(inputWithRetry, req.session?.adminUser?.username || "admin")
            };
        }

        throw httpError(400, "this job type cannot be retried from admin panel");
    }

    return { retrySystemJob };
}

module.exports = {
    createSystemJobRetryService
};
