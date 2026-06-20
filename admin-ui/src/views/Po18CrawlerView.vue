<template>
  <section>
    <div class="view-head">
      <div class="view-title">
        <h2>PO18 遍历</h2>
        <p class="sub">按发现页、已购书架、元信息库或订阅列表定时补元信息和章节；已有缓存默认跳过，Cookie 失效会暂停等待更新。</p>
      </div>
      <div class="row-actions">
        <button class="secondary" type="button" @click="load">刷新</button>
        <button type="button" :disabled="busy || status.running" @click="runNow">{{ status.running ? "运行中" : "立即运行" }}</button>
      </div>
    </div>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">运行状态</p>
            <p class="section-desc">运行任务会写入任务中心；暂停后更新 Cookie，再点继续即可从当前任务恢复。</p>
          </div>
          <div class="row-actions">
            <button class="secondary" type="button" :disabled="!status.running || status.paused" @click="pause">暂停</button>
            <button class="secondary" type="button" :disabled="!status.running || !status.paused" @click="resume">继续</button>
            <button class="danger secondary" type="button" :disabled="!status.running" @click="stop">停止</button>
          </div>
        </div>

        <div class="dashboard">
          <StatCard label="状态" :value="statusLabel">{{ status.pauseReason || status.lastError || "等待任务" }}</StatCard>
          <StatCard label="来源" :value="sourceModeLabel">{{ config.enabled ? "定时已启用" : "手动或未启用" }}</StatCard>
          <StatCard label="任务 ID" :value="status.activeJobId ? `#${status.activeJobId}` : '-'">任务中心可查看完整输入和结果</StatCard>
          <StatCard label="扫描页" :value="number(status.stats?.pagesScanned || 0)">当前 {{ number(status.stats?.currentPage || 0) }}</StatCard>
          <StatCard label="书籍" :value="`${number(status.stats?.booksProcessed || 0)} / ${number(status.stats?.booksFound || 0)}`">已处理 / 已发现</StatCard>
          <StatCard label="过滤跳过" :value="number(status.stats?.booksSkippedFiltered || 0)">命中分类、标签、关键字或章节数规则</StatCard>
          <StatCard label="完结完整跳过" :value="number(status.stats?.booksSkippedComplete || 0)">已完结且缓存 100% 的 PO18 书会在元信息库模式跳过</StatCard>
          <StatCard label="元信息" :value="number(status.stats?.metadataUploaded || 0)">本次上传数量</StatCard>
          <StatCard label="章节上传" :value="number(status.stats?.chaptersUploaded || 0)">发现 {{ number(status.stats?.chaptersFound || 0) }}</StatCard>
          <StatCard label="跳过缓存" :value="number(status.stats?.chaptersSkippedCached || 0)">已有章节不会重复抓取</StatCard>
          <StatCard label="请求重试" :value="number(status.stats?.requestRetries || 0)">超时/网络错误自动重试</StatCard>
          <StatCard label="并发" :value="concurrencyLabel">{{ currentWorkLabel }}</StatCard>
          <StatCard label="下次定时" :value="status.nextRunAt ? time(status.nextRunAt) : '-'">{{ config.enabled ? "已启用" : "未启用" }}</StatCard>
        </div>

        <div v-if="status.paused" class="warning-block">
          {{ status.pauseReason || "任务已暂停" }}。在下方更新 Cookie 并保存后，点击“继续”。
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">遍历配置</p>
            <p class="section-desc">四种来源共用并发、跳过缓存和覆盖策略；元信息库模式直接从 book_metadata 的 PO18 书籍补缺。</p>
          </div>
          <div class="row-actions">
            <button class="secondary" type="button" :disabled="testing" @click="testCookie">{{ testing ? "检测中..." : "检测 Cookie" }}</button>
            <button type="button" :disabled="saving" @click="save">{{ saving ? "保存中..." : "保存配置" }}</button>
          </div>
        </div>

        <div class="source-mode-list">
          <label v-for="option in sourceOptions" :key="option.value" :class="['source-mode-card', { active: form.sourceMode === option.value }]">
            <input v-model="form.sourceMode" type="radio" :value="option.value" />
            <strong>{{ option.label }}</strong>
            <span>{{ option.desc }}</span>
          </label>
        </div>

        <div class="split crawler-form-grid">
          <label class="field">
            <span>启用定时</span>
            <select v-model="form.enabled">
              <option :value="false">关闭</option>
              <option :value="true">开启</option>
            </select>
          </label>
          <label class="field">
            <span>定时间隔（分钟）</span>
            <input v-model.number="form.intervalMinutes" type="number" min="5" step="5" />
          </label>
          <label class="field">
            <span>每次最多书籍</span>
            <input v-model.number="form.maxBooksPerRun" type="number" min="1" step="1" />
          </label>
          <label class="field">
            <span>书籍并发</span>
            <input v-model.number="form.bookConcurrency" type="number" min="1" max="8" step="1" />
          </label>
          <label class="field">
            <span>章节并发</span>
            <input v-model.number="form.chapterConcurrency" type="number" min="1" max="20" step="1" />
          </label>
          <label class="field">
            <span>书籍间隔（ms）</span>
            <input v-model.number="form.delayMs" type="number" min="0" step="100" />
          </label>
          <label class="field">
            <span>请求间隔（ms）</span>
            <input v-model.number="form.requestIntervalMs" type="number" min="0" step="50" />
          </label>
          <label class="field">
            <span>超时（ms）</span>
            <input v-model.number="form.timeoutMs" type="number" min="5000" step="1000" />
          </label>
          <label class="field">
            <span>请求重试次数</span>
            <input v-model.number="form.requestRetries" type="number" min="0" max="10" step="1" />
          </label>
          <label class="field">
            <span>重试间隔（ms）</span>
            <input v-model.number="form.requestRetryDelayMs" type="number" min="0" max="60000" step="500" />
          </label>
        </div>

        <div v-if="form.sourceMode === 'discover'" class="split crawler-form-grid crawler-mode-settings">
          <label class="field">
            <span>起始页</span>
            <input v-model.number="form.startPage" type="number" min="1" step="1" />
          </label>
          <label class="field">
            <span>结束页</span>
            <input v-model.number="form.endPage" type="number" min="1" step="1" />
          </label>
          <label class="field">
            <span>发现排序</span>
            <select v-model="form.sort">
              <option value="time">最近更新</option>
              <option value="12">珍珠数</option>
              <option value="22">人气数</option>
              <option value="32">订阅数</option>
              <option value="42">收藏数</option>
              <option value="52">留言数</option>
              <option value="62">打赏数</option>
            </select>
          </label>
          <label class="field">
            <span>状态</span>
            <select v-model="form.status">
              <option value="all">全部</option>
              <option value="1">连载</option>
              <option value="2">完结</option>
            </select>
          </label>
          <label class="field">
            <span>字数筛选</span>
            <select v-model="form.words">
              <option value="all">全部</option>
              <option value="1">短篇</option>
              <option value="2">中篇</option>
              <option value="3">长篇</option>
            </select>
          </label>
          <label class="field">
            <span>发现页 tag</span>
            <input v-model.trim="form.categoryTag" placeholder="默认 all；按 PO18 分类参数填写" />
          </label>
          <label class="field">
            <span>自定义 tid</span>
            <input v-model.trim="form.categoryTid" placeholder="不填为全部；有站点分类 ID 时填写" />
          </label>
        </div>

        <div v-if="form.sourceMode === 'bookshelf'" class="split crawler-form-grid crawler-mode-settings">
          <label class="field">
            <span>书架扫描到年份</span>
            <input v-model.number="form.bookshelfStartYear" type="number" min="2008" step="1" />
          </label>
          <label class="field">
            <span>连续空年份停止</span>
            <input v-model.number="form.bookshelfEmptyYearStop" type="number" min="1" max="12" step="1" />
          </label>
          <p class="inline-hint field-wide">已购书架模式会访问 PO18 已购买列表，适合补全你账号已经购买的所有章节。</p>
        </div>

        <div v-if="form.sourceMode === 'cache'" class="split crawler-form-grid crawler-mode-settings">
          <label class="field">
            <span>元信息候选上限</span>
            <input v-model.number="form.cacheIdLimit" type="number" min="1" max="10000" step="100" />
          </label>
          <p class="inline-hint field-wide">元信息库模式会从 book_metadata 里读取 platform=po18 的书籍，再按网站目录补缺失章节；已完结且缓存数达到总章节数的书会直接跳过。</p>
        </div>

        <label v-if="form.sourceMode === 'subscription'" class="field field-wide crawler-subscriptions">
          <span>订阅 book_id 列表</span>
          <textarea v-model="subscriptionText" placeholder="一行一个 PO18 book_id，也支持空格、逗号、分号分隔。"></textarea>
          <small>当前识别 {{ number(subscriptionCount) }} 本；可直接粘贴 tmp/po18-cache90-bookids.txt 的内容。</small>
        </label>

        <div class="split crawler-form-grid crawler-mode-settings">
          <label class="field field-wide">
            <span>只选分类/标签</span>
            <textarea v-model="includeCategoriesText" placeholder="留空为全部；多个分类用逗号、换行或顿号分隔，例如：甜文、校园"></textarea>
            <small>适用于所有来源；发现页模式会先按上面的分类参数请求，再用这里的分类/标签二次过滤。</small>
          </label>
          <label class="field field-wide">
            <span>屏蔽标签</span>
            <textarea v-model="blockedTagsText" placeholder="例如：恐怖、虐、重口"></textarea>
          </label>
          <label class="field field-wide">
            <span>屏蔽关键字</span>
            <textarea v-model="blockedKeywordsText" placeholder="匹配书名、作者、简介、状态、标签；例如：换妻、ntr"></textarea>
          </label>
          <label class="field">
            <span>最少章节数</span>
            <input v-model.number="form.minChapters" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span>最多章节数</span>
            <input v-model.number="form.maxChapters" type="number" min="0" step="1" />
          </label>
          <p class="inline-hint field-wide">标签和关键字适用于所有来源；章节数范围只作用于发现页，元信息库、订阅和书架补缺不会按章节数跳过。</p>
        </div>

        <div class="tag-row crawler-checks">
          <label class="check-row"><input v-model="form.uploadMetadata" type="checkbox" /><span>更新元信息</span></label>
          <label class="check-row"><input v-model="form.uploadChapters" type="checkbox" /><span>更新章节</span></label>
          <label class="check-row"><input v-model="form.skipCached" type="checkbox" /><span>跳过已有缓存</span></label>
          <label class="check-row"><input v-model="form.overwrite" type="checkbox" /><span>覆盖已缓存章节</span></label>
        </div>

        <div class="crawler-cookie-grid">
          <label class="field">
            <span>当前 Cookie 档案</span>
            <select v-model="form.activeCookieProfile">
              <option value="">自动选择</option>
              <option v-for="profile in profileOptions" :key="profile.id || profile.name" :value="profile.id || profile.name">
                {{ profile.name || profile.id }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>保存为档案名</span>
            <input v-model.trim="form.cookieName" placeholder="默认使用当前档案名或 default" />
          </label>
          <label class="field field-wide crawler-cookie">
            <span>PO18 Cookie</span>
            <textarea v-model.trim="form.cookie" placeholder="从浏览器复制 www.po18.tw 登录后的 Cookie；留空保存时不会覆盖现有 Cookie。"></textarea>
          </label>
        </div>

        <p class="inline-hint">
          当前 Cookie：{{ config.cookieConfigured ? `已配置 ${number(config.cookieProfileCount || 1)} 个档案` : "未配置" }}。
          检测通过后再开启定时更稳；后台只显示脱敏状态，不返回明文 Cookie。
        </p>

        <div v-if="profileOptions.length" class="crawler-profile-list">
          <div v-for="profile in profileOptions" :key="profile.id || profile.name" :class="['crawler-profile-card', { active: isActiveProfile(profile) }]">
            <strong>{{ profile.name || profile.id }}</strong>
            <span>{{ profile.cookieConfigured ? `${number(profile.cookieCount || 0)} 项 / ${number(profile.cookieLength || 0)} 字符` : "未配置" }}</span>
            <small>{{ profile.lastStatus || "未检测" }}{{ profile.lastUsedAt ? ` · ${time(profile.lastUsedAt)}` : "" }}</small>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section">
        <div class="section-head">
          <div>
            <p class="section-title">运行日志</p>
            <p class="section-desc">只显示最近日志，运行中自动实时刷新，完整任务输入和结果在任务中心。</p>
          </div>
          <div class="row-actions">
            <span class="live-refresh-pill">{{ liveRefreshLabel }}</span>
            <button class="secondary" type="button" :disabled="polling" @click="refreshStatus(false)">{{ polling ? "刷新中" : "刷新日志" }}</button>
          </div>
        </div>
        <pre ref="logEl" class="mini-log crawler-log" @scroll="handleLogScroll">{{ logLines.join("\n") || "暂无日志" }}</pre>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import StatCard from "../components/StatCard.vue";
import { api } from "../services/api";
import { number, time } from "../utils/format";

const toast = inject("toast", () => {});
const busy = ref(false);
const saving = ref(false);
const testing = ref(false);
const polling = ref(false);
const lastRefreshedAt = ref("");
const logEl = ref(null);
const logPinned = ref(true);
const config = ref({});
const status = ref({ stats: {}, logs: [] });
const subscriptionText = ref("");
const includeCategoriesText = ref("");
const blockedTagsText = ref("");
const blockedKeywordsText = ref("");
let pollTimer = null;
let disposed = false;

const sourceOptions = [
  { value: "discover", label: "发现页", desc: "按 PO18 发现页分页遍历，适合找新书和定期补缓存。" },
  { value: "bookshelf", label: "已购书架", desc: "扫描账号已购买列表，补全已购书籍章节。" },
  { value: "cache", label: "元信息库", desc: "从 book_metadata 中 platform=po18 的书籍按目录补缺；完结且缓存完整会跳过。" },
  { value: "subscription", label: "订阅列表", desc: "按手动维护的 book_id 列表固定更新。" }
];

const form = reactive({
  enabled: false,
  sourceMode: "discover",
  startPage: 1,
  endPage: 20,
  maxBooksPerRun: 200,
  sort: "time",
  status: "all",
  words: "all",
  newBook: "all",
  categoryTag: "all",
  categoryTid: "",
  minChapters: 0,
  maxChapters: 0,
  bookConcurrency: 1,
  chapterConcurrency: 3,
  delayMs: 800,
  requestIntervalMs: 250,
  timeoutMs: 20000,
  requestRetries: 2,
  requestRetryDelayMs: 1200,
  uploadMetadata: true,
  uploadChapters: true,
  skipCached: true,
  overwrite: false,
  intervalMinutes: 360,
  cacheIdLimit: 500,
  bookshelfStartYear: 2010,
  bookshelfEmptyYearStop: 3,
  activeCookieProfile: "",
  cookieName: "",
  cookie: ""
});

const statusLabel = computed(() => {
  if (status.value.paused) return "已暂停";
  if (status.value.running) return "运行中";
  if (status.value.lastError) return "异常";
  return config.value.enabled ? "定时待命" : "未运行";
});

const sourceModeLabel = computed(() => {
  const mode = form.sourceMode || config.value.sourceMode || "discover";
  return sourceOptions.find((item) => item.value === mode)?.label || mode;
});

const concurrencyLabel = computed(() => {
  const stats = status.value.stats || {};
  const activeBooks = number(stats.activeBooks || 0);
  const activeChapters = number(stats.activeChapters || 0);
  const bookLimit = number(config.value.bookConcurrency || form.bookConcurrency || 1);
  const chapterLimit = number(config.value.chapterConcurrency || form.chapterConcurrency || 1);
  return `书 ${activeBooks}/${bookLimit} · 章 ${activeChapters}/${chapterLimit}`;
});

const currentWorkLabel = computed(() => {
  const stats = status.value.stats || {};
  const book = [stats.currentBookId, stats.currentBookTitle].filter(Boolean).join(" ");
  const chapter = [stats.currentChapterId, stats.currentChapterTitle].filter(Boolean).join(" ");
  return chapter || book || "等待任务";
});

const liveRefreshLabel = computed(() => {
  if (polling.value) return "刷新中";
  const at = lastRefreshedAt.value ? time(lastRefreshedAt.value) : "未刷新";
  return status.value.running || status.value.paused ? `实时刷新 · ${at}` : `自动刷新 · ${at}`;
});

const profileOptions = computed(() => Array.isArray(config.value.cookieProfiles) ? config.value.cookieProfiles : []);

const subscriptionIds = computed(() => uniqueBookIds(subscriptionText.value));
const subscriptionCount = computed(() => subscriptionIds.value.length);

const logLines = computed(() => (status.value.logs || []).slice(-80).map((row) => {
  const at = String(row.at || "").slice(0, 19).replace("T", " ");
  return `${at} ${row.level || "info"} ${row.message || ""}`;
}));

function uniqueBookIds(value = "") {
  return [...new Set(String(value || "")
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item)))];
}

