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

    <section v-if="user?.role === 'owner'" class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">管理员与角色</p>
            <p class="section-desc">owner 管理系统；operator 维护书库；moderator 审核内容；viewer 只读。</p>
          </div>
          <button class="secondary" type="button" @click="loadAdminUsers">刷新管理员</button>
        </div>
        <div class="toolbar compact">
          <input v-model.trim="newAdmin.username" placeholder="新管理员用户名" />
          <input v-model="newAdmin.password" type="password" placeholder="密码至少 10 位" />
          <select v-model="newAdmin.role"><option value="owner">owner</option><option value="operator">operator</option><option value="moderator">moderator</option><option value="viewer">viewer</option></select>
          <button type="button" @click="createAdminUser">新增管理员</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>账号</th><th>角色</th><th>创建/登录</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="admin in adminUsers" :key="admin.id">
                <td><strong>{{ admin.username }}</strong><br /><small>#{{ admin.id }}</small></td>
                <td><select v-model="adminRoles[admin.id]"><option value="owner">owner</option><option value="operator">operator</option><option value="moderator">moderator</option><option value="viewer">viewer</option></select></td>
                <td>{{ time(admin.created_at) }}<br /><small>登录 {{ time(admin.last_login_at) }}</small></td>
                <td class="button-row">
                  <button class="secondary" type="button" :disabled="adminRoles[admin.id] === admin.role" @click="saveAdminRole(admin)">保存角色</button>
                  <button class="danger secondary" type="button" :disabled="Number(admin.id) === Number(user.id)" @click="deleteAdminUser(admin)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">内部 API Token</p>
            <p class="section-desc">仅显示脱敏前缀、权限范围、最近来源和吊销状态，数据库不保存原始 Token。</p>
          </div>
          <button class="secondary" type="button" @click="loadApiTokens">刷新 Token</button>
        </div>
        <div v-if="!apiTokens.length" class="empty-block">暂无已登记 Token，服务启动完成后会自动登记环境变量中的 Bot/Upload Token。</div>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>类型</th><th>Token</th><th>Scope</th><th>最近使用</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="token in apiTokens" :key="token.id">
                <td>{{ token.name || "-" }}</td>
                <td><span class="tag">{{ token.kind }}</span></td>
                <td><code>{{ token.token_prefix || "-" }}</code></td>
                <td><span v-for="scope in token.scopes_json || []" :key="scope" class="tag">{{ scope }}</span></td>
                <td>{{ time(token.last_used_at) }}<br /><small>{{ token.last_used_ip || "-" }}</small></td>
                <td><span class="tag" :class="token.revoked_at ? 'warn' : 'success'">{{ token.revoked_at ? "已吊销" : "有效" }}</span></td>
                <td><button class="danger secondary" type="button" :disabled="!!token.revoked_at" @click="revokeToken(token)">吊销</button></td>
              </tr>
            </tbody>
          </table>
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
            <StatCard label="PO18 来源" :value="metricsSummary.crawler?.source_health?.state || 'unknown'">成功 {{ number(metricsSummary.crawler?.source_health?.successes || 0) }} / 失败 {{ number(metricsSummary.crawler?.source_health?.failures || 0) }}</StatCard>
            <StatCard label="持久任务" :value="`${number(metricsSummary.system_jobs?.running || 0)} / ${number(metricsSummary.system_jobs?.queued || 0)}`">重试 {{ number(metricsSummary.system_jobs?.retries || 0) }} / 过期租约 {{ number(metricsSummary.system_jobs?.expired_leases || 0) }}</StatCard>
            <StatCard label="真实用户性能" :value="number(readerRum.sessions || 0)">会话 / {{ number(readerRum.samples || 0) }} 个样本</StatCard>
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
          <div class="split observability-grid reader-budget-grid" style="margin-top: 14px">
            <div>
              <h3 class="mini-title">浏览器 Web Vitals</h3>
              <ul class="mini-list">
                <li v-for="item in readerRumMetrics" :key="item.metric">
                  <span>{{ rumMetricLabel(item.metric) }}<br />p50 {{ rumValue(item) }} / p95 {{ rumP95(item) }} / {{ number(item.samples || 0) }} 次</span>
                  <strong :class="Number(item.poor || 0) > 0 ? 'danger-text' : ''">差 {{ number(item.poor || 0) }}</strong>
                </li>
                <li v-if="!readerRumMetrics.length"><span>暂无浏览器端样本</span><strong>empty</strong></li>
              </ul>
            </div>
            <div>
              <h3 class="mini-title">Reader 路由切换 p95</h3>
              <ul class="mini-list">
                <li v-for="item in readerRumRoutes" :key="item.route">
                  <span>{{ item.route || "unknown" }}</span>
                  <strong>{{ number(item.p95 || 0) }}ms · {{ number(item.samples || 0) }}</strong>
                </li>
                <li v-if="!readerRumRoutes.length"><span>暂无路由切换样本</span><strong>empty</strong></li>
              </ul>
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
              <span>{{ time(item.created_at) }} · {{ bytes(item.bytes) }}<template v-if="item.database"> · {{ item.database }}</template><template v-if="item.sha256"> · SHA-256 {{ item.sha256.slice(0, 12) }}</template><template v-if="item.archive_verified_at"> · 已验证 {{ number(item.archive_entries || 0) }} 项</template></span>
            </div>
            <button v-if="item.type === 'postgres'" class="secondary" type="button" :disabled="verifyBusy === item.file" @click="verifyBackup(item.file)">{{ verifyBusy === item.file ? "验证中..." : "验证归档" }}</button>
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
import { computed, inject, onMounted, reactive, ref } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { bytes, number, time, uptime } from "../utils/format";

