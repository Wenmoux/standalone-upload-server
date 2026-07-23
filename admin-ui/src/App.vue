<template>
  <a v-if="user" class="skip-link" href="#admin-content">跳到主要内容</a>
  <section v-if="checking" class="page-main">
    <div class="panel">
      <div class="section">正在加载后台...</div>
    </div>
  </section>

  <LoginView v-else-if="!user" :reader-url="readerLink" @login="handleLogin" />

  <section v-else>
    <header class="topbar admin-topbar">
      <div class="brand">
        <div class="mark">P</div>
        <div>
          <strong>PO18 Reader</strong>
          <span>书库后台 · 3100</span>
        </div>
      </div>
      <div class="top-actions">
        <button
          class="secondary mobile-menu-button"
          type="button"
          :aria-expanded="mobileNavOpen"
          aria-controls="admin-sidebar"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          {{ mobileNavOpen ? "关闭菜单" : "菜单" }}
        </button>
        <div class="chip version-chip" :title="versionTitle"><span>{{ versionBadge }}</span></div>
        <div class="chip"><span class="dot"></span><span>{{ user.username }} · {{ roleLabel }}</span></div>
        <button v-if="user.role === 'owner'" class="secondary" type="button" :disabled="backupBusy" @click="backup">
          {{ backupBusy ? "备份中..." : "备份" }}
        </button>
        <button class="secondary" type="button" @click="logout">退出</button>
      </div>
    </header>

    <main class="page-main admin-main">
      <div class="layout admin-layout">
        <button v-if="mobileNavOpen" class="mobile-nav-backdrop" type="button" aria-label="关闭导航" @click="mobileNavOpen = false"></button>
        <aside id="admin-sidebar" class="summary admin-sidebar" :class="{ open: mobileNavOpen }">
          <div class="mobile-sidebar-head">
            <strong>后台导航</strong>
            <button class="secondary" type="button" @click="mobileNavOpen = false">关闭</button>
          </div>
          <h1>管理面板</h1>
          <p class="lead">书库数据、读者体系、Bot 推送和容器运行状态集中在这里。</p>
          <div class="sidebar-status">
            <span>当前页面</span>
            <strong>{{ activeLabel }}</strong>
          </div>
          <nav class="nav admin-nav" aria-label="后台主导航">
            <section v-for="group in visibleNavGroups" :key="group.key" class="nav-group">
              <h2>{{ group.label }}</h2>
              <button
                v-for="item in group.items"
                :key="item.key"
                type="button"
                :class="{ active: activeView === item.key }"
                :aria-current="activeView === item.key ? 'page' : undefined"
                @click="switchView(item.key)"
              >
                <span>{{ item.label }}</span>
              </button>
            </section>
          </nav>
          <div class="sidebar-links">
            <strong>快捷入口</strong>
            <a v-if="user.role === 'owner'" href="/setup">初始化面板</a>
            <a :href="readerLink" target="_blank" rel="noreferrer">阅读器 3200</a>
            <a href="/rank" target="_blank" rel="noreferrer">动态榜单</a>
          </div>
          <div class="saved-views">
            <div class="saved-views-head">
              <strong>保存视图</strong>
              <button class="icon-button" type="button" title="保存当前视图" aria-label="保存当前视图" @click="saveCurrentView">＋</button>
            </div>
            <p v-if="!savedViews.length" class="saved-views-empty">保存常用筛选后可一键返回。</p>
            <div v-for="item in savedViews" :key="item.fullPath" class="saved-view-row">
              <button class="saved-view-link" type="button" :title="item.fullPath" @click="openSavedView(item)">{{ item.label }}</button>
              <button class="icon-button danger-icon" type="button" title="移除保存视图" aria-label="移除保存视图" @click="removeSavedView(item.fullPath)">×</button>
            </div>
          </div>
        </aside>

        <div id="admin-content" class="content" tabindex="-1">
          <RouterView v-slot="{ Component }">
            <KeepAlive>
              <component :is="Component" :user="user" />
            </KeepAlive>
          </RouterView>
        </div>
      </div>
    </main>
  </section>

  <ToastHost :items="toastItems" @dismiss="dismissToast" />
  <ConfirmDialog v-bind="confirmState" @cancel="settleConfirmation(false)" @confirm="settleConfirmation(true, $event)" />
  <InputDialog v-bind="inputState" @cancel="settleInput(false)" @confirm="settleInput(true, $event)" />
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue/Router、登录与全局交互组件、Admin API 和 Reader 地址工具
 * [OUTPUT]: 提供认证门禁、导航外壳、权限上下文、全局提示/确认服务与备份快捷动作
 * [POS]: admin-ui/src 的应用组合根，协调会话和跨页面能力，领域视图在其下按路由装载
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ToastHost from "./components/ToastHost.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import InputDialog from "./components/InputDialog.vue";
import LoginView from "./views/LoginView.vue";
import { adminNavGroups as navGroups, adminNavItems as navItems } from "./router";
import { ADMIN_AUTH_EXPIRED_EVENT, api } from "./services/api";
import { readerUrl } from "./utils/format";

