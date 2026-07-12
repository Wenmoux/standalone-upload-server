import { flushOfflineProgress } from './reader-offline'

export const READER_SESSION_CACHE_MS = 30000

let sessionCache = {
  checkedAt: 0,
  status: 'unknown',
  user: null
}
let sessionRequest = null
let sessionRevision = 0

function clearLegacyToken() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('login_token')
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

function setSession(status, user, checkedAt = Date.now()) {
  sessionCache = { checkedAt, status, user: user || null }
  return sessionCache.user
}

export function markReaderSession(user = {}) {
  clearLegacyToken()
  sessionRevision += 1
  const current = setSession('authenticated', user || {})
  if (current?.id) flushOfflineProgress({ ownerId: current.id }).catch(() => {})
  return current
}

export function updateReaderSession(user = {}) {
  const current = sessionCache.user || {}
  return markReaderSession(Object.assign({}, current, user || {}))
}

export function clearReaderSession(options = {}) {
  clearLegacyToken()
  sessionRevision += 1
  const preservedUser = options.preserveUser ? sessionCache.user : null
  if (options.preserveUser && preservedUser) {
    setSession('offline', preservedUser, Date.now())
    return
  }
  setSession(options.unknown ? 'unknown' : 'logged-out', null, options.unknown ? 0 : Date.now())
}

export function cachedReaderUser() {
  return sessionCache.user
}

export function readerSessionState() {
  return Object.assign({}, sessionCache)
}

export async function getReaderSession(options = {}) {
  clearLegacyToken()
  const now = Date.now()
  const fresh = sessionCache.checkedAt > 0 && now - sessionCache.checkedAt < READER_SESSION_CACHE_MS
  if (!options.force && fresh && sessionCache.status !== 'unknown') return sessionCache.user
  if (sessionRequest) return sessionRequest

  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return null

  const requestRevision = sessionRevision
  const request = (async () => {
    try {
      const response = await fetchImpl('/reader-auth/me', { credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (requestRevision !== sessionRevision) return sessionCache.user
      if (response.ok && data.user) return markReaderSession(data.user)
      if (response.status === 401 || response.status === 403 || response.ok) {
        clearReaderSession()
        return null
      }
      clearReaderSession({ unknown: true, preserveUser: true })
      return sessionCache.user
    } catch {
      // A transport failure does not manufacture a logged-out state. It leaves the
      // session unknown so a later online navigation can retry the authoritative API.
      const preserved = sessionCache.user
      clearReaderSession({ unknown: true, preserveUser: true })
      return preserved
    } finally {
      if (sessionRequest === request) sessionRequest = null
    }
  })()
  sessionRequest = request

  return sessionRequest
}

export async function hasReaderSession(options = {}) {
  return Boolean(await getReaderSession(options))
}

clearLegacyToken()
