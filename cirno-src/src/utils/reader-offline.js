const DB_NAME = 'po18-reader-offline'
const DB_VERSION = 2
const STORE_NAME = 'chapters'
const MAX_RECENT_CHAPTERS = 12
const PROGRESS_STORAGE_KEY = 'po18-reader-offline-progress-v1'
export const MAX_OFFLINE_CHAPTER_BYTES = 2 * 1024 * 1024

const CHAPTER_FIELDS = [
  'chapter_id',
  'chapter_title',
  'txt_content',
  'html_content',
  'author_say',
  'auth_access',
  'platform',
  'is_ihuaben',
  'is_local_plain',
  'is_volume'
]

function chapterKey(ownerId, bookId, chapterId) {
  return JSON.stringify([String(ownerId || ''), String(bookId || ''), String(chapterId || '')])
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function openDatabase(indexedDBImpl) {
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = event => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('bookId', 'bookId', { unique: false })
        store.createIndex('ownerId', 'ownerId', { unique: false })
      } else if (event.oldVersion < 2) {
        // Version 1 keys were not partitioned by reader account. Purge them rather
        // than risk exposing one local user's cached chapters to another login.
        const store = request.transaction.objectStore(STORE_NAME)
        store.clear()
        if (!store.indexNames.contains('ownerId')) store.createIndex('ownerId', 'ownerId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open offline reader storage'))
  })
}

function createIndexedDbBackend(indexedDBImpl) {
  let databasePromise = null
  const database = () => {
    if (!databasePromise) databasePromise = openDatabase(indexedDBImpl)
    return databasePromise
  }
  const store = async mode => (await database()).transaction(STORE_NAME, mode).objectStore(STORE_NAME)
  return {
    async get(key) {
      return requestResult((await store('readonly')).get(key))
    },
    async put(value) {
      await requestResult((await store('readwrite')).put(value))
      return value
    },
    async delete(key) {
      await requestResult((await store('readwrite')).delete(key))
    },
    async getAll() {
      return requestResult((await store('readonly')).getAll())
    }
  }
}

export function createMemoryOfflineBackend() {
  const records = new Map()
  return {
    async get(key) {
      return records.get(key)
    },
    async put(value) {
      records.set(value.key, value)
      return value
    },
    async delete(key) {
      records.delete(key)
    },
    async getAll() {
      return Array.from(records.values())
    }
  }
}

function browserStorage(storage) {
  if (storage !== undefined) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function readProgressQueue(storage) {
  storage = browserStorage(storage)
  if (!storage) return []
  try {
    const rows = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && row.ownerId && row.bookId) : []
  } catch {
    return []
  }
}

function writeProgressQueue(rows, storage) {
  storage = browserStorage(storage)
  if (!storage) return
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(rows.slice(-100)))
  } catch {
    // Progress syncing is best effort when browser storage is unavailable.
  }
}

export function rememberOfflineProgress(input = {}, storage) {
  const ownerId = String(input.ownerId || '')
  const bookId = String(input.bookId || '')
  const chapterId = String(input.chapterId || '')
  if (!ownerId || !bookId || !chapterId) return null
  const rows = readProgressQueue(storage)
  const key = JSON.stringify([ownerId, bookId])
  const index = rows.findIndex(row => row.key === key)
  const previous = index >= 0 ? rows[index] : {}
  const record = {
    key,
    ownerId,
    bookId,
    chapterId,
    progress: Math.max(0, Math.min(1, Number(input.progress || 0))),
    readingSeconds: Math.min(24 * 60 * 60, Math.max(0, Number(previous.readingSeconds || 0) + Number(input.readingSeconds || 0))),
    updatedAt: Date.now()
  }
  if (index >= 0) rows.splice(index, 1)
  rows.push(record)
  writeProgressQueue(rows, storage)
  return record
}

export async function flushOfflineProgress(options = {}) {
  const ownerId = String(options.ownerId || '')
  const storage = browserStorage(options.storage)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (!ownerId || typeof fetchImpl !== 'function') return { flushed: 0, remaining: readProgressQueue(storage).length }
  const rows = readProgressQueue(storage)
  const remaining = []
  let flushed = 0
  for (const row of rows) {
    if (row.ownerId !== ownerId) {
      remaining.push(row)
      continue
    }
    try {
      const response = await fetchImpl('/reader-api/me/history', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: row.bookId,
          chapterId: row.chapterId,
          progress: row.progress,
          readingSeconds: row.readingSeconds
        })
      })
      if (!response.ok) {
        if (response.status !== 401 && response.status !== 403) remaining.push(row)
        continue
      }
      flushed += 1
    } catch {
      remaining.push(row)
    }
  }
  writeProgressQueue(remaining, storage)
  return { flushed, remaining: remaining.length }
}

