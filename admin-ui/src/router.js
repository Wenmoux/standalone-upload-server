/**
 * [INPUT]: 依赖 vue-router 与 views 下按领域拆分的懒加载页面
 * [OUTPUT]: 对外提供 adminNavGroups/adminNavItems 导航事实源和 router 路由实例
 * [POS]: admin-ui/src 的页面注册中心，统一 URL、权限元数据、导航分组与顺序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRouter, createWebHistory } from "vue-router";

export const adminNavGroups = [
  { key: "overview", label: "概览", items: ["dashboard"] },
  { key: "content", label: "内容与质量", items: ["books", "quality", "events", "platforms", "booklist"] },
  { key: "community", label: "用户与治理", items: ["users", "transactions", "feedback", "corrections", "cdks"] },
  { key: "automation", label: "自动化", items: ["telegram", "qqbot", "po18crawler", "jobs"] },
  { key: "operations", label: "系统与审计", items: ["audit", "system"] }
];

export const adminNavItems = [
  { key: "dashboard", group: "overview", label: "总览", path: "/admin/overview", component: () => import("./views/DashboardView.vue") },
  { key: "books", group: "content", label: "书籍", path: "/admin/books", component: () => import("./views/BooksView.vue") },
  { key: "quality", group: "content", label: "数据质量", path: "/admin/quality", component: () => import("./views/QualityView.vue") },
  { key: "events", group: "content", label: "更新记录", path: "/admin/events", component: () => import("./views/EventsView.vue") },
  { key: "platforms", group: "content", label: "平台映射", path: "/admin/platforms", component: () => import("./views/PlatformsView.vue") },
  { key: "booklist", group: "content", label: "动态榜单", path: "/admin/rank", component: () => import("./views/BooklistView.vue") },
  { key: "users", group: "community", label: "用户", path: "/admin/users", component: () => import("./views/UsersView.vue") },
  { key: "transactions", group: "community", label: "币流水", path: "/admin/transactions", component: () => import("./views/TransactionsView.vue") },
  { key: "feedback", group: "community", label: "反馈统计", path: "/admin/feedback", component: () => import("./views/FeedbackView.vue") },
  { key: "corrections", group: "community", label: "纠错审核", path: "/admin/corrections", component: () => import("./views/CorrectionsView.vue") },
  { key: "cdks", group: "community", label: "CDK", path: "/admin/cdks", component: () => import("./views/CdksView.vue") },
  { key: "telegram", group: "automation", label: "TG Bot", path: "/admin/bot", component: () => import("./views/TelegramView.vue") },
  { key: "qqbot", group: "automation", label: "QQ Bot", path: "/admin/qq-bot", component: () => import("./views/QqBotView.vue") },
  { key: "po18crawler", group: "automation", label: "PO18 遍历", path: "/admin/crawler", component: () => import("./views/Po18CrawlerView.vue") },
  { key: "jobs", group: "automation", label: "任务中心", path: "/admin/jobs", component: () => import("./views/JobsView.vue") },
  { key: "audit", group: "operations", label: "操作审计", path: "/admin/audit", component: () => import("./views/AuditView.vue") },
  { key: "system", group: "operations", label: "系统", path: "/admin/system", component: () => import("./views/SystemView.vue") }
];

const routes = [
  { path: "/", redirect: "/admin/overview" },
  ...adminNavItems.map((item) => ({
    path: item.path,
    name: item.key,
    component: item.component,
    meta: { view: item.key, label: item.label }
  })),
  { path: "/:pathMatch(.*)*", redirect: "/admin/overview" }
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});
