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
        <div class="chip version-chip"><span>{{ versionBadge }}</span></div>
        <div class="chip"><span class="dot"></span><span>{{ user.username }}</span></div>
        <a class="ghost-button" href="/setup">初始化面板</a>
        <a class="ghost-button" :href="readerLink" target="_blank" rel="noreferrer">阅读器 3200</a>
        <a class="ghost-button" href="/rank" target="_blank" rel="noreferrer">动态榜单</a>
        <button class="secondary" type="button" @click="backup">备份</button>
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
              v-for="(item, index) in navItems"
              :key="item.key"
              type="button"
              :class="{ active: activeView === item.key }"
              @click="switchView(item.key)"
            >
              <span class="nav-index">{{ String(index + 1).padStart(2, "0") }}</span>
              <span>{{ item.label }}</span>
            </button>
          </nav>
        </aside>

        <div class="content">
          <KeepAlive>
            <component :is="activeComponent" :user="user" />
          </KeepAlive>
        </div>
      </div>
    </main>
  </section>

  <ToastHost :message="toastMessage" />
</template>

<script setup>
import { computed, provide, ref } from "vue";
import ToastHost from "./components/ToastHost.vue";
import LoginView from "./views/LoginView.vue";
import DashboardView from "./views/DashboardView.vue";
import BooksView from "./views/BooksView.vue";
import QualityView from "./views/QualityView.vue";
import EventsView from "./views/EventsView.vue";
import UsersView from "./views/UsersView.vue";
import TransactionsView from "./views/TransactionsView.vue";
import FeedbackView from "./views/FeedbackView.vue";
import CorrectionsView from "./views/CorrectionsView.vue";
import CdksView from "./views/CdksView.vue";
import PlatformsView from "./views/PlatformsView.vue";
import BooklistView from "./views/BooklistView.vue";
import TelegramView from "./views/TelegramView.vue";
import Po18CrawlerView from "./views/Po18CrawlerView.vue";
import JobsView from "./views/JobsView.vue";
import SystemView from "./views/SystemView.vue";
import { api } from "./services/api";
import { readerUrl } from "./utils/format";

const navItems = [
  { key: "dashboard", label: "总览", component: DashboardView },
  { key: "books", label: "书籍", component: BooksView },
  { key: "quality", label: "数据质量", component: QualityView },
  { key: "events", label: "更新记录", component: EventsView },
  { key: "users", label: "用户", component: UsersView },
  { key: "transactions", label: "币流水", component: TransactionsView },
  { key: "feedback", label: "反馈统计", component: FeedbackView },
  { key: "corrections", label: "纠错审核", component: CorrectionsView },
  { key: "cdks", label: "CDK", component: CdksView },
  { key: "platforms", label: "平台映射", component: PlatformsView },
  { key: "booklist", label: "动态榜单", component: BooklistView },
  { key: "telegram", label: "TG Bot", component: TelegramView },
  { key: "po18crawler", label: "PO18 遍历", component: Po18CrawlerView },
  { key: "jobs", label: "任务中心", component: JobsView },
  { key: "system", label: "系统", component: SystemView }
];

const checking = ref(true);
const user = ref(null);
const activeView = ref("dashboard");
const toastMessage = ref("");
const versionInfo = ref({ image: "wenmoux/reader:v1.0", version: "1.0.0" });
let toastTimer = 0;

const readerLink = readerUrl();
const activeComponent = computed(() => navItems.find((item) => item.key === activeView.value)?.component || DashboardView);
const activeLabel = computed(() => navItems.find((item) => item.key === activeView.value)?.label || "总览");
const versionBadge = computed(() => {
  const image = versionInfo.value.image || "wenmoux/reader:v1.0";
  const version = versionInfo.value.version || "";
  return version ? `${image} · ${version}` : image;
});

function toast(message) {
  toastMessage.value = message || "";
  window.clearTimeout(toastTimer);
  if (message) toastTimer = window.setTimeout(() => (toastMessage.value = ""), 3200);
}

function switchView(name) {
  activeView.value = name;
}

provide("toast", toast);
provide("navigate", switchView);

async function boot() {
  try {
    const [me, version] = await Promise.allSettled([
      api("/admin-api/auth/me"),
      api("/health/version")
    ]);
    const data = me.status === "fulfilled" ? me.value : {};
    if (version.status === "fulfilled") versionInfo.value = version.value || versionInfo.value;
    user.value = data.user || null;
  } catch {
    user.value = null;
  } finally {
    checking.value = false;
  }
}

function handleLogin(nextUser) {
  user.value = nextUser;
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

boot();
</script>