export function sanitizeOfflineChapter(chapter = {}) {
  const clean = {}
  for (const field of CHAPTER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(chapter, field)) continue
    if (field.startsWith('is_')) clean[field] = Boolean(chapter[field])
    else clean[field] = String(chapter[field] == null ? '' : chapter[field])
  }
  clean.chapter_id = String(clean.chapter_id || chapter.id || '')
  clean.chapter_title = String(clean.chapter_title || clean.chapter_id)
  clean.is_local_plain = true

  const bytes = new TextEncoder().encode(JSON.stringify(clean)).byteLength
  if (bytes > MAX_OFFLINE_CHAPTER_BYTES) throw new Error('Chapter is too large for offline storage')
  return clean
}

export function createReaderOfflineStore(options = {}) {
  const indexedDBImpl = options.indexedDBImpl || globalThis.indexedDB
  const backend = options.backend || (indexedDBImpl ? createIndexedDbBackend(indexedDBImpl) : null)
  const recentLimit = Math.max(1, Number(options.recentLimit || MAX_RECENT_CHAPTERS))
  const now = options.now || Date.now
  let progressStorage = options.storage
  if (progressStorage === undefined) {
    try {
      progressStorage = globalThis.localStorage
    } catch {
      progressStorage = null
    }
  }

  async function allRecords() {
    if (!backend) return []
    return (await backend.getAll()) || []
  }

  async function trimRecentChapters(ownerId) {
    if (!backend) return
    const recent = (await allRecords())
      .filter(record => record.ownerId === String(ownerId || '') && !record.pinned)
      .sort((a, b) => Number(b.lastOpenedAt || b.savedAt) - Number(a.lastOpenedAt || a.savedAt))
    await Promise.all(recent.slice(recentLimit).map(record => backend.delete(record.key)))
  }

  async function saveChapter(input = {}, saveOptions = {}) {
    if (!backend) return null
    const bookId = String(input.bookId || '')
    const chapterId = String(input.chapterId || input.chapter?.chapter_id || '')
    const ownerId = String(input.ownerId || '')
    if (!ownerId || !bookId || !chapterId) throw new Error('ownerId, bookId and chapterId are required for offline storage')
    const key = chapterKey(ownerId, bookId, chapterId)
    const previous = (await backend.get(key)) || {}
    const currentTime = now()
    const record = {
      key,
      ownerId,
      bookId,
      chapterId,
      bookTitle: String(input.bookTitle || previous.bookTitle || bookId),
      chapterTitle: String(input.chapterTitle || input.chapter?.chapter_title || previous.chapterTitle || chapterId),
      chapterOrder: Number.isFinite(Number(input.chapterOrder)) ? Number(input.chapterOrder) : Number(previous.chapterOrder || 0),
      chapter: sanitizeOfflineChapter(input.chapter || previous.chapter || {}),
      pinned: saveOptions.pinned === true || (saveOptions.pinned !== false && Boolean(previous.pinned)),
      savedAt: Number(previous.savedAt || currentTime),
      lastOpenedAt: currentTime
    }
    await backend.put(record)
    await trimRecentChapters(ownerId)
    return record
  }

  return {
    async rememberRecentChapter(input) {
      return saveChapter(input, {})
    },
    async pinChapter(input) {
      return saveChapter(input, { pinned: true })
    },
    async getChapter(ownerId, bookId, chapterId) {
      if (!backend) return null
      return (await backend.get(chapterKey(ownerId, bookId, chapterId))) || null
    },
    async hasChapter(ownerId, bookId, chapterId) {
      return Boolean(await this.getChapter(ownerId, bookId, chapterId))
    },
    async removeChapter(ownerId, bookId, chapterId) {
      if (backend) await backend.delete(chapterKey(ownerId, bookId, chapterId))
    },
    async listBookChapters(ownerId, bookId) {
      const owner = String(ownerId || '')
      const value = String(bookId || '')
      return (await allRecords())
        .filter(record => record.ownerId === owner && record.bookId === value)
        .sort((a, b) => Number(a.chapterOrder || 0) - Number(b.chapterOrder || 0))
    },
    async clearOwner(ownerId) {
      const owner = String(ownerId || '')
      const progressRows = readProgressQueue(progressStorage).filter(record => record.ownerId !== owner)
      writeProgressQueue(progressRows, progressStorage)
      if (!backend) return 0
      const rows = (await allRecords()).filter(record => record.ownerId === owner)
      await Promise.all(rows.map(record => backend.delete(record.key)))
      return rows.length
    }
  }
}

const readerOfflineStore = createReaderOfflineStore()

export const rememberRecentChapter = input => readerOfflineStore.rememberRecentChapter(input)
export const pinOfflineChapter = input => readerOfflineStore.pinChapter(input)
export const getOfflineChapter = (ownerId, bookId, chapterId) => readerOfflineStore.getChapter(ownerId, bookId, chapterId)
export const hasOfflineChapter = (ownerId, bookId, chapterId) => readerOfflineStore.hasChapter(ownerId, bookId, chapterId)
export const removeOfflineChapter = (ownerId, bookId, chapterId) => readerOfflineStore.removeChapter(ownerId, bookId, chapterId)
export const listOfflineBookChapters = (ownerId, bookId) => readerOfflineStore.listBookChapters(ownerId, bookId)
export const clearOfflineOwner = ownerId => readerOfflineStore.clearOwner(ownerId)
