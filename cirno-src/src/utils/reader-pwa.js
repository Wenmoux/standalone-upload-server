/**
 * [INPUT]: 依赖浏览器 Service Worker/online 事件、Reader 会话与离线进度刷新工具
 * [OUTPUT]: 对外提供 registerReaderPwa 和 syncReaderOfflineProgress 生命周期协调函数
 * [POS]: cirno-src/src/utils 的 PWA 运行协调层，连接构建生成的应用壳与账号进度同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { flushOfflineProgress } from './reader-offline'
import { cachedReaderUser } from './reader-session'

let onlineSyncInstalled = false

export function syncReaderOfflineProgress() {
  const user = cachedReaderUser()
  if (!user?.id) return Promise.resolve({ flushed: 0, remaining: 0 })
  return flushOfflineProgress({ ownerId: user.id })
}

export function registerReaderPwa() {
  if (typeof window !== 'undefined' && !onlineSyncInstalled) {
    onlineSyncInstalled = true
    window.addEventListener('online', () => syncReaderOfflineProgress().catch(() => {}))
    if (navigator.onLine) syncReaderOfflineProgress().catch(() => {})
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !import.meta.env.PROD) return null
  const serviceWorkerUrl = `${import.meta.env.BASE_URL || '/'}sw.js`
  const registration = navigator.serviceWorker.register(serviceWorkerUrl, { scope: import.meta.env.BASE_URL || '/' })
  registration.catch(() => {
    // PWA support is progressive; an unavailable service worker must not block reading.
  })
  return registration
}
