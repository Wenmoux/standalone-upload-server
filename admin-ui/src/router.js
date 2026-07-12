/**
 * [INPUT]: 依赖 vue-router 与 views 下按领域拆分的懒加载页面
 * [OUTPUT]: 对外提供 adminNavItems 导航事实源和 router 路由实例
 * [POS]: admin-ui/src 的页面注册中心，统一 URL、权限元数据与导航顺序
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRouter, createWebHistory } from "vue-router";

export const adminNavItems = [
  { key: "dashboard", label: "总览", path: "/admin/overview", component: () => import("./views/DashboardView.vue") },
  { key: "books", label: "书籍", path: "/admin/books", component: () => import("./views/BooksView.vue") },
  { key: "quality", label: "数据质量", path: "/admin/quality", component: () => import("./views/QualityView.vue") },
  { key: "events", label: "更新记录", path: "/admin/events", component: () => import("./views/EventsView.vue") },
  { key: "users", label: "用户", path: "/admin/users", component: () => import("./views/UsersView.vue") },
  { key: "transactions", label: "币流水", path: "/admin/transactions", component: () => import("./views/TransactionsView.vue") },
  { key: "feedback", label: "反馈统计", path: "/admin/feedback", component: () => import("./views/FeedbackView.vue") },
  { key: "corrections", label: "纠错审核", path: "/admin/corrections", component: () => import("./views/CorrectionsView.vue") },
  { key: "cdks", label: "CDK", path: "/admin/cdks", component: () => import("./views/CdksView.vue") },
  { key: "platforms", label: "平台映射", path: "/admin/platforms", component: () => import("./views/PlatformsView.vue") },
  { key: "booklist", label: "动态榜单", path: "/admin/rank", component: () => import("./views/BooklistView.vue") },
  { key: "telegram", label: "TG Bot", path: "/admin/bot", component: () => import("./views/TelegramView.vue") },
  { key: "po18crawler", label: "PO18 遍历", path: "/admin/crawler", component: () => import("./views/Po18CrawlerView.vue") },
  { key: "jobs", label: "任务中心", path: "/admin/jobs", component: () => import("./views/JobsView.vue") },
  { key: "audit", label: "操作审计", path: "/admin/audit", component: () => import("./views/AuditView.vue") },
  { key: "system", label: "系统", path: "/admin/system", component: () => import("./views/SystemView.vue") }
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
