<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>书籍</h2>
        <p class="sub">筛选、维护元信息、查看章节缓存和导出 TXT。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="exportBooksCsv">导出 CSV</button>
        <button class="secondary" type="button" @click="loadBooks(page)">刷新</button>
        <button type="button" @click="openBookEditor()">新增书籍</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="toolbar">
          <label class="field">
            <span>搜索</span>
            <input v-model.trim="filters.q" placeholder="书名 / 作者 / ID / 标签" @keydown.enter="loadBooks(1)" />
          </label>
          <label class="field">
            <span>标签</span>
            <input v-model.trim="filters.tag" placeholder="标签" @keydown.enter="loadBooks(1)" />
          </label>
          <label class="field">
            <span>站别</span>
            <select v-model="filters.platform">
              <option value="">全部</option>
              <option v-for="item in platformOptions" :key="item.value" :value="item.value">
                {{ item.label || item.value }}{{ item.count ? ` (${number(item.count)})` : "" }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>排序</span>
            <select v-model="sortValue" @change="loadBooks(1)">
              <option value="updated_desc">更新时间 ↓</option>
              <option value="updated_asc">更新时间 ↑</option>
              <option value="book_id_asc">ID ↑</option>
              <option value="book_id_desc">ID ↓</option>
              <option value="chapters_desc">章节数 ↓</option>
              <option value="chapters_asc">章节数 ↑</option>
              <option value="cache_desc">缓存数 ↓</option>
              <option value="cache_asc">缓存数 ↑</option>
              <option value="complete_desc">完整度 ↓</option>
              <option value="complete_asc">完整度 ↑</option>
              <option value="popularity_desc">人气 ↓</option>
              <option value="popularity_asc">人气 ↑</option>
              <option value="title_asc">书名 A-Z</option>
              <option value="title_desc">书名 Z-A</option>
            </select>
          </label>
          <div class="row-actions">
            <button type="button" @click="loadBooks(1)">查询</button>
            <button class="danger secondary" type="button" @click="cleanupStaleBooks">清理旧 PO18</button>
          </div>
        </div>

        <div v-if="hotKeywords.length" class="tag-row" style="margin: 13px 0">
          <button v-for="row in hotKeywords" :key="row.keyword" class="secondary" type="button" @click="useKeyword(row.keyword)">
            {{ row.keyword }} · {{ number(row.count) }}
          </button>
        </div>

        <div class="bulk-bar">
          <label class="check-row">
            <input type="checkbox" :checked="allPageSelected" @change="togglePageSelection($event.target.checked)" />
            <span>本页全选</span>
          </label>
          <span class="sub">已选 {{ number(selectedRows.length) }} 本</span>
          <button class="secondary" type="button" :disabled="!selectedRows.length" @click="batchExportTxt">批量导出 TXT</button>
          <button class="secondary" type="button" :disabled="!selectedRows.length" @click="batchChangePlatform">批量改站别</button>
          <button class="danger secondary" type="button" :disabled="!selectedRows.length" @click="batchDeleteBooks">批量删除</button>
        </div>

        <DataTable
          :columns="bookColumns"
          :rows="books"
          :loading="loading"
          :sort-value="sortValue"
          empty-text="没有找到书籍"
          table-class="books-table"
          @sort="setSort"
        >
          <template #cell-select="{ row }">
            <input class="row-check" type="checkbox" :checked="isSelected(row)" @change="toggleRow(row)" />
          </template>
          <template #cell-book_id="{ row }"><code>{{ row.book_id }}</code></template>
          <template #cell-title="{ row }">
            <div class="book-title-cell">
              <strong>{{ row.title || row.book_id }}</strong>
              <small><code>{{ row.book_id }}</code></small>
            </div>
          </template>
          <template #cell-meta="{ row }">
            <div class="book-meta">
              <div>作者：{{ row.author || "-" }}</div>
              <div class="tag-row">
                <span class="tag">{{ row.platform || "-" }}</span>
                <span v-for="tag in splitTags(row.tags).slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
              </div>
              <small>上传者：{{ row.uploader || "-" }}{{ row.uploaderId ? ` / ${row.uploaderId}` : "" }}</small>
            </div>
          </template>
          <template #cell-counts="{ row }">
            <div class="metric-stack">
              <span>章节 <strong>{{ number(row.total_chapters ?? row.subscribed_chapters ?? 0) }}</strong></span>
              <span>缓存 <strong>{{ number(row.cache_count) }}</strong></span>
            </div>
          </template>
          <template #cell-heat="{ row }">
            <div class="metric-stack">
              <span>人气 <strong>{{ number(row.total_popularity) }}</strong></span>
              <span class="like">喜欢 <strong>{{ number(row.like_count) }}</strong></span>
              <span class="dislike">不喜 <strong>{{ number(row.dislike_count) }}</strong></span>
            </div>
          </template>
          <template #cell-updated_at="{ row }">{{ time(row.updated_at || row.created_at) }}</template>
          <template #cell-actions="{ row }">
            <div class="row-actions compact-actions">
              <button class="secondary" type="button" @click="openBookEditor(row)">改</button>
              <button class="secondary" type="button" @click="loadChapters(row.book_id, row.title)">查</button>
              <button class="secondary" type="button" @click="exportBookTxt(row.book_id)">TXT</button>
              <button class="danger secondary" type="button" @click="deleteBook(row)">删</button>
            </div>
          </template>
        </DataTable>

        <div class="pager">
          <button class="secondary" type="button" :disabled="page <= 1" @click="loadBooks(page - 1)">上一页</button>
          <span class="sub">第 {{ page }}/{{ totalPages }} 页，共 {{ number(total) }} 条</span>
          <button class="secondary" type="button" :disabled="page >= totalPages" @click="loadBooks(page + 1)">下一页</button>
        </div>
      </div>
    </section>

    <section v-if="currentBookId" class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">{{ currentBookTitle || currentBookId }} / {{ currentBookId }} 章节</p>
            <p class="section-desc">查看、编辑和删除当前书籍的缓存章节。</p>
          </div>
          <div class="row-actions">
            <button class="secondary" type="button" @click="exportBookTxt(currentBookId)">导出 TXT</button>
            <button class="secondary" type="button" @click="openChapterEditor()">新增</button>
            <button class="danger secondary" type="button" @click="deleteCurrentBookChapters">删除本书全部缓存</button>
          </div>
        </div>
        <DataTable :columns="chapterColumns" :rows="chapters" :loading="chaptersLoading" empty-text="这本书还没有章节缓存">
          <template #cell-chapter_id="{ row }"><code>{{ row.chapter_id }}</code></template>
          <template #cell-platform="{ row }">
            <span class="tag">{{ row.platform || "-" }}</span><br />
            <small>{{ row.detail_url || "" }}</small>
          </template>
          <template #cell-uploader="{ row }">
            上传者：{{ row.uploader || "-" }}<br />
            <small>上传者ID：{{ row.uploaderId || "" }}</small>
          </template>
          <template #cell-updated_at="{ row }">{{ row.updated_at || row.created_at || "-" }}</template>
          <template #cell-text="{ row }">{{ number(String(row.text || "").length) }} 字</template>
          <template #cell-actions="{ row }">
            <div class="row-actions">
              <button class="secondary" type="button" @click="openChapterEditor(row)">查看/改</button>
              <button class="danger secondary" type="button" @click="deleteChapter(row)">删</button>
            </div>
          </template>
        </DataTable>
      </div>
    </section>

    <FormModal
      :open="bookModal.open"
      :title="bookModal.title"
      :model="bookModal.model"
      :fields="bookFields"
      :textarea-fields="bookTextareaFields"
      @close="bookModal.open = false"
      @save="saveBook"
    />
    <FormModal
      :open="chapterModal.open"
      :title="chapterModal.title"
      :model="chapterModal.model"
      :fields="chapterFields"
      :textarea-fields="chapterTextareaFields"
      @close="chapterModal.open = false"
      @save="saveChapter"
    />
  </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import FormModal from "../components/FormModal.vue";
import { api } from "../services/api";
import { number, splitTags, time } from "../utils/format";

const toast = inject("toast", () => {});

const filters = reactive({ q: "", tag: "", platform: "" });
const sortValue = ref("updated_desc");
const books = ref([]);
const hotKeywords = ref([]);
const platformOptions = ref([
  { value: "po18", label: "PO18" },
  { value: "popo", label: "POPO" },
  { value: "fanqie", label: "番茄小说" },
  { value: "haitang", label: "海棠/龙马" }
]);
const loading = ref(false);
const page = ref(1);
const limit = ref(20);
const total = ref(0);
const currentBookId = ref("");
const currentBookTitle = ref("");
const chapters = ref([]);
const chaptersLoading = ref(false);
const selectedBookIds = ref(new Set());

const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(limit.value || 20))));
const selectedRows = computed(() => books.value.filter((book) => selectedBookIds.value.has(String(book.id))));
const allPageSelected = computed(() => books.value.length > 0 && books.value.every((book) => selectedBookIds.value.has(String(book.id))));

