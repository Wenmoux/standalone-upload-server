<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>书籍</h2>
        <p class="sub">筛选、维护元信息、查看章节缓存和导出 TXT。</p>
      </div>
      <div class="row-actions">
        <input ref="manifestInput" type="file" accept="application/json,.json" style="display: none" @change="importManifestFile" />
        <button class="secondary" type="button" @click="manifestInput?.click()">导入 Manifest</button>
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
            <input v-model.trim="filters.q" placeholder="书名 / 作者 / ID / 标签 / 分类" @keydown.enter="loadBooks(1)" />
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

        <div v-if="categoryOptions.length" class="filter-row category-filter-row">
          <button
            v-for="row in categoryOptions"
            :key="row.category"
            class="secondary"
            :class="{ active: filters.category === row.category }"
            type="button"
            @click="toggleCategory(row.category)"
          >
            {{ row.category }} · {{ number(row.count) }}
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
            <input class="row-check" type="checkbox" :checked="isSelected(row)" :aria-label="`选择《${row.title || row.book_id}》`" @change="toggleRow(row)" />
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
              <button class="secondary" type="button" @click="openBookEditor(row)">编辑</button>
              <button class="secondary" type="button" @click="loadChapters(row.book_id, row.title)">章节</button>
              <button class="secondary" type="button" @click="exportBookTxt(row.book_id)">TXT</button>
              <button class="secondary" type="button" @click="exportBookManifest(row)">清单</button>
              <button class="danger secondary" type="button" @click="deleteBook(row)">删除</button>
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
            <button class="secondary" type="button" @click="loadChapters(currentBookId, currentBookTitle)">刷新目录</button>
            <button class="secondary" type="button" @click="exportBookTxt(currentBookId)">导出 TXT</button>
            <button class="secondary" type="button" @click="openChapterEditor()">新增</button>
            <button class="danger secondary" type="button" @click="deleteCurrentBookChapters">删除本书全部缓存</button>
            <button class="secondary" type="button" @click="closeChapters">关闭章节区</button>
          </div>
        </div>
        <div class="bulk-bar">
          <label class="check-row">
            <input type="checkbox" :checked="allChaptersSelected" @change="toggleAllChapters($event.target.checked)" />
            <span>本页全选</span>
          </label>
          <span class="sub">已选 {{ number(selectedChapterRows.length) }} 章</span>
          <button class="danger secondary" type="button" :disabled="!selectedChapterRows.length || chaptersLoading" @click="deleteSelectedChapters">删除选中</button>
          <button class="secondary" type="button" :disabled="!selectedChapterRows.length" @click="clearChapterSelection">清空选择</button>
        </div>
        <DataTable :columns="chapterColumns" :rows="chapters" :loading="chaptersLoading" empty-text="这本书还没有章节缓存">
          <template #cell-select="{ row }">
            <input class="row-check" type="checkbox" :checked="isChapterSelected(row)" @change="toggleChapterRow(row)" />
          </template>
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
      :busy="bookModal.busy"
      :error="bookModal.error"
      @close="bookModal.open = false"
      @save="saveBook"
    />
    <FormModal
      :open="chapterModal.open"
      :title="chapterModal.title"
      :model="chapterModal.model"
      :fields="chapterFields"
      :textarea-fields="chapterTextareaFields"
      :busy="chapterModal.busy"
      :error="chapterModal.error"
      @close="chapterModal.open = false"
      @save="saveChapter"
    />
  </section>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、DataTable/FormModal、Admin API、格式化工具与全局确认/输入/提示服务
 * [OUTPUT]: 提供书籍/章节查询编辑、清单校验导入、陈旧清理和章节批量维护页面
 * [POS]: admin-ui/src/views 的书库管理主视图，编排 books/chapters 多组受审计写接口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, onMounted, reactive, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import FormModal from "../components/FormModal.vue";
import { api } from "../services/api";
import { number, splitTags, time } from "../utils/format";

