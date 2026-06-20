<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>系统</h2>
        <p class="sub">{{ versionLine }}</p>
      </div>
      <div class="quick-links">
        <button class="secondary" type="button" @click="loadAll">刷新</button>
        <button class="secondary" type="button" @click="window.open('/setup', '_blank')">初始化面板</button>
        <button class="danger secondary" type="button" @click="restart">重启服务</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">系统状态</p><p class="section-desc">检查 server-pg、阅读器、Bot、数据库连接和表结构。</p></div></div>
        <div v-if="statusLoading" class="empty-block">加载中...</div>
        <div v-else class="status-grid">
          <article v-for="item in statusRows" :key="item.name || item.url" class="status-box" :class="statusClass(item)">
            <strong>{{ item.name || "service" }} · {{ statusLabel(item) }}</strong>
            <span>{{ item.required === false ? "可选项" : "必需项" }} · {{ item.detail || item.error || `status=${item.status || "n/a"}` }}<br v-if="item.url" />{{ item.url || "" }}</span>
          </article>
          <article v-if="!statusRows.length" class="status-box skip"><strong>等待状态</strong><span>还没有状态数据。</span></article>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">诊断摘要</p>
            <p class="section-desc">安全项、schema version、最近错误和疑似慢请求。</p>
          </div>
          <button class="secondary" type="button" @click="loadOverview">刷新摘要</button>
        </div>
        <div class="status-grid">
          <article v-for="item in overview.securityChecks || []" :key="item.name" class="status-box" :class="statusClass(item)">
            <strong>{{ item.name }} · {{ item.ok ? "OK" : "CHECK" }}</strong>
            <span>{{ item.detail }}</span>
          </article>
        </div>
        <div class="schema-strip">
          <div><span>Schema Version</span><strong>{{ overview.schema?.version || "-" }}</strong></div>
          <div><span>Migrations</span><strong>{{ overview.schema?.migrationTable ? `${overview.schema?.migrationCount || 0} 条` : "未启用" }}</strong></div>
          <div><span>System Jobs</span><strong>{{ overview.jobs?.available ? `${overview.jobs?.total || 0} 个` : "未启用" }}</strong></div>
          <div><span>Book Stats</span><strong>{{ overview.schema?.bookStatsTable ? "已启用" : "未启用" }}</strong></div>
          <div><span>Public Tables</span><strong>{{ overview.schema?.publicTables ?? "-" }}</strong></div>
          <div><span>pg_trgm</span><strong>{{ overview.schema?.pgTrgm ? "已启用" : "未启用" }}</strong></div>
          <div><span>Database</span><strong>{{ overview.schema?.database || "-" }}</strong></div>
        </div>
        <div class="split maintenance-grid">
          <div>
            <h3 class="mini-title">最近迁移</h3>
            <div v-if="!(overview.schema?.recentMigrations || []).length" class="empty-block">暂无迁移记录</div>
            <ul v-else class="mini-list">
              <li v-for="item in overview.schema.recentMigrations" :key="item.version">
                <span>{{ item.version }} · {{ item.name || "-" }}<br />{{ time(item.applied_at) }} · {{ item.duration_ms || 0 }}ms</span>
                <strong>SQL</strong>
              </li>
            </ul>
          </div>
          <div>
            <h3 class="mini-title">任务中心</h3>
            <div class="job-strip">
              <span>Queued {{ overview.jobs?.byStatus?.queued || 0 }}</span>
              <span>Running {{ overview.jobs?.byStatus?.running || 0 }}</span>
              <span>Done {{ overview.jobs?.byStatus?.succeeded || 0 }}</span>
              <span>Failed {{ overview.jobs?.byStatus?.failed || 0 }}</span>
            </div>
            <div v-if="!(overview.jobs?.recent || []).length" class="empty-block">暂无系统任务</div>
            <ul v-else class="mini-list">
              <li v-for="job in overview.jobs.recent" :key="job.id">
                <span>#{{ job.id }} · {{ job.type || "-" }} · {{ job.status }}<br />{{ job.progress || 0 }}% · {{ time(job.updated_at || job.created_at) }}</span>
                <strong>{{ job.status }}</strong>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">备份与诊断包</p>
            <p class="section-desc">{{ backupDir || "/config/backups" }} · 数据库备份自动保留最近 N 份。</p>
          </div>
          <button class="secondary" type="button" @click="loadBackups">刷新列表</button>
        </div>
        <div class="button-row backup-actions">
          <button type="button" :disabled="!!backupBusy" @click="createBackup('postgres')">{{ backupBusy === "postgres" ? "生成中..." : "生成数据库备份" }}</button>
          <button class="secondary" type="button" :disabled="!!backupBusy" @click="createBackup('config')">{{ backupBusy === "config" ? "保存中..." : "保存配置备份" }}</button>
          <button class="secondary" type="button" :disabled="!!backupBusy" @click="createBackup('diagnostics')">{{ backupBusy === "diagnostics" ? "生成中..." : "生成诊断包" }}</button>
          <a class="ghost-button" href="/admin-api/backup/config" target="_blank" rel="noreferrer">下载当前配置</a>
          <a class="ghost-button" href="/admin-api/backup/diagnostics" target="_blank" rel="noreferrer">下载脱敏诊断</a>
        </div>
        <div class="remote-backup-box">
          <div>
            <p class="mini-title">远程备份</p>
            <p class="section-desc">{{ remoteBackup.configured ? `已配置 ${remoteProviderLabel}` : "未配置 WebDAV / S3 / R2，仍可使用本地备份。" }}</p>
          </div>
          <div class="tag-row">
            <span class="tag" :class="remoteBackup.configured ? 'success' : 'warn'">{{ remoteBackup.configured ? "ready" : "not configured" }}</span>
            <span v-if="remoteBackup.s3?.bucket" class="tag">bucket {{ remoteBackup.s3.bucket }}</span>
            <span v-if="remoteBackup.s3?.prefix" class="tag">prefix {{ remoteBackup.s3.prefix }}</span>
            <span v-if="remoteBackup.webdav?.url_present" class="tag">WebDAV URL</span>
            <button class="secondary" type="button" @click="loadRemoteBackupStatus">刷新远程状态</button>
          </div>
        </div>
        <div class="metrics-box">
          <div class="section-head">
            <div>
              <p class="section-title">指标摘要</p>
              <p class="section-desc">请求、错误、阅读器接口、Bot 队列、数据库连接池和备份事件。</p>
            </div>
            <button class="secondary" type="button" @click="loadMetrics">刷新指标</button>
          </div>
          <div class="stat-grid four" style="margin-top: 12px">
            <StatCard label="HTTP 请求" :value="number(metricsSummary.http?.total || 0)">错误 {{ number(metricsSummary.http?.errors || 0) }} / 平均 {{ number(metricsSummary.http?.avg_duration_ms || 0) }}ms</StatCard>
            <StatCard label="阅读器 API" :value="number(metricsSummary.reader_api?.total || 0)">平均 {{ number(metricsSummary.reader_api?.avg_duration_ms || 0) }}ms / p95 {{ number(metricsSummary.reader_api?.p95_duration_ms || 0) }}ms</StatCard>
            <StatCard label="Bot 队列" :value="`${number(metricsSummary.bot_queue?.running || 0)} / ${number(metricsSummary.bot_queue?.queued || 0)}`">running / queued</StatCard>
            <StatCard label="数据库池" :value="`${number(metricsSummary.database?.idle || 0)} / ${number(metricsSummary.database?.total || 0)}`">waiting {{ number(metricsSummary.database?.waiting || 0) }}</StatCard>
          </div>
          <div class="split observability-grid reader-budget-grid" style="margin-top: 14px">
            <div>
              <h3 class="mini-title">阅读器性能预算</h3>
              <ul class="mini-list">
                <li v-for="item in readerPerformanceRows" :key="item.name">
                  <span>{{ perfEndpointLabel(item.name) }}<br />p95 {{ number(item.p95_ms || 0) }}ms / budget {{ number(item.budget_ms || 0) }}ms / {{ number(item.count || 0) }} 次</span>
                  <strong class="budget-state" :class="perfStateClass(item)">{{ perfStateLabel(item) }}</strong>
                </li>
                <li v-if="!readerPerformanceRows.length"><span>暂无阅读器接口样本</span><strong>empty</strong></li>
              </ul>
            </div>
            <div>
              <h3 class="mini-title">首屏资源预算</h3>
              <ul class="mini-list">
                <li v-for="item in readerAssetChecks" :key="item.name">
                  <span>{{ item.name }}<br />{{ bytes(item.value || 0) }} / {{ bytes(item.budget || 0) }}</span>
                  <strong class="budget-state" :class="item.ok ? 'ok' : 'fail'">{{ item.ok ? "OK" : "超预算" }}</strong>
                </li>
                <li v-if="!readerAssetChecks.length"><span>{{ metricsSummary.reader_assets?.error || "暂无 reader dist 构建信息" }}</span><strong>empty</strong></li>
              </ul>
              <div v-if="readerLargestAssets.length" class="asset-row">
                <span v-for="item in readerLargestAssets" :key="item.file" class="tag">{{ item.file }} · {{ bytes(item.bytes || 0) }}</span>
              </div>
            </div>
          </div>
          <div class="split observability-grid" style="margin-top: 14px">
            <div>
              <h3 class="mini-title">HTTP 状态</h3>
              <ul class="mini-list">
                <li v-for="(count, status) in metricsSummary.http?.by_status || {}" :key="status"><span>{{ status }}</span><strong>{{ number(count) }}</strong></li>
              </ul>
            </div>
            <div>
              <h3 class="mini-title">Top 路径</h3>
              <ul class="mini-list">
                <li v-for="item in metricsSummary.http?.top_paths || []" :key="item.path">
                  <span>{{ item.path }}<br />avg {{ number(item.avg_duration_ms || 0) }}ms / errors {{ number(item.errors || 0) }}</span>
                  <strong>{{ number(item.count || 0) }}</strong>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div class="restore-box">
          <div>
            <p class="mini-title">上传 PG dump</p>
            <p class="section-desc">支持当前系统生成的 PostgreSQL custom dump。大文件上传上限由 <code>PO18_BACKUP_UPLOAD_MAX_BYTES</code> 控制。</p>
            <div class="button-row">
              <input type="file" accept=".dump,.backup,.pgdump,application/octet-stream" @change="onBackupFileChange" />
              <button class="secondary" type="button" :disabled="!selectedUploadFile || uploadBusy" @click="uploadBackup">{{ uploadBusy ? "上传中..." : "上传 dump" }}</button>
            </div>
          </div>
          <div>
            <p class="mini-title">恢复数据库</p>
            <p class="section-desc">恢复前会自动再生成一次当前数据库备份；恢复成功后容器会重启。</p>
            <label class="field">
              <span>选择备份</span>
              <select v-model="restoreFile">
                <option value="">选择 PostgreSQL 备份</option>
                <option v-for="item in postgresBackups" :key="item.file" :value="item.file">{{ item.file }} · {{ bytes(item.bytes) }} · {{ time(item.created_at) }}</option>
              </select>
            </label>
            <label class="field">
              <span>确认短语：{{ restorePhrase || "先选择备份" }}</span>
              <input v-model.trim="restoreConfirm" placeholder="RESTORE po18-pg-xxxx.dump" />
            </label>
            <div class="button-row">
              <button class="danger secondary" type="button" :disabled="!canRestore || restoreBusy" @click="restoreBackup">{{ restoreBusy ? "恢复中..." : "恢复所选备份" }}</button>
            </div>
            <p v-if="restoreResult" class="inline-status ok">{{ restoreResult }}</p>
          </div>
        </div>
        <div v-if="!backupRows.length" class="empty-block">暂无备份文件。生成数据库备份后会显示在这里。</div>
        <div v-else class="backup-list">
          <article v-for="item in backupRows" :key="item.file" class="backup-item">
            <button class="secondary" type="button" :disabled="!remoteBackup.configured || remoteUploadBusy === item.file" @click="uploadRemoteBackup(item.file)">
              {{ remoteUploadBusy === item.file ? "上传中..." : "上传远程" }}
            </button>
            <div>
              <strong>{{ backupTypeLabel(item.type) }} · {{ item.file }}</strong>
              <span>{{ time(item.created_at) }} · {{ bytes(item.bytes) }}<template v-if="item.database"> · {{ item.database }}</template></span>
            </div>
            <button class="secondary" type="button" @click="downloadBackup(item.file)">下载</button>
          </article>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">运行异常</p><p class="section-desc">从 runtime log 里提取，不替代完整日志。</p></div></div>
        <div class="split observability-grid">
          <div>
            <h3 class="mini-title">疑似慢请求 Top 20</h3>
            <div v-if="!(overview.slowRequests || []).length" class="empty-block">暂无包含 ms 的慢请求日志</div>
            <ol v-else class="slow-list">
              <li v-for="(item, index) in overview.slowRequests" :key="`${item.ms}-${index}`">
                <strong>{{ item.ms }}ms</strong>
                <span>{{ item.line }}</span>
              </li>
            </ol>
          </div>
          <div>
            <h3 class="mini-title">最近错误</h3>
            <pre class="mini-log">{{ (overview.recentErrors || []).join("\n") || "暂无错误日志" }}</pre>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head"><div><p class="section-title">运行日志</p><p class="section-desc">{{ logFile || "读取容器运行日志；完整日志仍可用 docker logs 查看。" }}</p></div></div>
        <div class="filter-row">
          <button v-for="item in logFilters" :key="item.key" type="button" :class="{ active: logFilter === item.key }" @click="loadLogs(item.key)">{{ item.label }}</button>
        </div>
        <pre class="logbox">{{ logText || "暂无日志" }}</pre>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div><p class="section-title">脱敏诊断</p><p class="section-desc">Token、密码、数据库连接密码会脱敏，适合排查部署问题。</p></div>
          <button class="secondary" type="button" @click="copyDiagnostics">复制</button>
        </div>
        <textarea class="diagbox" readonly :value="diagnosticsText || '等待加载...'" />
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { bytes, number, time, uptime } from "../utils/format";

