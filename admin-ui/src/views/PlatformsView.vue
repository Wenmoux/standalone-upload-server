<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>平台映射</h2>
        <p class="sub">自动扫描书籍和章节里的 platform，只填写要显示的中文名。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="load">重新扫描</button>
        <button type="button" @click="save">保存映射</button>
      </div>
    </div>
    <section class="panel">
      <div class="section">
        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="还没有扫描到平台" row-key="value">
          <template #cell-value="{ row }"><code>{{ row.value }}</code></template>
          <template #cell-label="{ row }">
            <input v-model="labels[row.value]" placeholder="填写中文名" />
          </template>
          <template #cell-count="{ row }">{{ number(row.count) }}</template>
          <template #cell-source="{ row }">{{ row.configured ? "手动配置" : row.defaultLabel ? "内置默认" : "数据库扫描" }}</template>
        </DataTable>
      </div>
    </section>
  </section>
</template>

<script setup>
import { inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { api } from "../services/api";
import { number } from "../utils/format";

const toast = inject("toast", () => {});
const rows = ref([]);
const labels = reactive({});
const loading = ref(false);
const columns = [
  { key: "value", label: "平台代码" },
  { key: "label", label: "中文显示名" },
  { key: "count", label: "库内数量" },
  { key: "source", label: "来源" }
];

async function load() {
  loading.value = true;
  try {
    const data = await api("/admin-api/config/platforms");
    rows.value = data.platforms || [];
    Object.keys(labels).forEach((key) => delete labels[key]);
    rows.value.forEach((row) => {
      labels[row.value] = row.label || row.value;
    });
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

async function save() {
  const body = {};
  Object.entries(labels).forEach(([key, label]) => {
    if (key && String(label || "").trim()) body[key] = String(label).trim();
  });
  await api("/admin-api/config/platforms", {
    method: "PUT",
    body: JSON.stringify({ labels: body })
  });
  await load();
  toast("平台映射已保存");
}

onMounted(load);
</script>
