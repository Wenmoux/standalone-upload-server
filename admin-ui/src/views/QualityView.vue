<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>数据质量</h2>
        <p class="sub">检查重复书籍、缺章节、缺封面、平台异常和大体积章节。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="load">刷新</button>
        <button type="button" :disabled="repairingOrder" @click="repairChapterOrder">
          {{ repairingOrder ? "修复中..." : "修复章节顺序" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-block">{{ error }}</div>
    <div v-else-if="loading" class="panel"><div class="section">加载中...</div></div>
    <template v-else>
      <section class="panel">
        <div class="section">
          <div class="section-head">
            <div>
              <p class="section-title">质量摘要</p>
              <p class="section-desc">阈值：长期未更新 {{ thresholds.stale_days }} 天；大章节 {{ bytes(thresholds.large_chapter_bytes) }} 以上。</p>
            </div>
          </div>
          <div class="dashboard">
            <StatCard label="去重书籍" :value="number(summary.books)">按 book_id 取最新记录</StatCard>
            <StatCard label="缓存覆盖率" :value="`${number(summary.coverage_percent)}%`">按总章节/订阅章节估算</StatCard>
            <StatCard label="缺章节书籍" :value="number(summary.missing_chapter_books)">缓存章节少于元信息预期</StatCard>
            <StatCard label="重复书籍" :value="number(summary.duplicate_books)">book_metadata 中同 book_id 多条</StatCard>
            <StatCard label="无封面" :value="number(summary.no_cover)">cover 为空</StatCard>
            <StatCard label="无简介" :value="number(summary.no_description)">description 为空</StatCard>
            <StatCard label="平台异常" :value="number(summary.platform_abnormal)">platform 为空或过长</StatCard>
            <StatCard label="大章节" :value="number(summary.large_chapters)">HTML/TXT 体积异常</StatCard>
          </div>
        </div>
      </section>

      <section class="quality-grid">
        <QualityPanel title="缺章节 / 覆盖率低" :rows="samples.missing_chapters" :columns="missingColumns">
          <template #cell-coverage_percent="{ value }">{{ number(value) }}%</template>
        </QualityPanel>
        <QualityPanel title="重复书籍" :rows="samples.duplicate_books" :columns="duplicateColumns" />
        <QualityPanel title="无封面" :rows="samples.no_cover" :columns="bookColumns" />
        <QualityPanel title="无简介" :rows="samples.no_description" :columns="bookColumns" />
        <QualityPanel title="平台字段异常" :rows="samples.platform_abnormal" :columns="bookColumns" />
        <QualityPanel title="章节顺序重复" :rows="samples.duplicate_orders" :columns="orderColumns" />
        <QualityPanel title="长期未更新" :rows="samples.stale_books" :columns="bookColumns">
          <template #cell-updated_at="{ value }">{{ time(value) }}</template>
        </QualityPanel>
        <QualityPanel title="大体积异常章节" :rows="samples.large_chapters" :columns="largeColumns">
          <template #cell-bytes="{ value }">{{ bytes(value) }}</template>
          <template #cell-updated_at="{ value }">{{ time(value) }}</template>
        </QualityPanel>
      </section>
    </template>
  </section>
</template>

<script setup>
import { defineComponent, h, inject, onMounted, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { bytes, number, time } from "../utils/format";

const toast = inject("toast", () => {});
const QualityPanel = defineComponent({
  name: "QualityPanel",
  props: {
    title: { type: String, required: true },
    rows: { type: Array, default: () => [] },
    columns: { type: Array, required: true }
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "panel quality-panel" }, [
        h("div", { class: "section" }, [
          h("div", { class: "section-head" }, [
            h("div", null, [
              h("p", { class: "section-title" }, props.title),
              h("p", { class: "section-desc" }, props.rows.length ? `显示 ${props.rows.length} 条样例` : "暂无异常样例")
            ])
          ]),
          h(
            DataTable,
            { columns: props.columns, rows: props.rows, rowKey: "book_id", emptyText: "暂无异常" },
            slots
          )
        ])
      ]);
  }
});

const loading = ref(true);
const error = ref("");
const summary = ref({});
const samples = ref({});
const thresholds = ref({});
const repairingOrder = ref(false);

const bookColumns = [
  { key: "book_id", label: "书号" },
  { key: "title", label: "书名" },
  { key: "platform", label: "站点" },
  { key: "updated_at", label: "更新时间" }
];
const duplicateColumns = [
  { key: "book_id", label: "书号" },
  { key: "title", label: "书名" },
  { key: "duplicates", label: "重复数" }
];
const missingColumns = [
  { key: "book_id", label: "书号" },
  { key: "title", label: "书名" },
  { key: "expected_chapters", label: "预期" },
  { key: "cached_chapters", label: "缓存" },
  { key: "missing_chapters", label: "缺口" },
  { key: "coverage_percent", label: "覆盖率" }
];
const orderColumns = [
  { key: "book_id", label: "书号" },
  { key: "chapter_order", label: "顺序号" },
  { key: "duplicates", label: "重复数" }
];
const largeColumns = [
  { key: "book_id", label: "书号" },
  { key: "chapter_id", label: "章节" },
  { key: "title", label: "标题" },
  { key: "bytes", label: "体积" },
  { key: "updated_at", label: "更新时间" }
];

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await api("/admin-api/data-quality");
    summary.value = data.summary || {};
    samples.value = data.samples || {};
    thresholds.value = data.thresholds || {};
  } catch (err) {
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

async function repairChapterOrder() {
  repairingOrder.value = true;
  try {
    const preview = await api("/admin-api/chapters/repair-order/preview?limit=50");
    const rows = preview.rows || [];
    if (!rows.length) return toast("没有需要修复的章节顺序");
    const sample = rows
      .slice(0, 6)
      .map((row) => `- ${row.title || row.book_id} / ${row.book_id} / ${row.platform || "-"} / ${number(row.affected_chapters)} 章`)
      .join("\n");
    const ok = window.confirm([
      `将修复 ${number(rows.length)} 本书的重复章节顺序。`,
      "",
      "样例：",
      sample || "-",
      "",
      "确认执行？执行后可在任务中心查看记录。"
    ].join("\n"));
    if (!ok) return;
    const result = await api("/admin-api/chapters/repair-order", {
      method: "POST",
      body: JSON.stringify({ confirm: true, limit: 50 })
    });
    toast(`章节顺序已修复：${number(result.updatedChapters || 0)} 章`);
    await load();
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    repairingOrder.value = false;
  }
}

onMounted(load);
</script>