const toast = inject("toast", () => {});
const confirmAction = inject("confirmAction", async () => ({ confirmed: false, reason: "" }));
const inputAction = inject("inputAction", async () => ({ confirmed: false, value: "" }));

const filters = reactive({ q: "", tag: "", category: "", platform: "" });
const sortValue = ref("updated_desc");
const books = ref([]);
const categoryOptions = ref([]);
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
const selectedChapterIds = ref(new Set());
const manifestInput = ref(null);

const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(limit.value || 20))));
const selectedRows = computed(() => books.value.filter((book) => selectedBookIds.value.has(String(book.id))));
const allPageSelected = computed(() => books.value.length > 0 && books.value.every((book) => selectedBookIds.value.has(String(book.id))));
const selectedChapterRows = computed(() => chapters.value.filter((chapter) => selectedChapterIds.value.has(String(chapter.id))));
const allChaptersSelected = computed(() => chapters.value.length > 0 && chapters.value.every((chapter) => selectedChapterIds.value.has(String(chapter.id))));

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
  { key: "select", label: "选" },
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

const bookModal = reactive({ open: false, id: null, title: "", model: {}, busy: false, error: "" });
const chapterModal = reactive({ open: false, id: null, title: "", model: {}, busy: false, error: "" });

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
  filters.category = params.get("category") || "";
  filters.platform = params.get("platform") || "";
  sortValue.value = params.get("sort") || "updated_desc";
  const nextPage = Number(params.get("page") || 1);
  return Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 1;
}

function syncBooksUrl() {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.category) params.set("category", filters.category);
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

function isChapterSelected(row) {
  return selectedChapterIds.value.has(String(row.id));
}

function toggleChapterRow(row) {
  const next = new Set(selectedChapterIds.value);
  const id = String(row.id);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedChapterIds.value = next;
}

function toggleAllChapters(checked) {
  const next = new Set(selectedChapterIds.value);
  chapters.value.forEach((chapter) => {
    const id = String(chapter.id);
    if (checked) next.add(id);
    else next.delete(id);
  });
  selectedChapterIds.value = next;
}

function clearChapterSelection() {
  selectedChapterIds.value = new Set();
}

function pruneChapterSelection() {
  const ids = new Set(chapters.value.map((chapter) => String(chapter.id)));
  selectedChapterIds.value = new Set([...selectedChapterIds.value].filter((id) => ids.has(id)));
}

function upsertChapterRow(chapter) {
  if (!chapter?.id) return;
  const id = String(chapter.id);
  const index = chapters.value.findIndex((row) => String(row.id) === id);
  if (index >= 0) {
    const next = chapters.value.slice();
    next[index] = { ...next[index], ...chapter };
    chapters.value = next;
  } else if (!currentBookId.value || String(chapter.book_id || "") === String(currentBookId.value)) {
    chapters.value = [...chapters.value, chapter];
  }
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
      category: filters.category,
      platform: filters.platform,
      sort: sortValue.value,
      page: String(nextPage),
      limit: String(limit.value)
    });
    const [data, categories] = await Promise.all([
      api(`/admin-api/books?${params}`),
      api("/admin-api/books/categories").catch(() => ({ rows: [] }))
    ]);
    books.value = data.rows || [];
    total.value = Number(data.total || 0);
    page.value = Number(data.page || nextPage);
    limit.value = Number(data.limit || limit.value);
    categoryOptions.value = categories.rows || [];
    pruneSelectionToPage();
    syncBooksUrl();
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    loading.value = false;
  }
}

function toggleCategory(category) {
  filters.category = filters.category === category ? "" : category || "";
  loadBooks(1);
}

function exportBooksCsv() {
  const params = new URLSearchParams({
    q: filters.q,
    tag: filters.tag,
    category: filters.category,
    platform: filters.platform,
    sort: sortValue.value
  });
  window.open(`/admin-api/books/export.csv?${params}`, "_blank");
}

