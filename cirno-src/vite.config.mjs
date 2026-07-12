/**
 * [INPUT]: 依赖 Vite/Vue 插件、Reader 源码、路径别名与 reader-pwa-plugin
 * [OUTPUT]: 对外提供 Reader 开发代理、standalone 输出、分包及 PWA 构建配置
 * [POS]: cirno-src 的构建组合根，把浏览器源码转为 dist-reader 并保持 API 网络边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readerPwaPlugin } from './scripts/reader-pwa-plugin.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: process.env.CIRNO_PUBLIC_PATH || '/cirno-app/',
  plugins: [vue(), readerPwaPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src')
    }
  },
  build: {
    outDir: process.env.CIRNO_OUTPUT_DIR || '../public/cirno-app',
    assetsDir: 'static',
    sourcemap: false,
    manifest: true,
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0',
    port: 9012,
    open: false,
    proxy: {
      '/reader-api': {
        target: 'http://localhost:3100',
        changeOrigin: true
      },
      '/reader-auth': {
        target: 'http://localhost:3100',
        changeOrigin: true
      }
    }
  }
})
