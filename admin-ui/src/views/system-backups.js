/**
 * [INPUT]: 依赖 Vue 响应式原语、Admin 备份 API、系统展示映射以及调用方提供的消息/确认/指标刷新能力
 * [OUTPUT]: 对外提供 useSystemBackups，封装备份索引、上传、远端归档、验证、恢复演练与数据库恢复生命周期
 * [POS]: admin-ui/src/views 的系统备份工作区组合层，让 SystemView 只编排分区而不持有成组的备份状态机
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, ref } from "vue";
import { api } from "../services/api";
import { number } from "../utils/format";
import { backupTypeLabel } from "./system-config";

export function useSystemBackups(options = {}) {
    const toast = options.toast || (() => {});
    const confirmAction = options.confirmAction || (async () => ({ confirmed: false, reason: "" }));
    const refreshMetrics = options.refreshMetrics || (async () => {});
    const backupRows = ref([]);
    const backupDir = ref("");
    const backupBusy = ref("");
    const selectedUploadFile = ref(null);
    const uploadBusy = ref(false);
    const restoreFile = ref("");
    const restoreConfirm = ref("");
    const restoreBusy = ref(false);
    const restoreResult = ref("");
    const remoteBackup = ref({});
    const remoteUploadBusy = ref("");
    const verifyBusy = ref("");
    const drillBusy = ref("");
    const postgresBackups = computed(() => backupRows.value.filter((item) => item.type === "postgres"));
    const restorePhrase = computed(() => (restoreFile.value ? `RESTORE ${restoreFile.value}` : ""));
    const canRestore = computed(() => restoreFile.value && restoreConfirm.value === restorePhrase.value);
    const remoteProviderLabel = computed(
        () =>
            remoteBackup.value.provider ||
            (remoteBackup.value.s3?.configured ? "s3/r2" : remoteBackup.value.webdav?.configured ? "webdav" : "remote")
    );

    async function loadBackups() {
        try {
            const data = await api("/admin-api/backup/list");
            backupRows.value = data.rows || [];
            backupDir.value = data.dir || "";
            if (!restoreFile.value && postgresBackups.value[0]) restoreFile.value = postgresBackups.value[0].file;
        } catch (err) {
            toast(err.message || String(err));
        }
    }

    async function loadRemoteBackupStatus() {
        try {
            remoteBackup.value = await api("/admin-api/backup/remote/status");
        } catch (err) {
            remoteBackup.value = {};
            toast(err.message || String(err));
        }
    }

    async function uploadRemoteBackup(file) {
        if (!file) return;
        remoteUploadBusy.value = file;
        try {
            const data = await api("/admin-api/backup/remote/upload", { method: "POST", body: JSON.stringify({ file }) });
            toast(data.remote?.provider ? `远程备份已上传：${data.remote.provider}` : "远程备份已上传");
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            remoteUploadBusy.value = "";
        }
    }

    async function verifyBackup(file) {
        if (!file) return;
        verifyBusy.value = file;
        try {
            const data = await api("/admin-api/backup/verify", { method: "POST", body: JSON.stringify({ file }) });
            backupRows.value = data.backups || backupRows.value;
            toast(data.verification?.archive_entries ? `备份验证通过：${data.verification.archive_entries} 个归档项` : "备份验证通过");
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            verifyBusy.value = "";
        }
    }

    async function drillBackup(file) {
        if (!file) return;
        drillBusy.value = file;
        try {
            const data = await api("/admin-api/backup/drill", { method: "POST", body: JSON.stringify({ file }) });
            backupRows.value = data.backups || backupRows.value;
            const drill = data.drill || {};
            toast(
                `恢复演练通过：${number(drill.schema_migrations || 0)} 个迁移，${number(drill.books || 0)} 本书，${number(drill.chapters || 0)} 章`
            );
            await refreshMetrics();
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            drillBusy.value = "";
        }
    }

    async function createBackup(type) {
        backupBusy.value = type;
        try {
            const data = await api("/admin-api/backup", { method: "POST", body: JSON.stringify({ type }) });
            backupRows.value = data.backups || backupRows.value;
            toast(data.file ? `${backupTypeLabel(type)}备份完成：${data.file}` : "备份完成");
            if (data.file) downloadBackup(data.file);
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            backupBusy.value = "";
        }
    }

    function downloadBackup(file) {
        window.open(`/admin-api/backup/download?file=${encodeURIComponent(file)}`, "_blank");
    }

    function onBackupFileChange(event) {
        selectedUploadFile.value = event.target.files?.[0] || null;
    }

    async function uploadBackup() {
        if (!selectedUploadFile.value) return;
        uploadBusy.value = true;
        try {
            const file = selectedUploadFile.value;
            const data = await api("/admin-api/backup/upload", {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream", "X-Backup-File": encodeURIComponent(file.name || "upload.dump") },
                body: file
            });
            backupRows.value = data.backups || backupRows.value;
            restoreFile.value = data.file || restoreFile.value;
            restoreConfirm.value = "";
            toast(data.file ? `上传完成：${data.file}` : "上传完成");
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            uploadBusy.value = false;
        }
    }

    async function restoreBackup() {
        if (!canRestore.value) return;
        const confirmation = await confirmAction({
            title: "恢复数据库",
            message: `将使用 ${restoreFile.value} 覆盖当前数据库。恢复前会自动备份当前数据库，完成后服务会重启。`,
            confirmLabel: "恢复数据库",
            phrase: "RESTORE"
        });
        if (!confirmation.confirmed) return;
        restoreBusy.value = true;
        restoreResult.value = "";
        try {
            const data = await api("/admin-api/backup/restore", {
                method: "POST",
                body: JSON.stringify({ file: restoreFile.value, confirm: restoreConfirm.value, reason: confirmation.reason })
            });
            backupRows.value = data.backups || backupRows.value;
            restoreResult.value = data.restore?.pre_restore_backup?.file
                ? `恢复完成，恢复前备份：${data.restore.pre_restore_backup.file}。服务正在重启。`
                : "恢复完成，服务正在重启。";
            toast("恢复完成，服务正在重启");
        } catch (err) {
            toast(err.message || String(err));
        } finally {
            restoreBusy.value = false;
        }
    }

    return {
        backupRows,
        backupDir,
        backupBusy,
        selectedUploadFile,
        uploadBusy,
        restoreFile,
        restoreConfirm,
        restoreBusy,
        restoreResult,
        remoteBackup,
        remoteUploadBusy,
        verifyBusy,
        drillBusy,
        postgresBackups,
        restorePhrase,
        canRestore,
        remoteProviderLabel,
        loadBackups,
        loadRemoteBackupStatus,
        uploadRemoteBackup,
        verifyBackup,
        drillBackup,
        createBackup,
        downloadBackup,
        onBackupFileChange,
        uploadBackup,
        restoreBackup
    };
}