const bookColumns = [
  { key: "select", label: "选" },
  { key: "title", label: "书名", sort: "title_asc" },
  { key: "meta", label: "作者/站别/标签" },
  { key: "counts", label: "章节/缓存", sort: "chapters_desc" },
  { key: "heat", label: "人气/反馈", sort: "popularity_desc" },
  { key: "updated_at", label: "更新时间", sort: "updated_desc" },
  { key: "actions", label: "操作" }
];

const chapterColumns = [
  { key: "chapter_id", label: "章节ID" },
  { key: "title", label: "标题" },
  { key: "platform", label: "站别/来源" },
  { key: "uploader", label: "上传者" },
  { key: "updated_at", label: "上传/更新时间" },
  { key: "text", label: "内容" },
  { key: "actions", label: "操作" }
];

const bookFields = [
  { key: "book_id", label: "书籍ID" },
  { key: "title", label: "书名" },
  { key: "author", label: "作者" },
  { key: "platform", label: "站别" },
  { key: "cover", label: "封面" },
  { key: "category", label: "分类" },
  { key: "tags", label: "标签" },
  { key: "word_count", label: "字数", type: "number" },
  { key: "chapter_count", label: "章节数", type: "number" },
  { key: "total_chapters", label: "总章节", type: "number" },
  { key: "subscribed_chapters", label: "订阅章节", type: "number" },
  { key: "free_chapters", label: "免费章节", type: "number" },
  { key: "paid_chapters", label: "付费章节", type: "number" },
  { key: "status", label: "状态" },
  { key: "favorites_count", label: "收藏数", type: "number" },
  { key: "comments_count", label: "评论数", type: "number" },
  { key: "readers_count", label: "读者数", type: "number" },
  { key: "purchase_count", label: "购买数", type: "number" },
  { key: "daily_popularity", label: "日人气", type: "number" },
  { key: "weekly_popularity", label: "周人气", type: "number" },
  { key: "monthly_popularity", label: "月人气", type: "number" },
  { key: "total_popularity", label: "总人气", type: "number" },
  { key: "uploader", label: "上传者（非作者）" },
  { key: "uploaderId", label: "上传者ID（非作者ID）" },
  { key: "detail_url", label: "来源URL" },
  { key: "latest_chapter_name", label: "最新章节" },
  { key: "latest_chapter_date", label: "最新章节日期" },
  { key: "created_at", label: "创建时间（只读）", disabled: true },
  { key: "updated_at", label: "更新时间（保存时自动刷新）", disabled: true }
];
const bookNumericFields = [
  "word_count",
  "chapter_count",
  "total_chapters",
  "subscribed_chapters",
  "free_chapters",
  "paid_chapters",
  "favorites_count",
  "comments_count",
  "monthly_popularity",
  "total_popularity",
  "weekly_popularity",
  "readers_count",
  "daily_popularity",
  "purchase_count"
];
const bookTextareaFields = [
  { key: "description", label: "简介文本", rows: 7 },
  { key: "description_html", label: "简介 HTML", rows: 7 }
];
const chapterFields = [
  { key: "book_id", label: "书籍ID" },
  { key: "chapter_id", label: "章节ID" },
  { key: "title", label: "标题" },
  { key: "chapter_order", label: "排序", type: "number" },
  { key: "platform", label: "站别" },
  { key: "uploader", label: "上传者（非作者）" },
  { key: "uploaderId", label: "上传者ID（非作者ID）" }
];
const chapterTextareaFields = [
  { key: "text", label: "纯文本", rows: 10 },
  { key: "html", label: "HTML", rows: 10 }
];

