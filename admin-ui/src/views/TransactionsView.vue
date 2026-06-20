<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>币流水</h2>
        <p class="sub">按 Telegram ID、类型和币种筛选交易记录。</p>
      </div>
      <button class="secondary" type="button" @click="load(page)">刷新</button>
    </div>
    <section class="panel">
      <div class="section">
        <div class="toolbar compact">
          <label class="field">
            <span>Telegram ID</span>
            <input v-model.trim="filters.telegram_id" placeholder="用户 Telegram ID" @keydown.enter="load(1)" />
          </label>
          <label class="field">
            <span>类型</span>
            <input v-model.trim="filters.type" placeholder="sign / export_unlock" @keydown.enter="load(1)" />
          </label>
          <label class="field">
            <span>币种</span>
            <select v-model="filters.currency">
              <option value="">全部</option>
              <option value="copper">铜币</option>
              <option value="silver">银币</option>
              <option value="exp">经验</option>
            </select>
          </label>
          <button class="secondary" type="button" @click="exportTransactionsCsv">CSV Export</button>

          <button type="button" @click="load(1)">查询</button>
        </div>

        <DataTable :columns="columns" :rows="rows" :loading="loading" empty-text="暂无流水">
          <template #cell-id="{ row }"><code>{{ row.id }}</code></template>
          <template #cell-user="{ row }">{{ row.nickname || row.username || "-" }}<br v-if="row.telegram_id" /><small v-if="row.telegram_id">TG {{ row.telegram_id }}</small></template>
          <template #cell-currency="{ row }">{{ currencyLabel(row.currency) }}</template>
          <template #cell-amount="{ row }">
            <span class="metric" :class="Number(row.amount || 0) >= 0 ? 'like' : 'dislike'">
              <strong>{{ Number(row.amount || 0) > 0 ? `+${number(row.amount)}` : number(row.amount) }}</strong>
            </span>
          </template>
          <template #cell-balance="{ row }">{{ number(row.balance) }}</template>
          <template #cell-source="{ row }">{{ row.source || "-" }}<br /><small>{{ time(row.created_at) }}</small></template>
        </DataTable>

        <div class="pager">
          <button class="secondary" type="button" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
          <span class="sub">第 {{ page }}/{{ totalPages }} 页，共 {{ number(total) }} 条</span>
          <button class="secondary" type="button" :disabled="page >= totalPages" @click="load(page + 1)">下一页</button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { api } from "../services/api";
import { currencyLabel, number, time } from "../utils/format";

const toast = inject("toast", () => {});
const filters = reactive({ telegram_id: "", type: "", currency: "" });
const rows = ref([]);
const loading = ref(false);
const page = ref(1);
const limit = ref(80);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(limit.value || 80))));

const columns = [
  { key: "id", label: "ID" },
  { key: "user", label: "用户" },
  { key: "type", label: "类型" },
  { key: "currency", label: "币种" },
  { key: "amount", label: "变化" },
  { key: "balance", label: "余额" },
  { key: "detail", label: "详情" },
  { key: "source", label: "来源/时间" }
];

async function load(nextPage = 1) {
  loading.value = true;
  page.value = nextPage;
  try {
    const params = new URLSearchParams({
      page: String(nextPage),
      limit: String(limit.value),
      telegram_id: filters.telegram_id,
      type: filters.type,
      currency: filters.currency
    });
    const data = await api(`/admin-api/transactions?${params}`);
    rows.value = data.rows || [];
    total.value = Number(data.total || 0);
    page.value = Number(data.page || nextPage);
    limit.value = Number(data.limit || limit.value);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

function exportTransactionsCsv() {
  const params = new URLSearchParams({
    telegram_id: filters.telegram_id,
    type: filters.type,
    currency: filters.currency,
    limit: "10000"
  });
  window.open(`/admin-api/transactions/export.csv?${params}`, "_blank");
}

onMounted(() => load(1));
</script>
