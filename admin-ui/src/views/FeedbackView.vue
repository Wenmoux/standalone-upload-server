<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>反馈统计</h2>
        <p class="sub">热词来自搜索记录，反馈来自 Bot 详情页喜欢/不喜欢；缺书需求来自 Bot 搜索无结果后的主动提交。</p>
      </div>
      <button class="secondary" type="button" @click="load">刷新</button>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">热词与反馈</p>
            <p class="section-desc">点击表头可切换排序。</p>
          </div>
        </div>
        <div class="word-cloud">
          <span v-if="!hotWords.length" class="sub">暂无热词</span>
          <button
            v-for="row in hotWords"
            :key="row.keyword"
            type="button"
            :style="wordStyle(row)"
            @click="navigate('books')"
          >
            {{ row.keyword }}<small>{{ number(row.count) }}</small>
          </button>
        </div>
        <DataTable
          :columns="feedbackColumns"
          :rows="sortedFeedback"
          :loading="loading"
          :sort-value="sortValue"
          empty-text="暂无反馈"
          @sort="setSort"
        >
          <template #cell-book_id="{ row }"><code>{{ row.book_id }}</code></template>
          <template #cell-title="{ row }"><div class="book-title-cell"><strong>{{ row.title || "-" }}</strong><small>{{ row.author || "" }}</small></div></template>
          <template #cell-platform="{ row }"><span class="tag">{{ row.platform || "-" }}</span></template>
          <template #cell-like_count="{ row }"><span class="metric like"><strong>{{ number(row.like_count) }}</strong></span></template>
          <template #cell-dislike_count="{ row }"><span class="metric dislike"><strong>{{ number(row.dislike_count) }}</strong></span></template>
          <template #cell-feedback_users="{ row }">{{ number(row.feedback_users) }}</template>
          <template #cell-latest_at="{ row }">{{ time(row.latest_at) }}</template>
        </DataTable>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">缺书需求</p>
            <p class="section-desc">
              Bot 搜索无结果后用户点击提交产生；共 {{ number(requestSummary.total || 0) }} 次，
              {{ number(requestSummary.keywords || 0) }} 个关键词，{{ number(requestSummary.users || 0) }} 位用户。
            </p>
          </div>
        </div>
        <DataTable :columns="requestColumns" :rows="searchRequests" :loading="loading" empty-text="暂无缺书需求">
          <template #cell-query="{ row }"><strong>{{ row.clean_query || row.query }}</strong></template>
          <template #cell-platform="{ row }"><span class="tag">{{ row.platform || "全部" }}</span></template>
          <template #cell-search_type="{ row }">{{ row.search_type || "search" }}</template>
          <template #cell-status="{ row }"><span class="status-pill" :class="`status-${row.status || 'pending'}`">{{ requestStatusLabel(row.status) }}</span></template>
          <template #cell-submit_count="{ row }"><span class="metric like"><strong>{{ number(row.submit_count) }}</strong></span></template>
          <template #cell-user_count="{ row }">{{ number(row.user_count) }}</template>
          <template #cell-latest_user="{ row }">{{ latestUser(row) }}</template>
          <template #cell-latest_at="{ row }">{{ time(row.latest_at) }}</template>
          <template #cell-actions="{ row }">
            <div class="inline-actions compact-actions">
              <button class="secondary" type="button" @click="setRequestStatus(row, 'accepted')">接受</button>
              <button class="secondary" type="button" @click="setRequestStatus(row, 'crawling')">抓取中</button>
              <button type="button" @click="openResolve(row)">已缓存</button>
              <button class="danger" type="button" @click="setRequestStatus(row, 'rejected')">驳回</button>
            </div>
          </template>
        </DataTable>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">众筹榜</p>
            <p class="section-desc">Bot 众筹投票统计，每次支持消耗 100 银币。</p>
          </div>
        </div>
        <DataTable :columns="crowdColumns" :rows="crowdRows" :loading="loading" empty-text="暂无众筹投票">
          <template #cell-rank="{ row }"><strong>#{{ number(row.rank) }}</strong></template>
          <template #cell-book_id="{ row }"><code>{{ row.book_id }}</code></template>
          <template #cell-title="{ row }"><div class="book-title-cell"><strong>{{ row.title || "-" }}</strong><small>{{ row.author || "" }}</small></div></template>
          <template #cell-supporter_count="{ row }"><span class="metric like"><strong>{{ number(row.supporter_count) }}</strong></span></template>
          <template #cell-total_silver="{ row }">{{ number(row.total_silver) }}</template>
          <template #cell-latest_vote_at="{ row }">{{ time(row.latest_vote_at) }}</template>
        </DataTable>
      </div>
    </section>

    <FormModal
      :open="resolveOpen"
      title="完成缺书需求"
      :model="resolveForm"
      :fields="resolveFields"
      :textarea-fields="resolveTextareaFields"
      :checks="resolveChecks"
      save-label="标记已缓存并通知"
      @close="resolveOpen = false"
      @save="saveResolution"
    />
  </section>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import FormModal from "../components/FormModal.vue";
import { api } from "../services/api";
import { number, time } from "../utils/format";