function exportBookManifest(row) {
  if (!row?.id) return toast("缺少书籍元信息 ID，无法导出 Manifest");
  window.open(`/admin-api/books/${encodeURIComponent(row.id)}/manifest`, "_blank");
}

async function importManifestFile(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text());
    const validation = await api("/admin-api/books/manifests/validate", {
      method: "POST",
      body: JSON.stringify({ manifest })
    });
    const confirmation = await confirmAction({
      title: "导入书籍 Manifest",
      message: [
        `书籍：${validation.book?.title || validation.book?.book_id || "-"}`,
        `身份：${validation.book?.platform || "-"}:${validation.book?.book_id || "-"}`,
        `章节：${number(validation.chapters || 0)}`,
        "校验和已通过。导入会增量写入变化的数据，不会删除 Manifest 之外的章节。"
      ].join("\n"),
      confirmLabel: "确认导入",
      phrase: validation.expected_confirmation
    });
    if (!confirmation.confirmed) return;
    const result = await api("/admin-api/books/manifests/import", {
      method: "POST",
      body: JSON.stringify({ manifest, confirmation: validation.expected_confirmation })
    });
    await loadBooks(1);
    toast(`Manifest 已导入：新增 ${number(result.chapters?.inserted)}，更新 ${number(result.chapters?.updated)}，跳过 ${number(result.chapters?.unchanged)}`);
  } catch (error) {
    toast(error instanceof SyntaxError ? "Manifest 不是有效的 JSON 文件" : (error.message || String(error)));
  } finally {
    if (input) input.value = "";
  }
}

async function batchExportTxt() {
  if (!selectedRows.value.length) return;
  if (selectedRows.value.length > 8) {
    const confirmation = await confirmAction({
      title: "批量打开导出页面",
      message: `将打开 ${selectedRows.value.length} 个 TXT 导出页面，浏览器可能会拦截部分弹窗。`,
      confirmLabel: "继续导出",
      requireReason: false
    });
    if (!confirmation.confirmed) return;
  }
  selectedRows.value.forEach((row) => exportBookTxt(row.book_id));
}

async function batchChangePlatform() {
  if (!selectedRows.value.length) return;
  const input = await inputAction({
    title: "批量修改站别",
    message: `已选择 ${selectedRows.value.length} 本书。站别会影响搜索、来源识别和后续上传匹配。`,
    label: "新站别代码",
    value: filters.platform || "po18",
    placeholder: "例如 po18 / popo / fanqie / haitang",
    hint: "请输入服务端已识别的平台代码。",
    confirmLabel: "下一步"
  });
  if (!input.confirmed) return;
  const label = input.value;
  const confirmation = await confirmAction({
    title: "批量修改站别",
    message: `将把已选 ${selectedRows.value.length} 本书的站别改为 ${label}，可能影响搜索和来源识别。`,
    confirmLabel: "修改站别"
  });
  if (!confirmation.confirmed) return;
  for (const row of selectedRows.value) {
    await api(`/admin-api/books/${row.id}`, { method: "PUT", body: JSON.stringify({ platform: label, reason: confirmation.reason }) });
  }
  selectedBookIds.value = new Set();
  await loadBooks(page.value);
  toast("已批量修正站别");
}

async function batchDeleteBooks() {
  if (!selectedRows.value.length) return;
  const input = await chooseDeleteMode(`已选择 ${selectedRows.value.length} 本书，请先选择要删除的数据范围。`);
  if (!input.confirmed) return;
  const deleteMode = input.value;
  const labels = { metadata: "仅删除元信息", cache: "仅删除章节缓存", all: "全部删除" };
  const confirmation = await confirmAction({
    title: "批量删除书籍数据",
    message: `将对 ${selectedRows.value.length} 本执行“${labels[deleteMode]}”，该操作不可恢复。`,
    confirmLabel: "批量删除",
    phrase: `DELETE ${selectedRows.value.length}`
  });
  if (!confirmation.confirmed) return;
  for (const row of selectedRows.value) {
    await api(`/admin-api/books/${row.id}?deleteMode=${deleteMode}`, { method: "DELETE", body: JSON.stringify({ reason: confirmation.reason }) });
  }
  selectedBookIds.value = new Set();
  await loadBooks(Math.min(page.value, totalPages.value));
  toast(`已批量执行：${labels[deleteMode]}`);
}

