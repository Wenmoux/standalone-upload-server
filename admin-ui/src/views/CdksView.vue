<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>CDK</h2>
        <p class="sub">生成和管理读者注册码。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="load">刷新</button>
        <button class="secondary" type="button" @click="exportCsv">导出 CSV</button>
      </div>
    </div>
    <section class="panel">
      <div class="section">
        <div class="toolbar compact">
          <label class="field">
            <span>时长</span>
            <select v-model="duration">
              <option value="7d">7天</option>
              <option value="30d">30天</option>
              <option value="365d">一年</option>
              <option value="permanent">永久</option>
            </select>
          </label>
          <label class="field">
            <span>数量</span>
            <input v-model.number="count" type="number" min="1" max="100" />
          </label>
          <label class="field">
            <span>使用状态</span>
            <select v-model="statusFilter" @change="load">
              <option value="">全部</option>
              <option value="unused">未使用</option>
              <option value="used">已使用</option>
            </select>
          </label>
          <button type="button" @click="generate">生成 CDK</button>
        </div>
        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="暂无 CDK">
          <template #cell-id="{ row }"><code>{{ row.id }}</code></template>
          <template #cell-code="{ row }"><code>{{ row.code }}</code></template>
          <template #cell-duration="{ row }">{{ durationLabel(row) }}</template>
          <template #cell-status="{ row }">
            <span v-if="!row.used_by" class="tag success">未使用</span>
            <span v-else>已使用：{{ row.used_username || row.used_by }}<br /><small>{{ time(row.used_at) }}</small></span>
          </template>
          <template #cell-created="{ row }">{{ row.created_by || "-" }}<br /><small>{{ time(row.created_at) }}</small></template>
          <template #cell-actions="{ row }"><button class="danger secondary" type="button" @click="remove(row)">删除</button></template>
        </DataTable>
      </div>
    </section>
  </section>
</template>

<script setup>
import { inject, onMounted, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { api } from "../services/api";
import { durationLabel, time } from "../utils/format";

const toast = inject("toast", () => {});
const rows = ref([]);
const loading = ref(false);
const duration = ref("7d");
const count = ref(1);
const statusFilter = ref("");
const columns = [
  { key: "id", label: "ID" },
  { key: "code", label: "CDK" },
  { key: "duration", label: "时长" },
  { key: "status", label: "状态" },
  { key: "created", label: "创建" },
  { key: "actions", label: "操作" }
];

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ status: statusFilter.value });
    const data = await api(`/admin-api/cdks?${params}`);
    rows.value = data.rows || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

async function generate() {
  await api("/admin-api/cdks", {
    method: "POST",
    body: JSON.stringify({ duration_type: duration.value, count: Number(count.value || 1) })
  });
  await load();
  toast("CDK 已生成");
}

async function remove(row) {
  if (!window.confirm("删除该 CDK？")) return;
  await api(`/admin-api/cdks/${row.id}`, { method: "DELETE" });
  await load();
  toast("已删除 CDK");
}

function exportCsv() {
  const params = new URLSearchParams({ status: statusFilter.value });
  window.open(`/admin-api/cdks/export.csv?${params}`, "_blank");
}

onMounted(load);
</script>
