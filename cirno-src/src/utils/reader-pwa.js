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
