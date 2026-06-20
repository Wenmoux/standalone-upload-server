const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

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
      openccVersion: JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'node_modules', 'opencc-js', 'package.json'), 'utf8')).version,
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

function topCounts(counts, limit = 40) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, limit)
    .map(([char, count]) => ({ char, count }))
}

function num(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
  console.log(`[scan] ${state.summary.books}/${state.manifest.books} ${book.book_id} ${book.title} chapters=${chapters.length} residualChapters=${bookResidualChapters}`)
}

function writeMarkdown(filePath, state) {
  const s = state.summary
  const regressionRows = state.regressions
    .map(item => `| ${item.passed ? '通过' : '失败'} | ${item.name} | ${item.missing.join('、') || '无'} |`)
    .join('\n')
  const issueRows = state.issues
    .slice(0, 100)
    .map(item => {
      const hits = item.hits.map(hit => `- \`${hit.char}\` -> \`${hit.mappedTo}\`：${hit.snippet}`).join('\n')
      return `### ${item.bookTitle} / ${item.chapterTitle || item.chapterId}\n\n- 书号：${item.bookId}\n- 章节ID：${item.chapterId}\n- 残留命中：${item.afterHits}\n\n${hits}`
    })
    .join('\n\n') || '无异常残留。'

  const md = `# Reader API 繁转简正文扫描报告

## 汇总

| 字段 | 值 |
| --- | ---: |
| 状态 | ${state.status} |
| 标签筛选 | ${state.params.tag || '无'} |
| 书单总数 | ${state.manifest.books} |
| 已扫描书籍 | ${s.books} |
| 已扫描章节 | ${s.chapters} |
| 已扫描字符 | ${num(s.chars)} |
| 转换前映射命中 | ${num(s.beforeHits)} |
| 转换后异常残留 | ${num(s.afterHits)} |
| 保护性保留 | ${num(s.protectedAfterHits)} |
| 同形字提示 | ${num(s.sameFormAfterHits)} |
| OpenCC 偏好提示 | ${num(s.openccAuditHits)} |
| 异常章节 | ${s.residualChapters} |
| OpenCC 偏好提示章节 | ${s.openccAuditChapters} |
| 错误 | ${s.errors} |

## 阅读器一致性

| 字段 | 值 |
| --- | --- |
| 转换源文件 | ${state.converter ? state.converter.source : '未知'} |
| 转换源 SHA256 | ${state.converter ? state.converter.sha256 : '未知'} |
| OpenCC 版本 | ${state.converter ? state.converter.openccVersion : '未知'} |
| 扫描模式 | ${state.converter ? state.converter.mode : '未知'} |
| paragraph.vue 引用同一转换器 | ${state.readerWiring?.paragraphImportsConverter ? '是' : '否'} |
| paragraph.vue 使用 convertMode 调用 | ${state.readerWiring?.paragraphCallsConvertText ? '是' : '否'} |
| Reader.vue 传入 convertMode | ${state.readerWiring?.readerPassesConvertMode ? '是' : '否'} |
| 结论 | ${state.readerWiring?.sameAsReader ? '一致' : '需要检查'} |

## 回归用例

| 状态 | 用例 | 缺失 |
| --- | --- | --- |
${regressionRows}

## 残留字符 TOP

${topCounts(state.residualCharCounts, 40).map(item => `- \`${item.char}\`：${item.count}`).join('\n') || '无'}

## 保护性保留 TOP

${topCounts(state.protectedCharCounts, 40).map(item => `- \`${item.char}\`：${item.count}`).join('\n') || '无'}

## 同形字提示 TOP

${topCounts(state.sameFormCharCounts, 40).map(item => `- \`${item.char}\`：${item.count}`).join('\n') || '无'}

## OpenCC 偏好提示 TOP

${topCounts(state.openccAuditCounts, 40).map(item => `- \`${item.char}\`：${item.count}`).join('\n') || '无'}

## 异常样例

