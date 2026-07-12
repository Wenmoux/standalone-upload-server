<template>
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
        <div class="chip version-chip" :title="versionTitle"><span>{{ versionBadge }}</span></div>
        <div class="chip"><span class="dot"></span><span>{{ user.username }} · {{ roleLabel }}</span></div>
        <a v-if="user.role === 'owner'" class="ghost-button" href="/setup">初始化面板</a>
        <a class="ghost-button" :href="readerLink" target="_blank" rel="noreferrer">阅读器 3200</a>
        <a class="ghost-button" href="/rank" target="_blank" rel="noreferrer">动态榜单</a>
        <button v-if="['owner', 'operator'].includes(user.role || 'owner')" class="secondary" type="button" @click="backup">备份</button>
        <button class="secondary" type="button" @click="logout">退出</button>
      </div>
    </header>

    <main class="page-main admin-main">
      <div class="layout admin-layout">
        <aside class="summary admin-sidebar">
          <h1>管理面板</h1>
          <p class="lead">书库数据、读者体系、Bot 推送和容器运行状态集中在这里。</p>
          <div class="sidebar-status">
            <span>当前页面</span>
            <strong>{{ activeLabel }}</strong>
          </div>
          <nav class="nav admin-nav">
            <button
              v-for="(item, index) in visibleNavItems"
              :key="item.key"
              type="button"
              :class="{ active: activeView === item.key }"
              @click="switchView(item.key)"
            >
              <span class="nav-index">{{ String(index + 1).padStart(2, "0") }}</span>
              <span>{{ item.label }}</span>
            </button>
          </nav>
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

        <div class="content">
          <RouterView v-slot="{ Component }">
            <KeepAlive>
              <component :is="Component" :user="user" />
            </KeepAlive>
          </RouterView>
        </div>
      </div>
    </main>
  </section>

  <ToastHost :message="toastMessage" />
  <ConfirmDialog v-bind="confirmState" @cancel="settleConfirmation(false)" @confirm="settleConfirmation(true, $event)" />
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue/Router、登录与全局交互组件、Admin API 和 Reader 地址工具
 * [OUTPUT]: 提供认证门禁、导航外壳、权限上下文、全局提示/确认服务与备份快捷动作
 * [POS]: admin-ui/src 的应用组合根，协调会话和跨页面能力，领域视图在其下按路由装载
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, provide, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ToastHost from "./components/ToastHost.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import LoginView from "./views/LoginView.vue";
import { adminNavItems as navItems } from "./router";
import { api } from "./services/api";
import { readerUrl } from "./utils/format";

const SAVED_VIEWS_KEY = "po18AdminSavedViews";
const route = useRoute();
const router = useRouter();

const checking = ref(true);
const user = ref(null);
const toastMessage = ref("");
const versionInfo = ref({ image: "wenmoux/reader:v2.0", version: "2.0.0" });
const savedViews = ref(loadSavedViews());
let toastTimer = 0;
let confirmResolver = null;
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

function toast(message) {
  toastMessage.value = message || "";
  window.clearTimeout(toastTimer);
  if (message) toastTimer = window.setTimeout(() => (toastMessage.value = ""), 3200);
}

function switchView(name, options = {}) {
  const item = navItems.find((entry) => entry.key === name);
  if (!item) return;
  const query = options && typeof options === "object" && options.query ? options.query : undefined;
  router.push({ path: item.path, ...(query ? { query } : {}) });
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

provide("toast", toast);
provide("navigate", switchView);
provide("confirmAction", confirmAction);

async function boot() {
  try {
    const [me, version, access] = await Promise.allSettled([
      api("/admin-api/auth/me"),
      api("/health/version"),
      api("/admin-api/auth/access")
    ]);
    const data = me.status === "fulfilled" ? me.value : {};
    if (version.status === "fulfilled") versionInfo.value = version.value || versionInfo.value;
    user.value = data.user ? { ...data.user, role: access.status === "fulfilled" ? access.value.role || "owner" : "owner" } : null;
  } catch {
    user.value = null;
  } finally {
    checking.value = false;
  }
}

async function handleLogin(nextUser) {
  user.value = { role: "owner", ...nextUser };
  const access = await api("/admin-api/auth/access").catch(() => ({ role: "owner" }));
  user.value.role = access.role || "owner";
  ensureAllowedRoute();
  toast("登录成功");
}

async function logout() {
  await api("/admin-api/auth/logout", { method: "POST" }).catch(() => {});
  user.value = null;
  toast("已退出");
}

async function backup() {
  const data = await api("/admin-api/backup", { method: "POST", body: JSON.stringify({ type: "postgres" }) });
  toast(data.file ? `数据库备份完成：${data.file}` : "备份完成");
  if (data.file) window.open(`/admin-api/backup/download?file=${encodeURIComponent(data.file)}`, "_blank");
}

watch([() => route.path, visibleNavItems, user], ensureAllowedRoute, { flush: "post" });

boot();
</script>