const bookModal = reactive({ open: false, id: null, title: "", model: {} });
const chapterModal = reactive({ open: false, id: null, title: "", model: {} });

function oppositeSort(sort) {
  if (sort.endsWith("_desc")) return sort.replace("_desc", "_asc");
  if (sort.endsWith("_asc")) return sort.replace("_asc", "_desc");
  return sort;
}

function setSort(sort) {
  const opposite = oppositeSort(sort);
  sortValue.value = sortValue.value === sort ? opposite : sortValue.value === opposite ? sort : sort;
  loadBooks(1);
}

function restoreFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  filters.q = params.get("q") || "";
  filters.tag = params.get("tag") || "";
  filters.platform = params.get("platform") || "";
  sortValue.value = params.get("sort") || "updated_desc";
  const nextPage = Number(params.get("page") || 1);
  return Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 1;
}

function syncBooksUrl() {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.platform) params.set("platform", filters.platform);
  if (sortValue.value !== "updated_desc") params.set("sort", sortValue.value);
  if (page.value > 1) params.set("page", String(page.value));
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function isSelected(row) {
  return selectedBookIds.value.has(String(row.id));
}

function toggleRow(row) {
  const next = new Set(selectedBookIds.value);
  const id = String(row.id);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedBookIds.value = next;
}