const toast = inject("toast", () => {});
const statusLoading = ref(false);
const statusRows = ref([]);
const versionLine = ref("检查 server-pg、阅读器、Bot、数据库连接和表结构。");
const logFile = ref("");
const logText = ref("等待加载...");
const logFilter = ref("all");
const diagnosticsText = ref("等待加载...");
const overview = ref({ schema: {}, jobs: { byStatus: {}, recent: [] }, securityChecks: [], recentErrors: [], slowRequests: [] });
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
const metricsSummary = ref({ http: {}, reader_api: {}, bot_queue: {}, backup: {}, database: {}, window: {} });
const logFilters = [
  { key: "all", label: "全部" },
  { key: "error", label: "错误" },
  { key: "database", label: "数据库" },
  { key: "bot", label: "Bot" },
  { key: "reader", label: "阅读器" },
  { key: "server", label: "后端" },
  { key: "setup", label: "启动/面板" }
];

const postgresBackups = computed(() => backupRows.value.filter((item) => item.type === "postgres"));
const restorePhrase = computed(() => (restoreFile.value ? `RESTORE ${restoreFile.value}` : ""));
const canRestore = computed(() => restoreFile.value && restoreConfirm.value === restorePhrase.value);
const remoteProviderLabel = computed(() => remoteBackup.value.provider || (remoteBackup.value.s3?.configured ? "s3/r2" : remoteBackup.value.webdav?.configured ? "webdav" : "remote"));
const readerPerformanceRows = computed(() => (metricsSummary.value.reader_performance?.endpoints || []).filter((item) => item.budget_ms));
const readerAssetChecks = computed(() => metricsSummary.value.reader_assets?.checks || []);
const readerLargestAssets = computed(() => (metricsSummary.value.reader_assets?.largest || []).slice(0, 4));

