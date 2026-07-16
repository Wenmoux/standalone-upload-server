/**
 * [INPUT]: 依赖 Reader API、分页/断点参数、繁简转换规则、报告写入器与输出目录
 * [OUTPUT]: 对外提供可续跑的书籍/章节繁转简残留扫描状态与报告编排
 * [POS]: cirno-src/scripts 的受控内容诊断组合根，负责请求与断点，展示委托独立模块且输出必须避免泄露凭据与私人正文
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { writeHtml, writeMarkdown } = require('./reader-api-conversion-report')

const ROOT_DIR = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT_DIR, 'docs', 'conversion-scans')
const DEFAULT_BASE_URL = 'http://localhost:3100'
const DEFAULT_SCAN_ID = 'reader-api-conversion-scan'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_RETRIES = 3

const PROTECTED_RESIDUAL_PATTERNS = [
  /著名/g,
  /著作/g,
  /名著/g,
  /原著/g,
  /编著/g,
  /编者著/g,
  /巨著/g,
  /专著/g,
  /译著/g,
  /土著/g,
  /著述/g,
  /著录/g
]

const REGRESSION_CASES = [
  {
    name: '用户反馈混排',
    input: '微信对話框裏，備注为惡毒后媽，发來一條新消息：這个月开始生活費調整到1000塊哦。',
    expectedIncludes: ['微信对话框里', '备注为恶毒后妈', '发来一条新消息', '这个月开始生活费调整到1000块哦']
  },
  {
    name: 'UI 词',
    input: '手機螢幕、支付介面、圖示、扫码槍、兩盒進口巧克力，揣進口袋。',
    expectedIncludes: ['手机屏幕', '支付界面', '图标', '扫码枪', '两盒进口巧克力', '揣进口袋']
  },
  {
    name: '支付倒计时提示',
    input: '【請在三分鐘內完成支付】',
    expectedIncludes: ['【请在三分钟内完成支付】']
  },
  {
    name: '擡头场景',
    input: '江夏擡起头，正好对上林泳心的目光。那雙桃花眼此刻瞪得大大的，瞳孔裏倒映著他和他手裏那部該死的手機。',
    expectedIncludes: ['江夏抬起头', '那双桃花眼', '瞳孔里倒映着', '手里那部该死的手机']
  },
  {
    name: '著字边界',
    input: '猫主席著作和古典名著。她坐在位置上做著作業，强忍著作嘔，起著作用，跟著作美。',
    expectedIncludes: ['猫主席著作', '古典名著', '做着作业', '强忍着作呕', '起着作用', '跟着作美']
  }
]

function parseArgs() {
  const opts = {
    baseUrl: process.env.READER_API_BASE || DEFAULT_BASE_URL,
    scanId: DEFAULT_SCAN_ID,
    tag: '',
    sort: 'cache_desc',
    pageSize: DEFAULT_PAGE_SIZE,
    startPage: 1,
    books: 0,
    all: false,
    reset: false,
    resume: false,
    manifestOnly: false,
    maxChapters: 0,
    issueLimit: 1000,
    hitLimitPerChapter: 10,
    saveEvery: 1,
    requestDelay: 0,
    retries: DEFAULT_RETRIES,
    retryDelay: 1000
  }

  for (const arg of process.argv.slice(2)) {
    const [key, rawValue] = arg.replace(/^--/, '').split('=')
    const value = rawValue === undefined ? '' : rawValue
    if (key === 'base-url') opts.baseUrl = value || opts.baseUrl
    if (key === 'scan-id') opts.scanId = value || opts.scanId
    if (key === 'tag') opts.tag = value || opts.tag
    if (key === 'sort') opts.sort = value || opts.sort
    if (key === 'page-size') opts.pageSize = Number(value || opts.pageSize)
    if (key === 'start-page') opts.startPage = Number(value || opts.startPage)
    if (key === 'books') opts.books = Number(value || opts.books)
    if (key === 'max-chapters') opts.maxChapters = Number(value || opts.maxChapters)
    if (key === 'issue-limit') opts.issueLimit = Number(value || opts.issueLimit)
    if (key === 'hit-limit-per-chapter') opts.hitLimitPerChapter = Number(value || opts.hitLimitPerChapter)
    if (key === 'save-every') opts.saveEvery = Number(value || opts.saveEvery)
    if (key === 'request-delay') opts.requestDelay = Number(value || opts.requestDelay)
    if (key === 'retries') opts.retries = Number(value || opts.retries)
    if (key === 'retry-delay') opts.retryDelay = Number(value || opts.retryDelay)
    if (key === 'all') opts.all = true
    if (key === 'reset') opts.reset = true
    if (key === 'resume') opts.resume = true
    if (key === 'manifest-only') opts.manifestOnly = true
  }

  opts.pageSize = Math.max(1, Math.min(100, opts.pageSize || DEFAULT_PAGE_SIZE))
  opts.startPage = Math.max(1, opts.startPage || 1)
  opts.books = opts.all ? 0 : Math.max(0, opts.books || 0)
  opts.maxChapters = Math.max(0, opts.maxChapters || 0)
  opts.issueLimit = Math.max(10, opts.issueLimit || 1000)
  opts.hitLimitPerChapter = Math.max(1, opts.hitLimitPerChapter || 10)
  opts.saveEvery = Math.max(1, opts.saveEvery || 1)
  opts.requestDelay = Math.max(0, opts.requestDelay || 0)
  opts.retries = Math.max(0, opts.retries || DEFAULT_RETRIES)
  opts.retryDelay = Math.max(100, opts.retryDelay || 1000)
  opts.baseUrl = opts.baseUrl.replace(/\/$/, '')
  return opts
}

function pathsFor(scanId) {
  return {
    state: path.join(OUT_DIR, `${scanId}.state.json`),
    manifest: path.join(OUT_DIR, `${scanId}.manifest.json`),
    json: path.join(OUT_DIR, `${scanId}.json`),
    markdown: path.join(OUT_DIR, `${scanId}.md`),
    html: path.join(OUT_DIR, `${scanId}.html`)
  }
}

function sleep(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

async function getJson(url, opts) {
  let lastError
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
      return await res.json()
    } catch (err) {
      lastError = err
      if (attempt < opts.retries) await sleep(opts.retryDelay * (attempt + 1))
    }
  }
  throw lastError
}

function loadConverter() {
  const OpenCCT2CN = require('opencc-js/t2cn')
  const OpenCCCN2T = require('opencc-js/cn2t')
  const openccToSimplified = OpenCCT2CN.Converter({ from: 'tw', to: 'cn' })
  const sourcePath = path.join(ROOT_DIR, 'src', 'utils', 'chinese-convert.js')
  const originalSource = fs.readFileSync(sourcePath, 'utf8')
  let source = originalSource

  source = source
    .replace(/import \* as OpenCCT2CN[^\n]*\n/, '')
    .replace(/import \* as OpenCCCN2T[^\n]*\n/, '')
    .replace('export function convertText', 'function convertText')
    .replace(/\nexport \{ t2sCharMap, s2tCharMap \}\s*$/, '')

  source += '\nreturn { convertText, t2sCharMap }'
  return Object.assign(Function('OpenCCT2CN', 'OpenCCCN2T', source)(OpenCCT2CN, OpenCCCN2T), {
    openccToSimplified,
    converterInfo: {
      source: 'src/utils/chinese-convert.js',
      sha256: crypto.createHash('sha256').update(originalSource).digest('hex'),
      openccVersion: JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, 'node_modules', 'opencc-js', 'package.json'), 'utf8')
      ).version,
      mode: 'simplified'
    }
  })
}

function inspectReaderWiring() {
  const paragraphPath = path.join(ROOT_DIR, 'src', 'components', 'paragraph.vue')
  const readerPath = path.join(ROOT_DIR, 'src', 'views', 'Reader.vue')
  const paragraph = fs.readFileSync(paragraphPath, 'utf8')
  const reader = fs.readFileSync(readerPath, 'utf8')
  const checks = {
    paragraphImportsConverter: paragraph.includes("import { convertText } from '../utils/chinese-convert'"),
    paragraphCallsConvertText: /convertText\(text,\s*this\.convertMode\)/.test(paragraph),
    readerPassesConvertMode: reader.includes(':convertMode="readerSettings.convertMode"'),
    settingsExposeConvertMode: reader.includes('繁简转换') && reader.includes('value="simplified"'),
    settingsPersistConvertMode: reader.includes("localStorage.setItem('cirnoReaderSettings'")
  }
  return Object.assign(checks, {
    sameAsReader: Object.values(checks).every(Boolean)
  })
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function protectedPositions(text) {
  const positions = new Set()
  for (const pattern of PROTECTED_RESIDUAL_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text))) {
      for (let index = match.index; index < match.index + match[0].length; index += 1) {
        positions.add(index)
      }
    }
  }
  return positions
}

function snippet(text, index, size = 46) {
  return text.slice(Math.max(0, index - size), Math.min(text.length, index + size)).replace(/\s+/g, ' ')
}

function scanMappedChars(text, t2sCharMap, options = {}) {
  const protectedSet = options.ignoreProtected || options.onlyProtected ? protectedPositions(text) : null
  const hits = []
  const counts = {}
  let total = 0

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    const mappedTo = t2sCharMap[ch]
    if (!mappedTo || mappedTo === ch) continue
    const protectedHit = protectedSet && protectedSet.has(index)
    if (options.ignoreProtected && protectedHit) continue
    if (options.onlyProtected && !protectedHit) continue
    total += 1
    counts[ch] = (counts[ch] || 0) + 1
    if (!options.hitLimit || hits.length < options.hitLimit) {
      hits.push({ char: ch, mappedTo, index, snippet: snippet(text, index) })
    }
  }

  return { total, counts, hits }
}

function scanSameFormChars(text, t2sCharMap, hitLimit = 10) {
  const counts = {}
  const hits = []
  let total = 0
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (!t2sCharMap[ch] || t2sCharMap[ch] !== ch) continue
    total += 1
    counts[ch] = (counts[ch] || 0) + 1
    if (hits.length < hitLimit) {
      hits.push({ char: ch, mappedTo: ch, index, snippet: snippet(text, index) })
    }
  }
  return { total, counts, hits }
}

function scanOpenCCAudit(text, openccToSimplified, hitLimit = 10) {
  const audited = openccToSimplified(text)
  if (audited === text) return { total: 0, counts: {}, hits: [] }

  const protectedSet = protectedPositions(text)
  const before = [...text]
  const after = [...audited]
  const limit = Math.min(before.length, after.length)
  const counts = {}
  const hits = []
  let total = Math.abs(before.length - after.length)

  for (let index = 0; index < limit; index += 1) {
    if (before[index] === after[index]) continue
    if (protectedSet.has(index)) continue
    const key = `${before[index]}->${after[index]}`
    total += 1
    counts[key] = (counts[key] || 0) + 1
    if (hits.length < hitLimit) {
      hits.push({
        char: before[index],
        mappedTo: after[index],
        index,
        snippet: snippet(text, index)
      })
    }
  }

  return { total, counts, hits }
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + value
  }
}

function searchUrl(opts, page) {
  const params = new URLSearchParams()
  params.set('sort', opts.sort)
  params.set('limit', String(opts.pageSize))
  params.set('page', String(page))
  if (opts.tag) params.set('tag', opts.tag)
  return `${opts.baseUrl}/reader-api/search?${params.toString()}`
}

async function buildManifest(opts, files) {
  const books = []
  let page = opts.startPage
  let apiTotal = 0
  let pagesFetched = 0
  let skippedNoCache = 0

  while (true) {
    const data = await getJson(searchUrl(opts, page), opts)
    const rows = data.rows || []
    if (page === opts.startPage) apiTotal = Number(data.total || 0)
    if (!rows.length) break
    pagesFetched += 1

    for (const row of rows) {
      if (!Number(row.cache_count || 0)) {
        skippedNoCache += 1
        continue
      }
      books.push({
        book_id: String(row.book_id),
        title: row.title || '',
        author: row.author || '',
        tags: row.tags || '',
        cache_count: Number(row.cache_count || 0),
        total_chapters: Number(row.total_chapters || 0),
        updated_at: row.updated_at || null
      })
      if (opts.books && books.length >= opts.books) break
    }

    if (opts.books && books.length >= opts.books) break
    page += 1
    await sleep(opts.requestDelay)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    tag: opts.tag,
    sort: opts.sort,
    pageSize: opts.pageSize,
    startPage: opts.startPage,
    apiTotal,
    pagesFetched,
    skippedNoCache,
    books
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

function createState(opts, manifest, residualCharCount, converterInfo, readerWiring) {
  return {
    scanId: opts.scanId,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    params: opts,
    converter: converterInfo,
    readerWiring,
    manifest: {
      path: `${opts.scanId}.manifest.json`,
      apiTotal: manifest.apiTotal,
      pagesFetched: manifest.pagesFetched,
      skippedNoCache: manifest.skippedNoCache,
      books: manifest.books.length
    },
    progress: {
      bookIndex: 0,
      processedBookIds: []
    },
    summary: {
      books: 0,
      chapters: 0,
      chars: 0,
      changedChapters: 0,
      beforeHits: 0,
      afterHits: 0,
      protectedAfterHits: 0,
      sameFormAfterHits: 0,
      openccAuditHits: 0,
      openccAuditChapters: 0,
      residualChapters: 0,
      errors: 0,
      residualCharCount
    },
    residualCharCounts: {},
    protectedCharCounts: {},
    sameFormCharCounts: {},
    openccAuditCounts: {},
    issues: [],
    auditIssues: [],
    errors: [],
    regressions: []
  }
}

function ensureStateShape(state) {
  state.summary = state.summary || {}
  state.summary.sameFormAfterHits = state.summary.sameFormAfterHits || 0
  state.summary.openccAuditHits = state.summary.openccAuditHits || 0
  state.summary.openccAuditChapters = state.summary.openccAuditChapters || 0
  state.sameFormCharCounts = state.sameFormCharCounts || {}
  state.openccAuditCounts = state.openccAuditCounts || {}
  state.auditIssues = state.auditIssues || []
  state.regressions = state.regressions || []
  state.issues = state.issues || []
  state.errors = state.errors || []
  state.converter = state.converter || null
  state.readerWiring = state.readerWiring || null
  return state
}

function saveOutputs(files, state) {
  state.updatedAt = new Date().toISOString()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(files.state, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.writeFileSync(files.json, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  writeMarkdown(files.markdown, state)
  writeHtml(files.html, state)
}

function runRegressions(convertText) {
  return REGRESSION_CASES.map(item => {
    const output = convertText(item.input, 'simplified')
    const missing = item.expectedIncludes.filter(part => !output.includes(part))
    return {
      name: item.name,
      input: item.input,
      output,
      expectedIncludes: item.expectedIncludes,
      missing,
      passed: missing.length === 0
    }
  })
}

async function scanBook(opts, state, book, convertText, t2sCharMap, openccToSimplified) {
  const url = `${opts.baseUrl}/reader-api/books/${encodeURIComponent(book.book_id)}/chapters?includeContent=1`
  const data = await getJson(url, opts)
  let chapters = data.rows || []
  if (opts.maxChapters) chapters = chapters.slice(0, opts.maxChapters)

  let bookResidualChapters = 0
  for (const chapter of chapters) {
    const raw = chapter.text || stripHtml(chapter.html || '')
    const converted = convertText(raw, 'simplified')
    const before = scanMappedChars(raw, t2sCharMap)
    const after = scanMappedChars(converted, t2sCharMap, {
      ignoreProtected: true,
      hitLimit: opts.hitLimitPerChapter
    })
    const protectedAfter = scanMappedChars(converted, t2sCharMap, { onlyProtected: true })
    const sameFormAfter = scanSameFormChars(converted, t2sCharMap, opts.hitLimitPerChapter)
    const openccAudit = scanOpenCCAudit(converted, openccToSimplified, opts.hitLimitPerChapter)

    state.summary.chapters += 1
    state.summary.chars += raw.length
    state.summary.beforeHits += before.total
    state.summary.afterHits += after.total
    state.summary.protectedAfterHits += protectedAfter.total
    state.summary.sameFormAfterHits += sameFormAfter.total
    state.summary.openccAuditHits += openccAudit.total
    addCounts(state.protectedCharCounts, protectedAfter.counts)
    addCounts(state.sameFormCharCounts, sameFormAfter.counts)
    addCounts(state.openccAuditCounts, openccAudit.counts)
    if (raw !== converted) state.summary.changedChapters += 1

    if (after.total > 0) {
      bookResidualChapters += 1
      state.summary.residualChapters += 1
      addCounts(state.residualCharCounts, after.counts)
      if (state.issues.length < opts.issueLimit) {
        state.issues.push({
          bookId: book.book_id,
          bookTitle: book.title,
          chapterId: chapter.chapter_id,
          chapterTitle: chapter.title || '',
          afterHits: after.total,
          hits: after.hits
        })
      }
    }
    if (openccAudit.total > 0) {
      state.summary.openccAuditChapters += 1
      if (state.auditIssues.length < opts.issueLimit) {
        state.auditIssues.push({
          bookId: book.book_id,
          bookTitle: book.title,
          chapterId: chapter.chapter_id,
          chapterTitle: chapter.title || '',
          auditHits: openccAudit.total,
          hits: openccAudit.hits
        })
      }
    }
  }

  state.summary.books += 1
  state.progress.bookIndex += 1
  state.progress.processedBookIds.push(book.book_id)
  console.log(
    `[scan] ${state.summary.books}/${state.manifest.books} ${book.book_id} ${book.title} chapters=${chapters.length} residualChapters=${bookResidualChapters}`
  )
}

async function main() {
  const opts = parseArgs()
  const files = pathsFor(opts.scanId)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  if (opts.reset) {
    for (const file of [files.state, files.json, files.markdown, files.html, files.manifest]) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  }

  const { convertText, t2sCharMap, openccToSimplified, converterInfo } = loadConverter()
  const readerWiring = inspectReaderWiring()
  const residualCharCount = Object.keys(t2sCharMap).filter(ch => t2sCharMap[ch] && t2sCharMap[ch] !== ch).length

  let manifest
  if (!opts.reset && fs.existsSync(files.manifest)) {
    manifest = JSON.parse(fs.readFileSync(files.manifest, 'utf8'))
  } else {
    manifest = await buildManifest(opts, files)
  }

  if (opts.manifestOnly) {
    console.log(JSON.stringify({ manifest: files.manifest, books: manifest.books.length }, null, 2))
    return
  }

  let state
  if (opts.resume && fs.existsSync(files.state)) {
    state = JSON.parse(fs.readFileSync(files.state, 'utf8'))
    state.status = 'running'
  } else {
    state = createState(opts, manifest, residualCharCount, converterInfo, readerWiring)
    state.regressions = runRegressions(convertText)
  }
  ensureStateShape(state)
  state.converter = converterInfo
  state.readerWiring = readerWiring

  const processed = new Set(state.progress.processedBookIds || [])
  const startIndex = Math.max(0, Number(state.progress.bookIndex || 0))

  for (let index = startIndex; index < manifest.books.length; index += 1) {
    const book = manifest.books[index]
    if (processed.has(book.book_id)) {
      state.progress.bookIndex = index + 1
      continue
    }

    try {
      await scanBook(opts, state, book, convertText, t2sCharMap, openccToSimplified)
    } catch (err) {
      state.summary.errors += 1
      state.errors.push({ bookId: book.book_id, bookTitle: book.title, error: err.message })
      console.error(`[error] ${book.book_id} ${book.title}: ${err.message}`)
      state.progress.bookIndex = index + 1
    }

    if (state.summary.books % opts.saveEvery === 0) saveOutputs(files, state)
    await sleep(opts.requestDelay)
  }

  state.status = 'finished'
  saveOutputs(files, state)
  console.log(
    JSON.stringify(
      {
        report: files.html,
        json: files.json,
        markdown: files.markdown,
        manifest: files.manifest,
        state: files.state,
        summary: state.summary
      },
      null,
      2
    )
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