function togglePageSelection(checked) {
  const next = new Set(selectedBookIds.value);
  books.value.forEach((book) => {
    const id = String(book.id);
    if (checked) next.add(id);
    else next.delete(id);
  });
  selectedBookIds.value = next;
}

function pruneSelectionToPage() {
  const pageIds = new Set(books.value.map((book) => String(book.id)));
  selectedBookIds.value = new Set([...selectedBookIds.value].filter((id) => pageIds.has(id)));
}

async function loadPlatforms() {
  try {
    const data = await api("/admin-api/config/platforms");
    if (Array.isArray(data.platforms) && data.platforms.length) platformOptions.value = data.platforms;
  } catch {
    // 平台映射不是书籍页的硬依赖。
  }
}

async function loadBooks(nextPage = 1) {
  loading.value = true;
  page.value = nextPage;
  try {
    const params = new URLSearchParams({
      q: filters.q,
      tag: filters.tag,
      platform: filters.platform,
      sort: sortValue.value,
      page: String(nextPage),
      limit: String(limit.value)
    });
    const [data, hot] = await Promise.all([
      api(`/admin-api/books?${params}`),
      api("/reader-api/hot-keywords?limit=16").catch(() => ({ rows: [] }))
    ]);
    books.value = data.rows || [];
    total.value = Number(data.total || 0);
    page.value = Number(data.page || nextPage);
    limit.value = Number(data.limit || limit.value);
    hotKeywords.value = hot.rows || [];
    pruneSelectionToPage();
    syncBooksUrl();
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

function useKeyword(keyword) {
  filters.q = keyword || "";
  loadBooks(1);
}

function exportBooksCsv() {
  const params = new URLSearchParams({
    q: filters.q,
    tag: filters.tag,
    platform: filters.platform,
    sort: sortValue.value
  });
  window.open(`/admin-api/books/export.csv?${params}`, "_blank");
}

async function batchExportTxt() {
  if (!selectedRows.value.length) return;
  if (selectedRows.value.length > 8 && !window.confirm(`将打开 ${selectedRows.value.length} 个 TXT 导出页面，继续？`)) return;
  selectedRows.value.forEach((row) => exportBookTxt(row.book_id));
}

async function batchChangePlatform() {
  if (!selectedRows.value.length) return;
  const platform = window.prompt("输入新的站别代码，例如 po18 / popo / fanqie / haitang", filters.platform || "po18");
  if (!platform) return;
  const label = platform.trim();
  if (!window.confirm(`确认把已选 ${selectedRows.value.length} 本的站别改为 ${label}？`)) return;
  for (const row of selectedRows.value) {
    await api(`/admin-api/books/${row.id}`, { method: "PUT", body: JSON.stringify({ platform: label }) });
  }
  selectedBookIds.value = new Set();
  await loadBooks(page.value);
  toast("已批量修正站别");
}

async function batchDeleteBooks() {
  if (!selectedRows.value.length) return;
  const choice = window.prompt(["请选择批量删除方式：", "1 = 仅删除元信息", "2 = 仅删除章节缓存", "3 = 全部删除", "", "输入 1、2 或 3"].join("\n"), "1");
  if (choice === null) return;
  const deleteMode = { 1: "metadata", 2: "cache", 3: "all" }[String(choice).trim()];
  if (!deleteMode) return toast("已取消：请输入 1、2 或 3");
  const labels = { metadata: "仅删除元信息", cache: "仅删除章节缓存", all: "全部删除" };
  if (!window.confirm(`确认对 ${selectedRows.value.length} 本执行：${labels[deleteMode]}？此操作不可恢复。`)) return;
  for (const row of selectedRows.value) {
    await api(`/admin-api/books/${row.id}?deleteMode=${deleteMode}`, { method: "DELETE" });
  }
  selectedBookIds.value = new Set();
  await loadBooks(Math.min(page.value, totalPages.value));
  toast(`已批量执行：${labels[deleteMode]}`);
}

function openBookEditor(row = null) {
  bookModal.id = row?.id || null;
  bookModal.title = row ? "修改书籍元信息" : "新增书籍元信息";
  bookModal.model = {
    book_id: row?.book_id ?? "",
    title: row?.title ?? "",
    author: row?.author ?? "",
    platform: row?.platform ?? "po18",
    cover: row?.cover ?? "",
    description: row?.description ?? "",
    tags: row?.tags ?? "",
    category: row?.category ?? "",
    word_count: row?.word_count ?? 0,
    chapter_count: row?.chapter_count ?? 0,
    status: row?.status ?? "",
    detail_url: row?.detail_url ?? "",
    created_at: row?.created_at ?? "",
    updated_at: row?.updated_at ?? "",
    total_chapters: row?.total_chapters ?? 0,
    subscribed_chapters: row?.subscribed_chapters ?? 0,
    free_chapters: row?.free_chapters ?? 0,
    paid_chapters: row?.paid_chapters ?? 0,
    latest_chapter_name: row?.latest_chapter_name ?? "",
    latest_chapter_date: row?.latest_chapter_date ?? "",
    favorites_count: row?.favorites_count ?? 0,
    comments_count: row?.comments_count ?? 0,
    monthly_popularity: row?.monthly_popularity ?? 0,
    total_popularity: row?.total_popularity ?? 0,
    uploader: row?.uploader ?? "",
    uploaderId: row?.uploaderId ?? "",
    description_html: row?.description_html ?? "",
    weekly_popularity: row?.weekly_popularity ?? 0,
    readers_count: row?.readers_count ?? 0,
    daily_popularity: row?.daily_popularity ?? 0,
    purchase_count: row?.purchase_count ?? 0
  };
  bookModal.open = true;
}

async function saveBook(form) {
  const body = { ...form };
  for (const key of bookNumericFields) body[key] = Number(body[key] || 0);
  if (!body.created_at) delete body.created_at;
  if (!body.updated_at) delete body.updated_at;
  await api(bookModal.id ? `/admin-api/books/${bookModal.id}` : "/admin-api/books", {
    method: bookModal.id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  bookModal.open = false;
  await loadBooks(page.value);
  toast("书籍已保存");
}

async function deleteBook(row) {
  const choice = window.prompt(["请选择删除方式：", "1 = 仅删除元信息", "2 = 仅删除章节缓存", "3 = 全部删除", "", "输入 1、2 或 3"].join("\n"), "1");
  if (choice === null) return;
  const deleteMode = { 1: "metadata", 2: "cache", 3: "all" }[String(choice).trim()];
  if (!deleteMode) return toast("已取消：请输入 1、2 或 3");
  const labels = { metadata: "仅删除元信息", cache: "仅删除章节缓存", all: "全部删除" };
  if (!window.confirm(`确认执行：${labels[deleteMode]}？此操作不可恢复。`)) return;
  await api(`/admin-api/books/${row.id}?deleteMode=${deleteMode}`, { method: "DELETE" });
  await loadBooks(page.value);
  if (String(currentBookId.value) === String(row.book_id)) {
    currentBookId.value = "";
    currentBookTitle.value = "";
    chapters.value = [];
  }
  toast(`已执行：${labels[deleteMode]}`);
}

async function cleanupStaleBooks() {
  try {
    const preview = await api("/admin-api/books/cleanup-stale/preview");
    if (!preview.metadataCount && !preview.bookCount && !preview.chapterCount) return toast("没有符合条件的旧 PO18 书籍");
    const sample = (preview.sample || [])
      .slice(0, 6)
      .map((book) => `- ${book.title || book.book_id || "-"} / ${book.book_id || "-"} / ${book.platform || "-"} / ${book.source_update_date || book.latest_chapter_date || "-"} / ${number(book.metadata_chapter_count || 0)}章`)
      .join("\n");
    const ok = window.confirm([
      `将删除 ${preview.platform || "po18"} 平台、原站更新时间早于 ${preview.cutoff}、章节数小于 ${number(preview.maxChapterCount)} 的书籍。`,
      "",
      `元信息：${number(preview.metadataCount)} 条`,
      `去重书籍：${number(preview.bookCount)} 本`,
      `章节缓存：${number(preview.chapterCount)} 章`,
      "",
      "样例：",
      sample || "-",
      "",
      "确认执行？此操作不可恢复。"
    ].join("\n"));
    if (!ok) return;
    const result = await api("/admin-api/books/cleanup-stale", {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    await loadBooks(1);
    toast(`已清理：元信息 ${number(result.deletedMetadata)}，章节 ${number(result.deletedChapters)}`);
  } catch (err) {
    toast(err.message || String(err));
  }
}

async function loadChapters(bookId, title) {
  currentBookId.value = String(bookId || "");
  currentBookTitle.value = String(title || "");
  chaptersLoading.value = true;
  try {
    const data = await api(`/admin-api/books/${encodeURIComponent(bookId)}/chapters`);
    chapters.value = data.rows || [];
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    chaptersLoading.value = false;
  }
}

function openChapterEditor(row = null) {
  if (!row && !currentBookId.value) return toast("请先打开一本书的章节列表");
  chapterModal.id = row?.id || null;
  chapterModal.title = row ? "章节查看/修改" : `新增章节 · ${currentBookTitle.value || currentBookId.value}`;
  chapterModal.model = {
    book_id: row?.book_id || currentBookId.value,
    chapter_id: row?.chapter_id || "",
    title: row?.title || "",
    chapter_order: row?.chapter_order || 0,
    platform: row?.platform || "po18",
    uploader: row?.uploader || "",
    uploaderId: row?.uploaderId || "",
    text: row?.text || "",
    html: row?.html || ""
  };
  chapterModal.open = true;
}

async function saveChapter(form) {
  const body = { ...form, chapter_order: Number(form.chapter_order || 0) };
  await api(chapterModal.id ? `/admin-api/chapters/${chapterModal.id}` : "/admin-api/chapters", {
    method: chapterModal.id ? "PUT" : "POST",
    body: JSON.stringify(body)
  });
  chapterModal.open = false;
  await loadChapters(body.book_id || currentBookId.value, currentBookTitle.value || body.book_id);
  toast("章节已保存");
}

async function deleteChapter(row) {
  if (!window.confirm("删除该章节缓存？")) return;
  await api(`/admin-api/chapters/${row.id}`, { method: "DELETE" });
  await loadChapters(currentBookId.value, currentBookTitle.value);
  toast("已删除章节");
}

async function deleteCurrentBookChapters() {
  if (!currentBookId.value) return toast("请先打开一本书的章节列表");
  if (!window.confirm(`删除《${currentBookTitle.value || currentBookId.value}》的全部章节缓存？元信息会保留。`)) return;
  const data = await api(`/admin-api/books/${encodeURIComponent(currentBookId.value)}/chapters`, { method: "DELETE" });
  await loadChapters(currentBookId.value, currentBookTitle.value);
  await loadBooks(page.value);
  toast(`已删除 ${number(data.deletedChapters ?? data.deleted ?? 0)} 章缓存`);
}

function exportBookTxt(bookId) {
  const id = String(bookId || "").trim();
  if (!id) return toast("缺少书籍ID");
  window.open(`/admin-api/books/${encodeURIComponent(id)}/export.txt`, "_blank");
}

onMounted(() => {
  const initialPage = restoreFiltersFromUrl();
  loadPlatforms();
  loadBooks(initialPage);
});
</script>
