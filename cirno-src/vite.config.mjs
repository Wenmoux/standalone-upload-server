import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: process.env.CIRNO_PUBLIC_PATH || '/cirno-app/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src')
    }
  },
  build: {
    outDir: process.env.CIRNO_OUTPUT_DIR || '../public/cirno-app',
    assetsDir: 'static',
    sourcemap: false,
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
