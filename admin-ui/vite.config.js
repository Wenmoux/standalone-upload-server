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
