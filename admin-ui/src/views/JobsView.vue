<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>任务中心</h2>
        <p class="sub">查看备份、恢复、榜单刷新、Bot 长任务和批量维护任务的执行状态。</p>
      </div>
      <div class="row-actions">
        <span class="sub" aria-live="polite">{{ autoRefreshing ? "有任务运行，自动刷新中" : "按需刷新" }} · 更新于 {{ lastUpdated || "-" }}</span>
        <button class="secondary" type="button" @click="loadAll">刷新</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">任务概览</p>
            <p class="section-desc">失败任务可在列表中查看错误；支持重试的任务会显示重试按钮。</p>
          </div>
        </div>
        <div class="dashboard">
          <StatCard label="全部任务" :value="number(overview.total || 0)">System Jobs {{ overview.available ? "已启用" : "未启用" }}</StatCard>
          <StatCard label="排队 / 运行" :value="`${number(statusCount('queued'))} / ${number(statusCount('running'))}`">Queued / Running</StatCard>
          <StatCard label="成功" :value="number(statusCount('succeeded'))">已完成任务</StatCard>
          <StatCard label="失败" :value="number(statusCount('failed'))">需要查看错误或重试</StatCard>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="toolbar compact job-toolbar">
          <label class="field">
            <span>状态</span>
            <select v-model="filters.status" @change="load(1)">
              <option value="">全部</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
            </select>
          </label>
          <label class="field">
            <span>类型</span>
            <input v-model.trim="filters.type" placeholder="backup:postgres / bot_export_txt" @keydown.enter="load(1)" />
          </label>
          <label class="field">
            <span>每页</span>
            <select v-model.number="filters.limit" @change="load(1)">
              <option :value="20">20</option>
              <option :value="30">30</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
          <button type="button" @click="load(1)">查询</button>
        </div>

        <DataTable
          :columns="columns"
          :rows="rows"
          :loading="loading"
          table-class="jobs-table"
          empty-text="暂无任务"
        >
          <template #cell-id="{ row }">
            <code>#{{ row.id }}</code>
          </template>
          <template #cell-type="{ row }">
            <div class="job-type-cell">
              <strong>{{ row.type || "-" }}</strong>
              <small>{{ row.created_by || "system" }}</small>
            </div>
          </template>
          <template #cell-status="{ row }">
            <span class="status-pill" :class="statusClass(row.status)">{{ row.status || "-" }}</span>
          </template>
          <template #cell-progress="{ row }">
            <div class="job-progress">
              <span :style="{ width: `${progress(row)}%` }"></span>
            </div>
            <small>{{ progress(row) }}%</small>
          </template>
          <template #cell-updated_at="{ row }">
            <span>{{ time(row.updated_at || row.created_at) }}</span>
            <small v-if="row.finished_at">完成：{{ time(row.finished_at) }}</small>
          </template>
          <template #cell-error="{ row }">
            <span class="job-error">{{ row.error || "-" }}</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="compact-actions">
              <button class="secondary" type="button" @click="selectJob(row.id)">查看</button>
              <button class="secondary" type="button" :disabled="!canRetry(row) || retryingId === row.id" @click="retryJob(row)">
                {{ retryingId === row.id ? "重试中" : "重试" }}
              </button>
              <button class="danger secondary" type="button" :disabled="!canCancel(row) || cancelingId === row.id" @click="cancelJob(row)">
                {{ cancelingId === row.id ? "取消中" : "取消" }}
              </button>
            </div>
          </template>
        </DataTable>

        <div class="pager">
          <button class="secondary" type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
          <span>第 {{ page }} / {{ totalPages }} 页，共 {{ number(total) }} 条</span>
          <button class="secondary" type="button" :disabled="page >= totalPages || loading" @click="load(page + 1)">下一页</button>
        </div>
      </div>
    </section>

    <section v-if="selectedJob" class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">任务 #{{ selectedJob.id }} 详情</p>
            <p class="section-desc">{{ selectedJob.type }} · {{ selectedJob.status }} · {{ progress(selectedJob) }}%</p>
          </div>
          <button class="secondary" type="button" @click="selectedJob = null">关闭</button>
        </div>
        <div class="job-detail-grid">
          <div>
            <h3 class="mini-title">输入</h3>
            <pre class="mini-log">{{ jsonBlock(selectedJob.input_json) }}</pre>
          </div>
          <div>
            <h3 class="mini-title">结果</h3>
            <pre class="mini-log">{{ jsonBlock(selectedJob.result_json) }}</pre>
          </div>
        </div>
        <div v-if="selectedJob.error" class="error-block">{{ selectedJob.error }}</div>
      </div>
    </section>
  </section>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue 生命周期、页面可见性、DataTable/StatCard、Admin Jobs API、格式化工具和全局确认服务
 * [OUTPUT]: 提供持久任务筛选、详情观察、运行期自动刷新以及受状态约束的重试/取消操作
 * [POS]: admin-ui/src/views 的异步任务控制台，跟随服务端状态机刷新且在页面隐藏时停止轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { number, time } from "../utils/format";

