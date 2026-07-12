/**
 * [INPUT]: 依赖 Vite bundle、公开应用壳、crypto 指纹与 Service Worker 模板
 * [OUTPUT]: 对外提供 生成带内容指纹的 Reader PWA manifest/precache/Service Worker
 * [POS]: cirno-src/scripts 的构建插件，明确绕过认证 API 并只缓存公开壳资源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const STATIC_EXTENSIONS = /\.(?:css|js|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$/i

export function readerPwaPlugin() {
  let base = '/'
  let publicDir = ''
  return {
    name: 'reader-pwa-shell',
    apply: 'build',
    configResolved(config) {
      base = config.base || '/'
      publicDir = config.publicDir || ''
    },
    generateBundle(_options, bundle) {
      const generatedFiles = Object.values(bundle)
        .map(item => item.fileName)
        .filter(fileName => fileName === 'index.html' || STATIC_EXTENSIONS.test(fileName))
        .sort()
      const shellFiles = Array.from(new Set(['index.html', 'manifest.webmanifest', 'favicon.ico', 'pwa-icon.svg', 'pwa-icon-192.png', 'pwa-icon-512.png', ...generatedFiles]))
      const fingerprint = createHash('sha256').update(`${base}\n`)
      for (const item of Object.values(bundle).sort((left, right) => left.fileName.localeCompare(right.fileName))) {
        fingerprint.update(item.fileName)
        fingerprint.update('\0')
        fingerprint.update(String(item.code || item.source || ''))
        fingerprint.update('\0')
      }
      for (const file of ['manifest.webmanifest', 'favicon.ico', 'pwa-icon.svg', 'pwa-icon-192.png', 'pwa-icon-512.png']) {
        try {
          fingerprint.update(readFileSync(path.join(publicDir, file)))
        } catch {
          fingerprint.update(file)
        }
      }
      const version = fingerprint.digest('hex').slice(0, 12)
      const source = `const CACHE_PREFIX = 'po18-reader-shell-'
const CACHE_NAME = CACHE_PREFIX + '${version}'
const SHELL_FILES = ${JSON.stringify(shellFiles)}
const scopeUrl = new URL(self.registration.scope)
const shellUrls = new Set(SHELL_FILES.map(file => new URL(file, scopeUrl).href))

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(Array.from(shellUrls))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== scopeUrl.origin || /\\/reader-(?:auth|api)(?:\\/|$)/.test(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('index.html', scopeUrl))).then(response => response || Response.error())
    )
    return
  }

  if (!shellUrls.has(url.href)) return
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)))
})
`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    }
  }
}
