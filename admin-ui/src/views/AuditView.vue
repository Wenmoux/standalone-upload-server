<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>操作审计</h2>
        <p class="sub">后台写操作、执行结果、操作者和脱敏请求摘要。</p>
      </div>
      <button class="secondary" type="button" :disabled="loading" @click="load">刷新</button>
    </div>

    <section class="panel">
      <div class="section audit-filters">
        <label class="field"><span>管理员</span><input v-model.trim="filters.actor" placeholder="用户名" @keyup.enter="search" /></label>
        <label class="field"><span>动作</span><input v-model.trim="filters.action" placeholder="delete / restart" @keyup.enter="search" /></label>
        <label class="field">
          <span>方法</span>
          <select v-model="filters.method"><option value="">全部</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
        </label>
        <label class="field"><span>状态码</span><input v-model.trim="filters.status" inputmode="numeric" placeholder="200 / 400" @keyup.enter="search" /></label>
        <button type="button" @click="search">查询</button>
        <button class="secondary" type="button" @click="reset">清空</button>
      </div>
      <div class="section">
        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="暂无审计记录">
          <template #cell-actor="{ row }"><strong>{{ row.actor_username || "-" }}</strong><br /><small>{{ row.ip_address || "-" }}</small></template>
          <template #cell-action="{ row }"><code>{{ row.action }}</code><br /><small>{{ row.method }} {{ row.path }}</small></template>
          <template #cell-result="{ row }"><span class="tag" :class="row.status_code >= 400 ? 'danger-tag' : 'ok-tag'">{{ row.status_code }}</span><br /><small>{{ row.reason || "未填写原因" }}</small></template>
          <template #cell-request="{ row }"><code>{{ row.request_id || "-" }}</code></template>
          <template #cell-details="{ row }"><details><summary>查看</summary><pre class="audit-json">{{ pretty(row.details_json) }}</pre></details></template>
          <template #cell-created_at="{ row }">{{ formatTime(row.created_at) }}</template>
        </DataTable>
        <div class="pager audit-pager">
          <span>共 {{ total }} 条 · 第 {{ page }} 页</span>
          <button class="secondary" type="button" :disabled="page <= 1 || loading" @click="turn(-1)">上一页</button>
          <button class="secondary" type="button" :disabled="page * limit >= total || loading" @click="turn(1)">下一页</button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { api } from "../services/api";

const toast = inject("toast", () => {});
const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const limit = 50;
const filters = reactive({ actor: "", action: "", method: "", status: "" });
const columns = [
  { key: "id", label: "ID" },
  { key: "actor", label: "操作者 / IP" },
  { key: "action", label: "动作 / 路径" },
  { key: "result", label: "结果 / 原因" },
  { key: "request", label: "请求 ID" },
  { key: "details", label: "脱敏摘要" },
  { key: "created_at", label: "时间" }
];

function pretty(value) {
  return JSON.stringify(value || {}, null, 2);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const data = await api(`/admin-api/system/admin-audit?${params}`);
    rows.value = data.rows || [];
    total.value = Number(data.total || 0);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    loading.value = false;
  }
}

function search() { page.value = 1; load(); }
function reset() { Object.assign(filters, { actor: "", action: "", method: "", status: "" }); search(); }
function turn(delta) { page.value = Math.max(1, page.value + delta); load(); }

onMounted(load);
</script>