const SAVED_VIEWS_KEY = "po18AdminSavedViews";
const route = useRoute();
const router = useRouter();

const checking = ref(true);
const user = ref(null);
const toastItems = ref([]);
const versionInfo = ref({ image: "wenmoux/reader:v2.0", version: "2.0.0" });
const savedViews = ref(loadSavedViews());
const mobileNavOpen = ref(false);
const backupBusy = ref(false);
let toastSequence = 0;
const toastTimers = new Map();
let confirmResolver = null;
let inputResolver = null;
const confirmState = reactive({
  open: false,
  title: "确认操作",
  message: "该操作可能影响现有数据。",
  confirmLabel: "确认执行",
  requireReason: true,
  minimumReasonLength: 2,
  phrase: "",
  busy: false
});
const inputState = reactive({
  open: false,
  title: "请输入",
  message: "",
  label: "内容",
  value: "",
  inputType: "text",
  options: [],
  placeholder: "",
  hint: "",
  rows: 4,
  maxlength: 500,
  required: true,
  confirmLabel: "确认",
  busy: false
});

const readerLink = readerUrl();
const roleNav = {
  owner: navItems.map((item) => item.key),
  operator: ["dashboard", "books", "quality", "events", "booklist", "po18crawler", "jobs", "system"],
  moderator: ["dashboard", "events", "feedback", "corrections"],
  viewer: ["dashboard", "quality", "events", "feedback", "booklist", "jobs", "system"]
};
const visibleNavItems = computed(() => {
  const role = user.value?.role || "owner";
  const allowed = new Set(roleNav[role] || roleNav.viewer);
  return navItems.filter((item) => allowed.has(item.key));
});
const visibleNavGroups = computed(() =>
  navGroups
    .map((group) => ({ ...group, items: visibleNavItems.value.filter((item) => item.group === group.key) }))
    .filter((group) => group.items.length)
);
const activeView = computed(() => String(route.meta?.view || "dashboard"));
const activeLabel = computed(() => visibleNavItems.value.find((item) => item.key === activeView.value)?.label || "总览");
const roleLabel = computed(() => ({ owner: "所有者", operator: "运维", moderator: "审核", viewer: "只读" }[user.value?.role || "owner"] || "只读"));
const versionBadge = computed(() => {
  const image = versionInfo.value.image || "wenmoux/reader:v2.0";
  const version = versionInfo.value.version || "";
  const revision = String(versionInfo.value.build_revision || versionInfo.value.revision || "").slice(0, 12);
  const buildDate = formatBuildDate(versionInfo.value.build_date);
  return [image, version, revision, buildDate].filter(Boolean).join(" · ");
});
const versionTitle = computed(() => {
  const info = versionInfo.value || {};
  return [
    `image: ${info.image || "wenmoux/reader:v2.0"}`,
    `version: ${info.version || "-"}`,
    `revision: ${info.build_revision || info.revision || "-"}`,
    `build: ${info.build_date || "-"}`,
    `node: ${info.node || "-"}`,
    `platform: ${info.platform || "-"}`
  ].join("\n");
});

function formatBuildDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function dismissToast(id) {
  toastItems.value = toastItems.value.filter((item) => item.id !== id);
  window.clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
}

function toast(message, tone = "info") {
  const text = String(message || "").trim();
  if (!text) return;
  const id = ++toastSequence;
  toastItems.value = [...toastItems.value.slice(-3), { id, message: text, tone }];
  toastTimers.set(id, window.setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 4200));
}

function switchView(name, options = {}) {
  const item = navItems.find((entry) => entry.key === name);
  if (!item) return;
  const query = options && typeof options === "object" && options.query ? options.query : undefined;
  router.push({ path: item.path, ...(query ? { query } : {}) });
  mobileNavOpen.value = false;
}

function loadSavedViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.fullPath && item.label).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function persistSavedViews() {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews.value.slice(0, 8)));
  } catch {
    toast("保存视图失败，浏览器存储不可用");
  }
}

function currentViewLabel() {
  const queryText = Object.values(route.query || {}).flat().filter(Boolean).join(" · ");
  return queryText ? `${activeLabel.value} · ${String(queryText).slice(0, 36)}` : activeLabel.value;
}

function saveCurrentView() {
  const fullPath = route.fullPath;
  const next = { fullPath, label: currentViewLabel(), savedAt: new Date().toISOString() };
  savedViews.value = [next, ...savedViews.value.filter((item) => item.fullPath !== fullPath)].slice(0, 8);
  persistSavedViews();
  toast("当前视图已保存");
}

