/**
 * [INPUT]: 依赖 Vite、Vue 插件、Admin src/index 与 server-pg 开发代理目标
 * [OUTPUT]: 对外提供 Admin 开发服务器、API 代理及写入根 public 的生产构建配置
 * [POS]: admin-ui 的构建边界，使源码和后端同源契约生成可由 server-pg 直接发布的静态产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/admin-api": "http://localhost:3100",
      "/reader-api": "http://localhost:3100",
      "/setup": "http://localhost:3100",
      "/health": "http://localhost:3100"
    }
  }
});