const toast = inject("toast", () => {});
const navigate = inject("navigate", () => {});
const loading = ref(false);
const feedbackRows = ref([]);
const crowdRows = ref([]);
const hotWords = ref([]);
const searchRequests = ref([]);
const requestSummary = ref({});
const sortValue = ref("like_desc");
const resolveOpen = ref(false);
const resolveRow = ref(null);
const resolveForm = ref({ book_id: "", note: "", notify: true });
const resolveFields = [{ key: "book_id", label: "已缓存书号", placeholder: "必填" }];
const resolveTextareaFields = [{ key: "note", label: "处理说明", rows: 4, placeholder: "可选，会随通知发送" }];
const resolveChecks = [{ key: "notify", label: "通知此前提交过该需求的 Telegram 用户" }];

const feedbackColumns = [
  { key: "book_id", label: "书号" },
  { key: "title", label: "书名/作者" },
  { key: "platform", label: "站别" },
  { key: "like_count", label: "喜欢", sort: "like_desc" },
  { key: "dislike_count", label: "不喜欢", sort: "dislike_desc" },
  { key: "feedback_users", label: "用户数", sort: "users_desc" },
  { key: "latest_at", label: "最近反馈", sort: "time_desc" }
];
const crowdColumns = [
  { key: "rank", label: "排名" },
  { key: "book_id", label: "书号" },
  { key: "title", label: "书名/作者" },
  { key: "supporter_count", label: "支持人数" },
  { key: "total_silver", label: "银币" },
  { key: "latest_vote_at", label: "最近支持" }
];
const requestColumns = [
  { key: "query", label: "搜索词" },
  { key: "platform", label: "站别" },
  { key: "search_type", label: "类型" },
  { key: "status", label: "状态" },
  { key: "submit_count", label: "提交次数" },
  { key: "user_count", label: "用户数" },
  { key: "latest_user", label: "最近用户" },
  { key: "latest_at", label: "最近提交" },
  { key: "actions", label: "处理" }
];

const sortedFeedback = computed(() => {
  const direction = sortValue.value.endsWith("_asc") ? 1 : -1;
  const key = sortValue.value.replace(/_(asc|desc)$/, "");
  const valueOf = (row) => {
    if (key === "like") return Number(row.like_count || 0);
    if (key === "dislike") return Number(row.dislike_count || 0);
    if (key === "users") return Number(row.feedback_users || 0);
    if (key === "time") return new Date(row.latest_at || 0).getTime() || 0;
    return Number(row.like_count || 0);
  };
  return [...feedbackRows.value].sort((a, b) => {
    const diff = valueOf(a) - valueOf(b);
    if (diff) return diff * direction;
    return String(a.book_id || "").localeCompare(String(b.book_id || ""), "zh-CN");
  });
});

function setSort(sort) {
  const asc = sort.endsWith("_asc") ? sort : sort.replace("_desc", "_asc");
  const desc = sort.endsWith("_desc") ? sort : sort.replace("_asc", "_desc");
  sortValue.value = sortValue.value === desc ? asc : desc;
}

function wordStyle(row) {
  const max = Math.max(...hotWords.value.map((item) => Number(item.count || 0)), 1);
  const count = Number(row.count || 0);
  return {
    fontSize: `${13 + Math.round((count / max) * 17)}px`,
    fontWeight: count > max * 0.55 ? 900 : count > max * 0.25 ? 800 : 700
  };
}

function latestUser(row = {}) {
  const username = row.latest_telegram_username ? `@${row.latest_telegram_username}` : "";
  return row.latest_nickname || username || row.latest_telegram_id || "-";
}

function requestStatusLabel(value) {
  return ({ pending: "待处理", accepted: "已接受", crawling: "抓取中", cached: "已缓存", rejected: "已驳回" }[value] || "待处理");
}

function requestPayload(row, status, extra = {}) {
  return {
    query: row.query,
    platform: row.platform || "",
    search_type: row.search_type || "search",
    status,
    ...extra
  };
}

async function setRequestStatus(row, status) {
  try {
    await api("/admin-api/search-requests/resolve", {
      method: "POST",
      body: JSON.stringify(requestPayload(row, status, { notify: false }))
    });
    toast(`缺书需求已标记为${requestStatusLabel(status)}`);
    await load();
  } catch (err) {
    toast(err.message || String(err));
  }
}

function openResolve(row) {
  resolveRow.value = row;
  resolveForm.value = { book_id: "", note: "", notify: true };
  resolveOpen.value = true;
}

async function saveResolution(form) {
  const row = resolveRow.value;
  if (!row) return;
  try {
    const result = await api("/admin-api/search-requests/resolve", {
      method: "POST",
      body: JSON.stringify(requestPayload(row, "cached", form))
    });
    resolveOpen.value = false;
    resolveRow.value = null;
    const sent = number(result.notification?.sent || 0);
    const failed = number(result.notification?.failed || 0);
    toast(`已标记缓存，通知成功 ${sent}，失败 ${failed}`);
    await load();
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function load() {
  loading.value = true;
  try {
    const [feedback, hot, crowd, requests] = await Promise.all([
      api("/admin-api/book-feedback?limit=120"),
      api("/reader-api/hot-keywords?limit=40").catch(() => ({ rows: [] })),
      api("/admin-api/book-crowd?limit=120"),
      api("/admin-api/search-requests?limit=120")
    ]);
    feedbackRows.value = feedback.rows || [];
    hotWords.value = hot.rows || [];
    crowdRows.value = crowd.rows || [];
    searchRequests.value = requests.rows || [];
    requestSummary.value = requests.summary || {};
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