function openSavedView(item) {
  if (item?.fullPath) router.push(item.fullPath);
}

function removeSavedView(fullPath) {
  savedViews.value = savedViews.value.filter((item) => item.fullPath !== fullPath);
  persistSavedViews();
}

function ensureAllowedRoute() {
  if (!user.value || !visibleNavItems.value.length) return;
  if (visibleNavItems.value.some((item) => item.key === activeView.value)) return;
  router.replace(visibleNavItems.value[0].path);
}

function confirmAction(options = {}) {
  if (confirmResolver) confirmResolver({ confirmed: false, reason: "" });
  Object.assign(confirmState, {
    open: true,
    title: options.title || "确认操作",
    message: options.message || "该操作可能影响现有数据。",
    confirmLabel: options.confirmLabel || "确认执行",
    requireReason: options.requireReason !== false,
    minimumReasonLength: Number(options.minimumReasonLength || 2),
    phrase: options.phrase || "",
    busy: false
  });
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function settleConfirmation(confirmed, payload = {}) {
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmState.open = false;
  resolve?.({ confirmed, reason: String(payload.reason || "").trim() });
}

function inputAction(options = {}) {
  if (inputResolver) inputResolver({ confirmed: false, value: "" });
  Object.assign(inputState, {
    open: true,
    title: options.title || "请输入",
    message: options.message || "",
    label: options.label || "内容",
    value: options.value ?? "",
    inputType: options.inputType || "text",
    options: Array.isArray(options.options) ? options.options : [],
    placeholder: options.placeholder || "",
    hint: options.hint || "",
    rows: Number(options.rows || 4),
    maxlength: Number(options.maxlength || 500),
    required: options.required !== false,
    confirmLabel: options.confirmLabel || "确认",
    busy: false
  });
  return new Promise((resolve) => { inputResolver = resolve; });
}

function settleInput(confirmed, value = "") {
  const resolve = inputResolver;
  inputResolver = null;
  inputState.open = false;
  resolve?.({ confirmed, value: String(value || "").trim() });
}

provide("toast", toast);
provide("navigate", switchView);
provide("confirmAction", confirmAction);
provide("inputAction", inputAction);

async function boot() {
  try {
    const [me, version, access] = await Promise.allSettled([
      api("/admin-api/auth/me"),
      api("/health/version"),
      api("/admin-api/auth/access")
    ]);
    const data = me.status === "fulfilled" ? me.value : {};
    if (version.status === "fulfilled") versionInfo.value = version.value || versionInfo.value;
    user.value = data.user ? { ...data.user, role: access.status === "fulfilled" ? access.value.role || "viewer" : "viewer" } : null;
  } catch {
    user.value = null;
  } finally {
    checking.value = false;
  }
}

async function handleLogin(nextUser) {
  user.value = { role: "viewer", ...nextUser };
  const access = await api("/admin-api/auth/access").catch(() => ({ role: "viewer" }));
  user.value.role = access.role || "viewer";
  ensureAllowedRoute();
  toast("登录成功");
}

async function logout() {
  await api("/admin-api/auth/logout", { method: "POST" }).catch(() => {});
  user.value = null;
  toast("已退出");
}

async function backup() {
  if (backupBusy.value) return;
  backupBusy.value = true;
  try {
    const data = await api("/admin-api/backup", { method: "POST", body: JSON.stringify({ type: "postgres" }) });
    toast(data.file ? `数据库备份完成：${data.file}` : "备份完成", "success");
    if (data.file) {
      const link = document.createElement("a");
      link.href = `/admin-api/backup/download?file=${encodeURIComponent(data.file)}`;
      link.download = "";
      link.click();
    }
  } catch (error) {
    toast(error.message || String(error), "error");
  } finally {
    backupBusy.value = false;
  }
}

function handleAuthExpired() {
  if (!user.value) return;
  user.value = null;
  mobileNavOpen.value = false;
  toast("登录状态已失效，请重新登录", "error");
}

watch([() => route.path, visibleNavItems, user], ensureAllowedRoute, { flush: "post" });
watch(mobileNavOpen, (open) => document.body.classList.toggle("admin-nav-open", open));

onMounted(() => window.addEventListener(ADMIN_AUTH_EXPIRED_EVENT, handleAuthExpired));
onBeforeUnmount(() => {
  window.removeEventListener(ADMIN_AUTH_EXPIRED_EVENT, handleAuthExpired);
  document.body.classList.remove("admin-nav-open");
  for (const timer of toastTimers.values()) window.clearTimeout(timer);
  toastTimers.clear();
});

boot();
</script>