function openBookEditor(row = null) {
  bookModal.error = "";
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
  if (bookModal.busy) return;
  bookModal.busy = true;
  bookModal.error = "";
  const body = { ...form };
  for (const key of bookNumericFields) body[key] = Number(body[key] || 0);
  if (!body.created_at) delete body.created_at;
  if (!body.updated_at) delete body.updated_at;
  try {
    await api(bookModal.id ? `/admin-api/books/${bookModal.id}` : "/admin-api/books", {
      method: bookModal.id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    bookModal.open = false;
    await loadBooks(page.value);
    toast("书籍已保存", "success");
  } catch (error) {
    bookModal.error = error.message || String(error);
  } finally {
    bookModal.busy = false;
  }
}

async function deleteBook(row) {
  const input = await chooseDeleteMode(`《${row.title || row.book_id}》可以单独删除元信息、章节缓存，或全部删除。`);
  if (!input.confirmed) return;
  const deleteMode = input.value;
  const labels = { metadata: "仅删除元信息", cache: "仅删除章节缓存", all: "全部删除" };
  const confirmation = await confirmAction({
    title: "删除书籍数据",
    message: `将对《${row.title || row.book_id}》执行“${labels[deleteMode]}”，该操作不可恢复。`,
    confirmLabel: "确认删除",
    phrase: `DELETE ${row.book_id}`
  });
  if (!confirmation.confirmed) return;
  await api(`/admin-api/books/${row.id}?deleteMode=${deleteMode}`, { method: "DELETE", body: JSON.stringify({ reason: confirmation.reason }) });
  await loadBooks(page.value);
  if (String(currentBookId.value) === String(row.book_id)) {
    currentBookId.value = "";
    currentBookTitle.value = "";
    chapters.value = [];
  }
  toast(`已执行：${labels[deleteMode]}`);
}

function chooseDeleteMode(message) {
  return inputAction({
    title: "选择删除范围",
    message,
    label: "删除方式",
    inputType: "select",
    value: "metadata",
    options: [
      { value: "metadata", label: "仅删除元信息（保留章节缓存）" },
      { value: "cache", label: "仅删除章节缓存（保留元信息）" },
      { value: "all", label: "全部删除" }
    ],
    confirmLabel: "下一步"
  });
}

async function cleanupStaleBooks() {
  try {
    const preview = await api("/admin-api/books/cleanup-stale/preview");
    if (!preview.metadataCount && !preview.bookCount && !preview.chapterCount) return toast("没有符合条件的旧 PO18 书籍");
    const sample = (preview.sample || [])
      .slice(0, 6)
      .map((book) => `- ${book.title || book.book_id || "-"} / ${book.book_id || "-"} / ${book.platform || "-"} / ${book.source_update_date || book.latest_chapter_date || "-"} / ${number(book.metadata_chapter_count || 0)}章`)
      .join("\n");
    const message = [
      `将删除 ${preview.platform || "po18"} 平台、原站更新时间早于 ${preview.cutoff}、章节数小于 ${number(preview.maxChapterCount)} 的书籍。`,
      "",
      `元信息：${number(preview.metadataCount)} 条`,
      `去重书籍：${number(preview.bookCount)} 本`,
      `章节缓存：${number(preview.chapterCount)} 章`,
      "",
      "样例：",
      sample || "-",
      "",
      "该操作不可恢复。"
    ].join("\n");
    const confirmation = await confirmAction({
      title: "清理旧 PO18 书籍",
      message,
      confirmLabel: "执行清理",
      phrase: "CLEANUP"
    });
    if (!confirmation.confirmed) return;
    const result = await api("/admin-api/books/cleanup-stale", {
      method: "POST",
      body: JSON.stringify({ confirm: true, reason: confirmation.reason })
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
  clearChapterSelection();
  chaptersLoading.value = true;
  try {
    const data = await api(`/admin-api/books/${encodeURIComponent(bookId)}/chapters`);
    chapters.value = data.rows || [];
    pruneChapterSelection();
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    chaptersLoading.value = false;
  }
}

function openChapterEditor(row = null) {
  if (!row && !currentBookId.value) return toast("请先打开一本书的章节列表");
  chapterModal.id = row?.id || null;
  chapterModal.error = "";
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
  if (chapterModal.busy) return;
  chapterModal.busy = true;
  chapterModal.error = "";
  const body = { ...form, chapter_order: Number(form.chapter_order || 0) };
  try {
    const data = await api(chapterModal.id ? `/admin-api/chapters/${chapterModal.id}` : "/admin-api/chapters", {
      method: chapterModal.id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    chapterModal.open = false;
    upsertChapterRow(data.chapter || { ...body, id: chapterModal.id });
    pruneChapterSelection();
    toast("章节已保存", "success");
  } catch (error) {
    chapterModal.error = error.message || String(error);
  } finally {
    chapterModal.busy = false;
  }
}

function closeChapters() {
  currentBookId.value = "";
  currentBookTitle.value = "";
  chapters.value = [];
  clearChapterSelection();
}

async function deleteChapter(row) {
  const confirmation = await confirmAction({
    title: "删除章节缓存",
    message: `将删除章节“${row.title || row.chapter_id}”的缓存正文。`,
    confirmLabel: "删除章节"
  });
  if (!confirmation.confirmed) return;
  await api(`/admin-api/chapters/${row.id}`, { method: "DELETE", body: JSON.stringify({ reason: confirmation.reason }) });
  chapters.value = chapters.value.filter((chapter) => String(chapter.id) !== String(row.id));
  selectedChapterIds.value = new Set([...selectedChapterIds.value].filter((id) => id !== String(row.id)));
  toast("已删除章节");
}

async function deleteSelectedChapters() {
  const rows = selectedChapterRows.value.slice();
  if (!rows.length) return;
  if (!currentBookId.value) return toast("请先打开一本书的章节列表");
  const confirmation = await confirmAction({
    title: "批量删除章节缓存",
    message: `将删除已选 ${rows.length} 章缓存，书籍元信息会保留。`,
    confirmLabel: "批量删除",
    phrase: `DELETE ${rows.length}`
  });
  if (!confirmation.confirmed) return;
  const data = await api(`/admin-api/books/${encodeURIComponent(currentBookId.value)}/chapters/bulk`, {
    method: "DELETE",
    body: JSON.stringify({ ids: rows.map((row) => row.id), reason: confirmation.reason })
  });
  const deletedIds = new Set((data.deletedIds || rows.map((row) => row.id)).map((id) => String(id)));
  chapters.value = chapters.value.filter((chapter) => !deletedIds.has(String(chapter.id)));
  clearChapterSelection();
  toast(`已删除 ${number(data.deleted ?? deletedIds.size)} 章`);
}

async function deleteCurrentBookChapters() {
  if (!currentBookId.value) return toast("请先打开一本书的章节列表");
  const confirmation = await confirmAction({
    title: "删除整本章节缓存",
    message: `将删除《${currentBookTitle.value || currentBookId.value}》的全部章节缓存，元信息会保留。`,
    confirmLabel: "删除全部缓存",
    phrase: `DELETE ${currentBookId.value}`
  });
  if (!confirmation.confirmed) return;
  const data = await api(`/admin-api/books/${encodeURIComponent(currentBookId.value)}/chapters`, { method: "DELETE", body: JSON.stringify({ reason: confirmation.reason }) });
  chapters.value = [];
  clearChapterSelection();
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