const toast = inject("toast", () => {});
const confirmAction = inject("confirmAction", async () => ({ confirmed: false, reason: "" }));
const { user } = defineProps({ user: { type: Object, default: () => ({}) } });
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
const verifyBusy = ref("");
const metricsSummary = ref({ http: {}, reader_api: {}, bot_queue: {}, backup: {}, database: {}, crawler: {}, system_jobs: {}, window: {} });
const readerRum = ref({ metrics: [], routes: [], samples: 0, sessions: 0, users: 0 });
const apiTokens = ref([]);
const adminUsers = ref([]);
const adminRoles = reactive({});
const newAdmin = reactive({ username: "", password: "", role: "viewer" });
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
const readerRumMetrics = computed(() => readerRum.value.metrics || []);
const readerRumRoutes = computed(() => (readerRum.value.routes || []).slice(0, 10));

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

function rumMetricLabel(metric) {
  return ({ page_load: "首屏完成", ttfb: "TTFB", fcp: "FCP", lcp: "LCP", cls: "CLS", inp: "INP", route: "路由切换", long_task: "长任务" }[metric] || metric || "-");
}

function rumValue(item) {
  return item.metric === "cls" ? Number(item.p50 || 0).toFixed(3) : `${number(item.p50 || 0)}ms`;
}

function rumP95(item) {
  return item.metric === "cls" ? Number(item.p95 || 0).toFixed(3) : `${number(item.p95 || 0)}ms`;
}

async function loadStatus() {
  statusLoading.value = true;
  try {
    const data = await api("/admin-api/system/status");
    const version = data.version || {};
    const revision = String(version.build_revision || version.revision || "").slice(0, 12);
    const buildDate = formatBuildDate(version.build_date);
    versionLine.value = [version.image || "wenmoux/reader:v2.0", version.version || "-", revision, buildDate, `uptime ${uptime(version.uptime_seconds || 0)}`].filter(Boolean).join(" · ");
    statusRows.value = data.deep?.checks || data.status || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    statusLoading.value = false;
  }
}

function formatBuildDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toISOString().slice(0, 16).replace("T", " ");
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