function statusClass(item) {
  if (item.skipped) return "skip";
  if (!item.ok && item.required === false) return "optional-fail";
  return item.ok ? "ok" : "fail";
}

function statusLabel(item) {
  if (item.skipped) return "SKIP";
  if (item.ok) return "OK";
  return item.required === false ? "OPTIONAL FAIL" : "FAIL";
}

function backupTypeLabel(type) {
  if (type === "postgres") return "数据库";
  if (type === "config") return "配置";
  if (type === "diagnostics") return "诊断";
  return type || "备份";
}

function perfEndpointLabel(name) {
  const labels = {
    search: "搜索",
    detail: "详情",
    catalog: "目录",
    chapter: "正文"
  };
  return labels[name] || name || "-";
}

function perfStateClass(item) {
  if (!item.count) return "skip";
  return item.ok ? "ok" : "fail";
}

function perfStateLabel(item) {
  if (!item.count) return "无样本";
  return item.ok ? "OK" : "超预算";
}

async function loadStatus() {
  statusLoading.value = true;
  try {
    const data = await api("/admin-api/system/status");
    const version = data.version || {};
    versionLine.value = `${version.image || "wenmoux/reader:v1.0"} · ${version.version || "-"} · uptime ${uptime(version.uptime_seconds || 0)}`;
    statusRows.value = data.deep?.checks || data.status || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    statusLoading.value = false;
  }
}