function uniqueList(value = "") {
  return [...new Set(String(value || "")
    .split(/[\n\r,;|/、，；]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function normalizePo18StatusValue(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (text === "writing" || text === "ongoing" || text === "1") return "1";
  if (text === "finish" || text === "finished" || text === "2") return "2";
  return "all";
}

function normalizePo18SortValue(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["time", "12", "22", "32", "42", "52", "62"].includes(text)) return text;
  if (text === "popularity") return "22";
  if (text === "collect") return "42";
  return "time";
}

function assignForm(next = {}) {
  Object.assign(form, {
    enabled: !!next.enabled,
    sourceMode: next.sourceMode || "discover",
    startPage: next.startPage ?? 1,
    endPage: next.endPage ?? 20,
    maxBooksPerRun: next.maxBooksPerRun ?? 200,
    sort: normalizePo18SortValue(next.sort),
    status: normalizePo18StatusValue(next.status),
    words: next.words || "all",
    newBook: next.newBook || "all",
    categoryTag: next.categoryTag || "all",
    categoryTid: next.categoryTid || "",
    minChapters: next.minChapters ?? 0,
    maxChapters: next.maxChapters ?? 0,
    bookConcurrency: next.bookConcurrency ?? 1,
    chapterConcurrency: next.chapterConcurrency ?? 3,
    delayMs: next.delayMs ?? 800,
    requestIntervalMs: next.requestIntervalMs ?? 250,
    timeoutMs: next.timeoutMs ?? 20000,
    requestRetries: next.requestRetries ?? 2,
    requestRetryDelayMs: next.requestRetryDelayMs ?? 1200,
    uploadMetadata: next.uploadMetadata !== false,
    uploadChapters: next.uploadChapters !== false,
    skipCached: next.skipCached !== false,
    overwrite: !!next.overwrite,
    intervalMinutes: next.intervalMinutes ?? 360,
    cacheIdLimit: next.cacheIdLimit ?? 500,
    bookshelfStartYear: next.bookshelfStartYear ?? 2010,
    bookshelfEmptyYearStop: next.bookshelfEmptyYearStop ?? 3,
    activeCookieProfile: next.activeCookieProfile || "",
    cookieName: "",
    cookie: ""
  });
  subscriptionText.value = Array.isArray(next.subscriptionBookIds) ? next.subscriptionBookIds.join("\n") : "";
  includeCategoriesText.value = Array.isArray(next.includeCategories) ? next.includeCategories.join("\n") : "";
  blockedTagsText.value = Array.isArray(next.blockedTags) ? next.blockedTags.join("\n") : "";
  blockedKeywordsText.value = Array.isArray(next.blockedKeywords) ? next.blockedKeywords.join("\n") : "";
}

function savePayload() {
  const payload = {
    ...form,
    subscriptionBookIds: subscriptionIds.value,
    includeCategories: uniqueList(includeCategoriesText.value),
    blockedTags: uniqueList(blockedTagsText.value),
    blockedKeywords: uniqueList(blockedKeywordsText.value)
  };
  if (!String(payload.cookie || "").trim()) delete payload.cookie;
  if (!String(payload.cookieName || "").trim()) delete payload.cookieName;
  delete payload.cookieProfiles;
  return payload;
}

function isActiveProfile(profile = {}) {
  const active = form.activeCookieProfile || config.value.activeCookieProfile || "";
  return !!active && [profile.id, profile.name].map((item) => String(item || "")).includes(String(active));
}

async function load() {
  const data = await api("/admin-api/po18-crawler");
  config.value = data.config || {};
  status.value = data.status || { stats: {}, logs: [] };
  assignForm(data.config || {});
  lastRefreshedAt.value = new Date().toISOString();
}

async function refreshStatus(silent = true) {
  if (polling.value) return;
  polling.value = true;
  try {
    const data = await api("/admin-api/po18-crawler");
    config.value = data.config || config.value;
    status.value = data.status || status.value;
    lastRefreshedAt.value = new Date().toISOString();
  } catch (err) {
    if (!silent) toast(err.message || String(err));
  } finally {
    polling.value = false;
  }
}

function pollDelay() {
  return status.value.running || status.value.paused ? 1500 : 5000;
}

function schedulePoll() {
  if (disposed) return;
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(async () => {
    await refreshStatus(true);
    schedulePoll();
  }, pollDelay());
}

function handleLogScroll() {
  const el = logEl.value;
  if (!el) return;
  logPinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
}

watch(logLines, async () => {
  if (!logPinned.value) return;
  await nextTick();
  const el = logEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});

async function save() {
  saving.value = true;
  try {
    const data = await api("/admin-api/po18-crawler/config", {
      method: "PUT",
      body: JSON.stringify(savePayload())
    });
    config.value = data.config || {};
    status.value = data.status || status.value;
    assignForm(data.config || {});
    toast("PO18 遍历配置已保存");
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    saving.value = false;
  }
}

async function runNow() {
  busy.value = true;
  try {
    const data = await api("/admin-api/po18-crawler/run", {
      method: "POST",
      body: JSON.stringify({})
    });
    status.value = data.status || status.value;
    toast(data.job?.id ? `PO18 遍历任务已启动 #${data.job.id}` : "PO18 遍历任务已启动");
    window.setTimeout(() => refreshStatus(true), 800);
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    busy.value = false;
  }
}

async function pause() {
  const data = await api("/admin-api/po18-crawler/pause", { method: "POST", body: JSON.stringify({}) });
  status.value = data.status || status.value;
}

async function resume() {
  const data = await api("/admin-api/po18-crawler/resume", { method: "POST", body: JSON.stringify({}) });
  status.value = data.status || status.value;
}

async function stop() {
  if (!window.confirm("确认停止当前 PO18 遍历任务？")) return;
  const data = await api("/admin-api/po18-crawler/stop", { method: "POST", body: JSON.stringify({}) });
  status.value = data.status || status.value;
}

async function testCookie() {
  testing.value = true;
  try {
    const data = await api("/admin-api/po18-crawler/test-cookie", {
      method: "POST",
      body: JSON.stringify(savePayload())
    });
    const profile = data.result?.activeCookieProfile?.name || data.result?.activeCookieProfile?.id || "";
    const sample = (data.result?.sampleBooks || []).map((row) => row.title || row.bookId).join(" / ");
    toast(data.result?.ok ? `Cookie 可用${profile ? `（${profile}）` : ""}${sample ? `：${sample}` : ""}` : "Cookie 检测失败");
  } catch (err) {
    toast(err.message || String(err));
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  load()
    .then(() => nextTick(() => {
      const el = logEl.value;
      if (el) el.scrollTop = el.scrollHeight;
    }))
    .catch((err) => toast(err.message || String(err)))
    .finally(schedulePoll);
});

onBeforeUnmount(() => {
  disposed = true;
  window.clearTimeout(pollTimer);
});
</script>
