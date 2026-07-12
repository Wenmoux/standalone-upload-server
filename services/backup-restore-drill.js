/**
 * [INPUT]: 依赖 docker/backup-pg 的本地备份清单、backups 的演练任务入口与调度环境配置
 * [OUTPUT]: 对外提供周期恢复演练调度器和布尔开关解析函数
 * [POS]: services 的恢复演练调度边界，选择现有归档并把执行与可观测状态交给持久任务系统
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { listBackups } = require("../docker/backup-pg");
const { drillBackupJob } = require("./backups");

function enabledBy(value, fallback = true) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    return !/^(0|false|no|off)$/i.test(text);
}

function positiveNumber(value, fallback, min = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, number) : fallback;
}

function createBackupRestoreDrillScheduler(options = {}) {
    const backupDir = options.backupDir;
    const configFile = options.configFile;
    const enabled = options.enabled ?? enabledBy(process.env.PO18_BACKUP_RESTORE_DRILL_ENABLED, true);
    const intervalMs = positiveNumber(
        options.intervalMs ?? Number(process.env.PO18_BACKUP_RESTORE_DRILL_INTERVAL_HOURS || 168) * 60 * 60 * 1000,
        7 * 24 * 60 * 60 * 1000,
        60 * 1000
    );
    const initialDelayMs = positiveNumber(
        options.initialDelayMs ?? Number(process.env.PO18_BACKUP_RESTORE_DRILL_INITIAL_DELAY_MS || 15 * 60 * 1000),
        15 * 60 * 1000,
        1000
    );
    const list = options.listBackups || listBackups;
    const drill = options.drillBackupJob || drillBackupJob;
    const logEvent = options.logEvent || (() => {});
    let timer = null;
    let running = false;
    let stopped = false;

    async function runNow() {
        if (running) return { skipped: true, reason: "restore drill already running" };
        running = true;
        try {
            const backups = await list({ backupDir });
            const latest = backups.find((item) => item.type === "postgres");
            if (!latest) {
                logEvent("warn", "server-pg", "backup-restore-drill-skipped", { reason: "no postgres backup" });
                return { skipped: true, reason: "no postgres backup" };
            }
            const req = { session: { adminUser: { username: "backup-restore-drill" } }, ip: "127.0.0.1" };
            const payload = await drill(req, { fileName: latest.file, configFile, backupDir });
            logEvent("info", "server-pg", "backup-restore-drill-succeeded", {
                file: payload.drill?.file || latest.file,
                duration_ms: payload.drill?.duration_ms || 0,
                schema_migrations: payload.drill?.schema_migrations || 0,
                books: payload.drill?.books || 0,
                chapters: payload.drill?.chapters || 0
            });
            return payload;
        } catch (error) {
            logEvent("error", "server-pg", "backup-restore-drill-failed", { error: error.message || String(error) });
            throw error;
        } finally {
            running = false;
        }
    }

    function schedule(delayMs) {
        if (!enabled || stopped || timer) return;
        timer = setTimeout(async () => {
            timer = null;
            await runNow().catch(() => {});
            schedule(intervalMs);
        }, delayMs);
        timer.unref?.();
    }

    function start() {
        stopped = false;
        schedule(initialDelayMs);
        return { enabled, interval_ms: intervalMs, initial_delay_ms: initialDelayMs };
    }

    function stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function state() {
        return { enabled, running, scheduled: !!timer, interval_ms: intervalMs, initial_delay_ms: initialDelayMs };
    }

    return { runNow, start, state, stop };
}

module.exports = { createBackupRestoreDrillScheduler, enabledBy };