async function verifyBackup(file) {
  if (!file) return;
  verifyBusy.value = file;
  try {
    const data = await api("/admin-api/backup/verify", {
      method: "POST",
      body: JSON.stringify({ file })
    });
    backupRows.value = data.backups || backupRows.value;
    toast(data.verification?.archive_entries ? `备份验证通过：${data.verification.archive_entries} 个归档项` : "备份验证通过");
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    verifyBusy.value = "";
  }
}

async function loadMetrics() {
  try {
    const [metrics, rum] = await Promise.all([
      api("/admin-api/metrics/summary"),
      api("/admin-api/reader-rum?days=7")
    ]);
    metricsSummary.value = metrics;
    readerRum.value = rum;
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function loadApiTokens() {
  try {
    const data = await api("/admin-api/system/api-tokens");
    apiTokens.value = data.rows || [];
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function revokeToken(token) {
  const confirmation = await confirmAction({
    title: "吊销内部 API Token",
    message: `将立即吊销 ${token.name || token.token_prefix || token.id}，使用该 Token 的 Bot 或上传脚本会停止工作。`,
    confirmLabel: "吊销 Token",
    phrase: `REVOKE ${token.id}`
  });
  if (!confirmation.confirmed) return;
  await api(`/admin-api/system/api-tokens/${token.id}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason: confirmation.reason })
  });
  await loadApiTokens();
  toast("Token 已吊销；请配置新 Token 后重启服务完成轮换");
}

async function loadAdminUsers() {
  if (user?.role !== "owner") return;
  try {
    const data = await api("/admin-api/auth/admins");
    adminUsers.value = data.rows || [];
    for (const admin of adminUsers.value) adminRoles[admin.id] = admin.role || "viewer";
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function createAdminUser() {
  await api("/admin-api/auth/admins", { method: "POST", body: JSON.stringify(newAdmin) });
  Object.assign(newAdmin, { username: "", password: "", role: "viewer" });
  await loadAdminUsers();
  toast("管理员已创建");
}

async function saveAdminRole(admin) {
  const role = adminRoles[admin.id];
  const confirmation = await confirmAction({
    title: "修改管理员角色",
    message: `将管理员 ${admin.username} 从 ${admin.role} 调整为 ${role}。`,
    confirmLabel: "保存角色"
  });
  if (!confirmation.confirmed) return;
  await api(`/admin-api/auth/admins/${admin.id}`, {
    method: "PUT",
    body: JSON.stringify({ role, reason: confirmation.reason })
  });
  await loadAdminUsers();
  toast("管理员角色已更新");
}

async function deleteAdminUser(admin) {
  const confirmation = await confirmAction({
    title: "删除管理员",
    message: `将永久删除管理员 ${admin.username}。`,
    confirmLabel: "删除管理员",
    phrase: `DELETE ${admin.id}`
  });
  if (!confirmation.confirmed) return;
  await api(`/admin-api/auth/admins/${admin.id}`, { method: "DELETE", body: JSON.stringify({ reason: confirmation.reason }) });
  await loadAdminUsers();
  toast("管理员已删除");
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
  const confirmation = await confirmAction({
    title: "重启服务",
    message: "重启期间后台、阅读器和 Bot 会短暂不可用，Docker 将按 restart 策略重新拉起容器。",
    confirmLabel: "重启服务",
    phrase: "RESTART"
  });
  if (!confirmation.confirmed) return;
  await api("/admin-api/system/restart", { method: "POST", body: JSON.stringify({ reason: confirmation.reason }) });
  toast("已发送重启请求");
}

function loadAll() {
  loadStatus();
  loadOverview();
  loadBackups();
  loadRemoteBackupStatus();
  loadMetrics();
  loadApiTokens();
  loadAdminUsers();
  loadLogs(logFilter.value);
  loadDiagnostics();
}

onMounted(loadAll);
</script>