async function loadLogs(filter = logFilter.value) {
  logFilter.value = filter;
  try {
    const data = await api(`/admin-api/system/logs?filter=${encodeURIComponent(filter)}`);
    logFile.value = data.file || "runtime.log";
    logText.value = data.text || "暂无日志";
  } catch (err) {
    logText.value = `日志加载失败：${err.message || String(err)}`;
  }
}

async function loadOverview() {
  try {
    overview.value = await api("/admin-api/system/overview");
    if (overview.value.backups?.rows) {
      backupRows.value = overview.value.backups.rows;
      backupDir.value = overview.value.backups.dir || backupDir.value;
    }
  } catch (err) {
    toast(err.message || String(err));
  }
}

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
    const data = await api("/admin-api/backup/remote/upload", {
      method: "POST",
      body: JSON.stringify({ file })
    });
    toast(data.remote?.provider ? `远程备份已上传：${data.remote.provider}` : "远程备份已上传");
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    remoteUploadBusy.value = "";
  }
}

async function loadMetrics() {
  try {
    metricsSummary.value = await api("/admin-api/metrics/summary");
  } catch (err) {
    toast(err.message || String(err));
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
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Backup-File": encodeURIComponent(file.name || "upload.dump")
      },
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
  if (!window.confirm(`确认恢复 ${restoreFile.value}？恢复前会自动备份当前数据库。`)) return;
  restoreBusy.value = true;
  restoreResult.value = "";
  try {
    const data = await api("/admin-api/backup/restore", {
      method: "POST",
      body: JSON.stringify({ file: restoreFile.value, confirm: restoreConfirm.value })
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

async function loadDiagnostics() {
  try {
    const data = await api("/admin-api/system/diagnostics");
    diagnosticsText.value = JSON.stringify(data, null, 2);
  } catch (err) {
    diagnosticsText.value = `诊断加载失败：${err.message || String(err)}`;
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnosticsText.value);
    toast("诊断信息已复制");
  } catch {
    window.prompt("复制诊断信息", diagnosticsText.value);
  }
}

async function restart() {
  if (!window.confirm("确认重启服务？Docker 会按 restart 策略拉起容器。")) return;
  await api("/admin-api/system/restart", { method: "POST" });
  toast("已发送重启请求");
}

function loadAll() {
  loadStatus();
  loadOverview();
  loadBackups();
  loadRemoteBackupStatus();
  loadMetrics();
  loadLogs(logFilter.value);
  loadDiagnostics();
}

onMounted(loadAll);
</script>
