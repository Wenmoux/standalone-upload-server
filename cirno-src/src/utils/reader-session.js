const SESSION_CACHE_MS = 30000

let sessionCache = {
  checkedAt: 0,
  user: null
}

function clearLegacyToken() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem('login_token')
}

export function markReaderSession(user = {}) {
  clearLegacyToken()
  sessionCache = { checkedAt: Date.now(), user: user || {} }
  return sessionCache.user
}

export function clearReaderSession() {
  clearLegacyToken()
  sessionCache = { checkedAt: 0, user: null }
}

export function cachedReaderUser() {
  return sessionCache.user
}

export async function hasReaderSession(options = {}) {
  clearLegacyToken()
  const now = Date.now()
  if (!options.force && sessionCache.user && now - sessionCache.checkedAt < SESSION_CACHE_MS) return true
  try {
    const response = await fetch('/reader-auth/me', { credentials: 'include' })
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.user) {
      markReaderSession(data.user)
      return true
    }
  } catch {
    // Network failures are handled as a logged-out state by the route guard.
  }
  clearReaderSession()
  return false
}

clearLegacyToken()