const toast = inject("toast", () => {});
const confirmAction = inject("confirmAction", async () => ({ confirmed: false, reason: "" }));
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const retryingId = ref(null);
const cancelingId = ref(null);
const selectedJob = ref(null);
const overview = ref({ byStatus: {} });
const filters = reactive({ status: "", type: "", limit: 30 });
const lastUpdated = ref("");
const autoRefreshing = ref(false);
let pollTimer = null;

const columns = [
  { key: "id", label: "ID" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" },
  { key: "progress", label: "进度" },
  { key: "updated_at", label: "更新时间" },
  { key: "error", label: "错误" },
  { key: "actions", label: "操作" }
];

const retryableTypes = new Set([
  "rank_refresh",
  "backup:postgres",
  "backup:database",
  "backup:pg",
  "backup:config",
  "backup:diagnostics",
  "restore:postgres",
  "books_cleanup_stale",
  "chapters_repair_order",
  "po18_crawler_run"
]);

const confirmRetryTypes = new Set(["restore:postgres", "books_cleanup_stale"]);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Number(filters.limit || 30))));

function statusCount(status) {
  return Number(overview.value.byStatus?.[status] || 0);
}

function statusClass(status) {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "fail";
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  return "skip";
}

function progress(row) {
  const value = Number(row?.progress || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function canRetry(row) {
  return ["failed", "canceled"].includes(String(row?.status || "")) && retryableTypes.has(String(row?.type || ""));
}

function canCancel(row) {
  return ["queued", "running"].includes(String(row?.status || ""));
}

function jsonBlock(value) {
  if (!value || (typeof value === "object" && !Object.keys(value).length)) return "{}";
  return JSON.stringify(value, null, 2);
}

async function loadOverview() {
  const data = await api("/admin-api/system/overview");
  overview.value = data.jobs || { byStatus: {} };
}

async function load(nextPage = page.value) {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(nextPage),
      limit: String(filters.limit || 30)
    });
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    const data = await api(`/admin-api/jobs?${params.toString()}`);
    rows.value = data.rows || [];
    total.value = Number(data.total || 0);
    page.value = Number(data.page || nextPage);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

async function loadAll() {
  await Promise.all([load(page.value), loadOverview().catch(() => {})]);
  lastUpdated.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  schedulePoll();
}

function hasActiveJobs() {
  return statusCount("queued") + statusCount("running") > 0;
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = null;
  autoRefreshing.value = hasActiveJobs() && !document.hidden;
  if (!autoRefreshing.value) return;
  pollTimer = window.setTimeout(() => loadAll(), 6000);
}

function handleVisibilityChange() {
  if (document.hidden) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
    autoRefreshing.value = false;
  } else {
    loadAll();
  }
}

async function selectJob(id) {
  try {
    const data = await api(`/admin-api/jobs/${encodeURIComponent(id)}`);
    selectedJob.value = data.job || null;
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function retryJob(row) {
  if (!canRetry(row)) return;
  const body = {};
  if (confirmRetryTypes.has(row.type)) {
    const expected = `RETRY ${row.id}`;
    const confirmation = await confirmAction({
      title: "重试高风险任务",
      message: `将重新执行任务 #${row.id}（${row.type}）。`,
      confirmLabel: "重试任务",
      phrase: expected
    });
    if (!confirmation.confirmed) return;
    body.confirm = expected;
    body.reason = confirmation.reason;
  } else {
    const confirmation = await confirmAction({
      title: "重试任务",
      message: `将重新执行任务 #${row.id}（${row.type}）。`,
      confirmLabel: "重试任务"
    });
    if (!confirmation.confirmed) return;
    body.reason = confirmation.reason;
  }
  retryingId.value = row.id;
  try {
    const data = await api(`/admin-api/jobs/${encodeURIComponent(row.id)}/retry`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    toast(data.job?.id ? `已完成重试任务 #${data.job.id}` : "任务重试已提交");
    await loadAll();
    if (data.job?.id) await selectJob(data.job.id);
  } catch (err) {
    toast(err.payload?.expectedConfirm ? `确认短语：${err.payload.expectedConfirm}` : err.message || String(err));
  } finally {
    retryingId.value = null;
  }
}

async function cancelJob(row) {
  if (!canCancel(row)) return;
  const confirmation = await confirmAction({
    title: "取消排队任务",
    message: `将取消排队任务 #${row.id}（${row.type}）。`,
    confirmLabel: "取消任务"
  });
  if (!confirmation.confirmed) return;
  cancelingId.value = row.id;
  try {
    const data = await api(`/admin-api/jobs/${encodeURIComponent(row.id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: confirmation.reason })
    });
    toast(data.job?.id ? `已取消任务 #${data.job.id}` : "任务已取消");
    await loadAll();
    if (data.job?.id) await selectJob(data.job.id);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    cancelingId.value = null;
  }
}

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  loadAll();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.clearTimeout(pollTimer);
});
</script>
