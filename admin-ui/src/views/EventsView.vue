<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>更新记录</h2>
        <p class="sub">最近上传、修改和删除事件。</p>
      </div>
      <button class="secondary" type="button" @click="load">刷新</button>
    </div>
    <section class="panel">
      <div class="section">
        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="暂无更新记录">
          <template #cell-id="{ row }"><code>{{ row.id }}</code></template>
          <template #cell-book="{ row }">
            {{ row.book_id || "" }}<br />
            <small v-if="row.chapter_id">{{ row.chapter_id }}</small>
          </template>
          <template #cell-source="{ row }">
            {{ row.source || "" }}<br />
            <span class="tag">{{ row.platform || "-" }}</span>
          </template>
          <template #cell-uploader="{ row }">
            上传者：{{ row.uploader || "-" }}<br />
            <small>上传者ID：{{ row.uploader_id || "" }}</small>
          </template>
        </DataTable>
      </div>
    </section>
  </section>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、DataTable、Admin 事件 API 与全局提示服务
 * [OUTPUT]: 提供最近上传、修改和删除事件的只读列表页面
 * [POS]: admin-ui/src/views 的内容变更观察视图，为运维定位书库变化提供时间线
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { inject, onMounted, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { api } from "../services/api";

const toast = inject("toast", () => {});
const loading = ref(false);
const rows = ref([]);
const columns = [
  { key: "id", label: "ID" },
  { key: "event_type", label: "类型" },
  { key: "action", label: "动作" },
  { key: "book", label: "书籍/章节" },
  { key: "title", label: "标题" },
  { key: "source", label: "来源/站别" },
  { key: "uploader", label: "上传者" },
  { key: "created_at", label: "时间" },
  { key: "telegram_status", label: "TG" }
];

async function load() {
  loading.value = true;
  try {
    const data = await api("/admin-api/events?limit=80");
    rows.value = data.rows || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