${issueRows}
`
  fs.writeFileSync(filePath, md, 'utf8')
}

function renderCountChips(counts, t2sCharMap) {
  const rows = topCounts(counts, 80)
  if (!rows.length) return '<span class="muted">EMPTY</span>'
  return `<div class="chips">${rows
    .map(item => `<span class="chip"><b>${esc(item.char)}</b><span>${esc(t2sCharMap ? t2sCharMap[item.char] || '' : '')}</span><em>${num(item.count)}</em></span>`)
    .join('')}</div>`
}

function writeHtml(filePath, state) {
  const s = state.summary
  const passed = state.status === 'finished' && s.afterHits === 0 && s.errors === 0 && state.regressions.every(item => item.passed)
  const issueRows = state.issues.slice(0, 500).map(item => `
    <tr>
      <td>${esc(item.bookId)}</td>
      <td>${esc(item.bookTitle)}</td>
      <td>${esc(item.chapterId)}</td>
      <td>${esc(item.chapterTitle)}</td>
      <td>${num(item.afterHits)}</td>
      <td>${item.hits.map(hit => `<div class="hit-line"><b>${esc(hit.char)}</b><span>${esc(hit.snippet)}</span></div>`).join('')}</td>
    </tr>`).join('') || '<tr><td colspan="6"><span class="muted">无异常残留</span></td></tr>'

  const regressionRows = state.regressions.map(item => `
    <tr>
      <td><span class="badge ${item.passed ? 'ok' : 'fail'}">${item.passed ? 'PASS' : 'FAIL'}</span></td>
      <td>${esc(item.name)}</td>
      <td><pre>${esc(item.input)}</pre></td>
      <td><pre>${esc(item.output)}</pre></td>
      <td>${item.missing.length ? esc(item.missing.join(' / ')) : '<span class="muted">NONE</span>'}</td>
    </tr>`).join('')

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reader API Conversion Scan</title>
  <style>
    :root{--paper:#f6f7f1;--ink:#141414;--panel:#fffdf5;--cyan:#00a7b5;--pink:#f0457a;--yellow:#ffd84d;--green:#16a34a;--red:#dc2626;--muted:#60646c}
    *{box-sizing:border-box}
    body{margin:0;color:var(--ink);background-color:var(--paper);background-image:linear-gradient(#d9dce2 1px,transparent 1px),linear-gradient(90deg,#d9dce2 1px,transparent 1px);background-size:18px 18px;font:14px/1.55 Consolas,"Courier New","Microsoft YaHei",monospace}
    .wrap{max-width:1320px;margin:0 auto;padding:26px}
    header{border:3px solid var(--ink);background:var(--panel);box-shadow:8px 8px 0 var(--ink);padding:18px;margin-bottom:22px;display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}
    h1,h2,h3{margin:0;letter-spacing:0}h1{font-size:28px;text-transform:uppercase}h2{font-size:18px;text-transform:uppercase}
    h3{font-size:13px;margin:18px 0 8px;padding-left:8px;border-left:10px solid var(--cyan);text-transform:uppercase}
    .subline{color:var(--muted);margin-top:6px}
    .badge{display:inline-flex;align-items:center;justify-content:center;min-width:76px;padding:4px 8px;border:2px solid var(--ink);background:white;box-shadow:3px 3px 0 var(--ink);font-weight:700;text-transform:uppercase}
    .badge.ok{background:#dff8e8;color:var(--green)}.badge.fail{background:#ffe1e7;color:var(--red)}.badge.warn{background:#fff3b0;color:#8a5a00}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
    .metric,.panel{border:3px solid var(--ink);background:var(--panel);box-shadow:6px 6px 0 var(--ink)}
    .metric{padding:14px;min-height:106px;position:relative}.metric:after{content:"";position:absolute;right:8px;top:8px;width:14px;height:14px;background:var(--yellow);border:2px solid var(--ink)}
    .metric span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase}.metric strong{display:block;font-size:25px;line-height:1.2;margin-top:8px}.metric em{display:block;color:var(--muted);font-style:normal;margin-top:8px}
    .panel{padding:16px;margin:18px 0;overflow:hidden}.section-title{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid var(--ink);padding-bottom:10px;margin-bottom:12px}
    .mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mini-grid div{border:2px solid var(--ink);padding:9px;background:white}.mini-grid span{display:block;color:var(--muted);font-size:11px}.mini-grid strong{display:block;font-size:15px;margin-top:4px}
    .note{border:2px dashed var(--ink);background:#eaffff;padding:12px;margin-top:10px}
    table{width:100%;border-collapse:collapse;background:white;border:2px solid var(--ink)}th,td{border:2px solid var(--ink);padding:8px;vertical-align:top;text-align:left}th{background:#141414;color:white;font-size:12px;text-transform:uppercase;white-space:nowrap}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;font-family:"Microsoft YaHei",Consolas,monospace}
    .muted{color:var(--muted)}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{display:inline-flex;gap:7px;align-items:center;border:2px solid var(--ink);background:white;padding:5px 8px;box-shadow:3px 3px 0 var(--ink)}.chip b{color:var(--pink);font-size:16px}.chip span{color:var(--cyan);font-weight:700}.chip em{color:var(--muted);font-style:normal}.hit-line{margin-bottom:7px}.hit-line b{color:var(--pink);font-size:17px;margin-right:8px}
    @media(max-width:980px){.wrap{padding:14px}header{display:block}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.mini-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Reader API Conversion Scan</h1>
        <div class="subline">TAG: ${esc(state.params.tag || 'ALL')} · UPDATED: ${esc(new Date(state.updatedAt).toLocaleString('zh-CN'))}</div>
      </div>
      <span class="badge ${passed ? 'ok' : 'fail'}">${passed ? 'ALL PASS' : 'CHECK'}</span>
    </header>

    <div class="metrics">
      <div class="metric"><span>Books / Chapters</span><strong>${num(s.books)} / ${num(s.chapters)}</strong><em>manifest ${num(state.manifest.books)}</em></div>
      <div class="metric"><span>Characters</span><strong>${num(s.chars)}</strong><em>reader-api cached text</em></div>
      <div class="metric"><span>Residual</span><strong>${num(s.afterHits)}</strong><em>${num(s.residualChapters)} chapters</em></div>
      <div class="metric"><span>Hints</span><strong>${num(s.sameFormAfterHits)}</strong><em>opencc pref ${num(s.openccAuditHits)}</em></div>
    </div>

    <section class="panel">
      <div class="section-title"><h2>Scan Scope</h2><span class="badge ${state.status === 'finished' ? 'ok' : 'warn'}">${esc(state.status)}</span></div>
      <div class="mini-grid">
        <div><span>API TOTAL</span><strong>${num(state.manifest.apiTotal)}</strong></div>
        <div><span>PAGES</span><strong>${num(state.manifest.pagesFetched)}</strong></div>
        <div><span>SKIP NO CACHE</span><strong>${num(state.manifest.skippedNoCache)}</strong></div>
        <div><span>DETECT CHARS</span><strong>${num(s.residualCharCount)}</strong></div>
      </div>
      <div class="note">扫描先冻结 /reader-api/search 返回的书单，再按 manifest 逐本读取 /reader-api/books/:bookId/chapters?includeContent=1。检测字符表从当前 src/utils/chinese-convert.js 的 t2sCharMap 动态生成，避免检测脚本和阅读器规则不同步。</div>
    </section>

    <section class="panel">
      <div class="section-title"><h2>Converter Consistency</h2><span class="badge ${state.readerWiring?.sameAsReader ? 'ok' : 'fail'}">${state.readerWiring?.sameAsReader ? 'MATCH' : 'CHECK'}</span></div>
      <div class="mini-grid">
        <div><span>SOURCE</span><strong>${esc(state.converter?.source || 'unknown')}</strong></div>
        <div><span>SHA256</span><strong>${esc((state.converter?.sha256 || '').slice(0, 12))}</strong></div>
        <div><span>OPENCC</span><strong>${esc(state.converter?.openccVersion || 'unknown')}</strong></div>
        <div><span>MODE</span><strong>${esc(state.converter?.mode || 'unknown')}</strong></div>
      </div>
      <div class="note">
        paragraph.vue import 同一转换器：${state.readerWiring?.paragraphImportsConverter ? 'YES' : 'NO'}；
        paragraph.vue 使用 convertText(text, this.convertMode)：${state.readerWiring?.paragraphCallsConvertText ? 'YES' : 'NO'}；
        Reader.vue 传入 readerSettings.convertMode：${state.readerWiring?.readerPassesConvertMode ? 'YES' : 'NO'}。
      </div>
    </section>

    <section class="panel">
      <div class="section-title"><h2>Global Lexicon</h2></div>
      <h3>RESIDUAL AFTER</h3>
      ${renderCountChips(state.residualCharCounts)}
      <h3>PROTECTED KEEP</h3>
      ${renderCountChips(state.protectedCharCounts)}
      <h3>SAME-FORM NOTE</h3>
      ${renderCountChips(state.sameFormCharCounts)}
      <h3>OPENCC PREFERENCE CHECK</h3>
      ${renderCountChips(state.openccAuditCounts)}
    </section>

    <section class="panel">
      <div class="section-title"><h2>Regression Cases</h2></div>
      <table><thead><tr><th>Status</th><th>Case</th><th>Input</th><th>Output</th><th>Missing</th></tr></thead><tbody>${regressionRows}</tbody></table>
    </section>

    <section class="panel">
      <div class="section-title"><h2>Residual Samples</h2><span class="badge ${s.afterHits ? 'fail' : 'ok'}">${s.afterHits ? 'FOUND' : 'CLEAN'}</span></div>
      <table><thead><tr><th>Book</th><th>Title</th><th>Chapter</th><th>Chapter Title</th><th>Hits</th><th>Context</th></tr></thead><tbody>${issueRows}</tbody></table>
    </section>
  </div>
</body>
</html>`
  fs.writeFileSync(filePath, html, 'utf8')
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
