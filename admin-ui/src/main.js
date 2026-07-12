/**
 * [INPUT]: 依赖 Vue 运行时、App 根组件、Admin Router 与全局样式
 * [OUTPUT]: 创建并挂载带路由能力的 Admin 单页应用
 * [POS]: admin-ui/src 的浏览器启动入口，只负责组合基础设施，不承载领域状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

createApp(App).use(router).mount("#app");
