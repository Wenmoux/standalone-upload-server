const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const TEST_DIR = path.join(ROOT_DIR, 'test')
const REPORT_PATH = path.join(TEST_DIR, 'conversion-summary-report.html')
const JSON_PATH = path.join(TEST_DIR, 'conversion-summary-report.json')
const INPUT_EXTENSIONS = new Set(['.txt', '.md', '.text'])
const DEFAULT_ROUNDS = 5

const REGRESSION_CASES = [
  {
    name: '微信对话与费用',
    input:
      '微信对話框裏，備注为“惡毒后媽”的头像发來一條新消息：這个月开始生活費調整到1000塊哦。',
    expectedIncludes: ['微信对话框里', '备注为“恶毒后妈”', '发来一条新消息', '这个月开始生活费调整到1000块哦']
  },
  {
    name: '家人称呼与 UI 词',
    input: '小夏，這是蘇姨，以后就是咱們家的人了。手機螢幕、支付介面、圖示。',
    expectedIncludes: ['小夏，这是苏姨', '咱们家的人了', '手机屏幕', '支付界面', '图标']
  },
  {
    name: '扫码枪/进口/揣进口袋',
    input: '林心泳拿着扫码槍，“两盒進口巧克力，一百二。”江夏点把手机揣進口袋，拿着东西，转身往外走。',
    expectedIncludes: ['扫码枪', '两盒进口巧克力', '揣进口袋']
  },
  {
    name: '房间描写',
    input: '一張白色的公主床，鋪著淺灰色的床品。床头櫃上擺著幾本书，还有一盞造型簡約的台燈。',
    expectedIncludes: ['一张白色的公主床', '铺着浅灰色的床品', '床头柜上摆着几本书', '一盏造型简约的台灯']
  },
  {
    name: '风景画与笔触',
    input: '牆上掛著幾幅素描，都是风景畫，筆觸細膩，顯然是出自她手。',
    expectedIncludes: ['墙上挂着几幅素描', '都是风景画', '笔触细腻', '显然是出自她手']
  },
  {
    name: '著字保护',
    input: '著名景點和原著、編著、專著、譯著、著述、著錄。背著書包，配合著，寫著名字，明著作對。',
    expectedIncludes: ['著名景点', '原著、编著、专著、译著、著述、著录', '背着书包', '配合着', '写着名字', '明着作对']
  },
  {
    name: '支付系统词',
    input: '支付行为：親吻对方嘴唇，支付對象：林泳心，請在三分鐘內完成支付。',
    expectedIncludes: ['支付行为：亲吻对方嘴唇', '支付对象：林泳心', '请在三分钟内完成支付']
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
    name: '服饰与状态',
    input: '吊帶吊的胸前繃得緊緊的，似乎隨时会崩开。',
    expectedIncludes: ['吊带吊的胸前绷得紧紧的', '似乎随时会崩开']
  },
  {
    name: '著作边界',
    input: '猫主席著作和古典名著。她坐在位置上做著作業，强忍著作嘔，起著作用，跟著作美。',
    expectedIncludes: ['猫主席著作', '古典名著', '做着作业', '强忍着作呕', '起着作用', '跟着作美']
  }
]

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

function loadConverter() {
  const OpenCCT2CN = require('opencc-js/t2cn')
  const OpenCCCN2T = require('opencc-js/cn2t')
  const sourcePath = path.join(ROOT_DIR, 'src', 'utils', 'chinese-convert.js')
  let source = fs.readFileSync(sourcePath, 'utf8')

  source = source
    .replace(/import \* as OpenCCT2CN[^\n]*\n/, '')
    .replace(/import \* as OpenCCCN2T[^\n]*\n/, '')
    .replace('export function convertText', 'function convertText')
    .replace(/\nexport \{ t2sCharMap, s2tCharMap \}\s*$/, '')

  source += '\nreturn { convertText, t2sCharMap, s2tCharMap }'
  return Function('OpenCCT2CN', 'OpenCCCN2T', source)(OpenCCT2CN, OpenCCCN2T)
}

function parseRounds() {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i]
    if (item === '--rounds' || item === '-r') {
      return clampRounds(Number(args[i + 1]))
    }
    if (item.startsWith('--rounds=')) {
      return clampRounds(Number(item.split('=')[1]))
    }
  }
  return DEFAULT_ROUNDS
}

function clampRounds(value) {
  if (!Number.isFinite(value)) return DEFAULT_ROUNDS
  return Math.max(1, Math.min(20, Math.floor(value)))
}

function walkTextFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkTextFiles(fullPath)
    const ext = path.extname(entry.name).toLowerCase()
    if (!INPUT_EXTENSIONS.has(ext)) return []
    return [fullPath]
  })
}

function readTestFiles() {
  return walkTextFiles(TEST_DIR)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map(filePath => {
      const buffer = fs.readFileSync(filePath)
      const raw = buffer.toString('utf8')
      return {
        path: filePath,
        name: path.relative(TEST_DIR, filePath),
        bytes: buffer.length,
        raw,
        chars: [...raw].length,
        replacementChars: countReplacementChars(raw),
        rawPreview: normalizeSnippet(raw, 360)
      }
    })
}

function normalizeSnippet(text, limit = 220) {
  const compact = String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return [...compact].slice(0, limit).join('')
}

function countReplacementChars(text) {
  return (text.match(/\uFFFD/g) || []).length
}

function getProtectedResidualPositions(text) {
  const positions = new Set()
  PROTECTED_RESIDUAL_PATTERNS.forEach(pattern => {
    pattern.lastIndex = 0
    let match = pattern.exec(text)
    while (match) {
      for (let index = match.index; index < match.index + match[0].length; index += 1) {
        positions.add(index)
      }
      match = pattern.exec(text)
    }
  })
  return positions
}

function countMappedChars(text, map, options = {}) {
  const protectedPositions = options.ignoreProtected || options.onlyProtected ? getProtectedResidualPositions(text) : null
  const counts = new Map()
  let total = 0
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (!map[ch] || map[ch] === ch) continue
    const protectedHit = protectedPositions && protectedPositions.has(index)
    if (options.ignoreProtected && protectedHit) continue
    if (options.onlyProtected && !protectedHit) continue
    counts.set(ch, (counts.get(ch) || 0) + 1)
    total += 1
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .map(([ch, count]) => ({ ch, mappedTo: map[ch], count }))
  return { total, unique: counts.size, items: top, top: top.slice(0, 20) }
}

function approximateDiffCount(a, b) {
  const left = [...a]
  const right = [...b]
  const len = Math.min(left.length, right.length)
  let diff = Math.abs(left.length - right.length)
  for (let i = 0; i < len; i += 1) {
    if (left[i] !== right[i]) diff += 1
  }
  return diff
}

function conversionRate(before, after) {
  if (!before) return 100
  return ((before - after) / before) * 100
}

function formatPercent(value, digits = 2) {
  return `${Number(value || 0).toFixed(digits)}%`
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatMs(value) {
  return `${Number(value || 0).toFixed(0)} ms`
}

function avg(values) {
  if (!values.length) return 0
  return values.reduce((sum, item) => sum + item, 0) / values.length
}

function min(values) {
  return values.length ? Math.min(...values) : 0
}

function max(values) {
  return values.length ? Math.max(...values) : 0
}

function mergeMappedItems(collections, limit = 30) {
  const counts = new Map()
  const mappedTo = new Map()
  collections.forEach(collection => {
    ;(collection.items || collection.top || []).forEach(item => {
      counts.set(item.ch, (counts.get(item.ch) || 0) + item.count)
      mappedTo.set(item.ch, item.mappedTo)
    })
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, limit)
    .map(([ch, count]) => ({ ch, mappedTo: mappedTo.get(ch), count }))
}

function collectTermBank(regressions) {
  const terms = []
  regressions.forEach(item => {
    item.expectedIncludes.forEach(term => {
      if (term && !terms.includes(term)) terms.push(term)
    })
  })
  return terms
}

function findContexts(text, chars, limit = 8) {
  const results = []
  for (const ch of chars) {
    let index = text.indexOf(ch)
    while (index !== -1 && results.length < limit) {
      const start = Math.max(0, index - 46)
      const end = Math.min(text.length, index + 47)
      results.push({
        ch,
        snippet: text
          .slice(start, end)
          .replace(/\s+/g, ' ')
          .trim()
      })
      index = text.indexOf(ch, index + ch.length)
    }
    if (results.length >= limit) break
  }
  return results
}

function scanParagraphs(raw, convertText, t2sCharMap) {
  const paragraphs = raw
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)

  const worst = []
  let residualCount = 0
  paragraphs.forEach((paragraph, index) => {
    const output = convertText(paragraph, 'simplified')
    const before = countMappedChars(paragraph, t2sCharMap)
    const after = countMappedChars(output, t2sCharMap, { ignoreProtected: true })
    if (after.total <= 0) return
    residualCount += 1
    worst.push({
      index: index + 1,
      chars: [...paragraph].length,
      before: before.total,
      after: after.total,
      rate: conversionRate(before.total, after.total),
      rawSnippet: normalizeSnippet(paragraph, 120),
      outputSnippet: normalizeSnippet(output, 120)
    })
  })

  return {
    total: paragraphs.length,
    residualCount,
    worst: worst
      .sort((a, b) => b.after - a.after || b.before - a.before || b.chars - a.chars)
      .slice(0, 12)
  }
}

function scanWindows(raw, convertText, t2sCharMap, size = 1600) {
  const chars = [...raw]
  const worst = []
  let total = 0
  let clean = 0
  let residual = 0
  for (let offset = 0; offset < chars.length; offset += size) {
    const chunk = chars.slice(offset, offset + size).join('')
    const output = convertText(chunk, 'simplified')
    const before = countMappedChars(chunk, t2sCharMap)
    const after = countMappedChars(output, t2sCharMap, { ignoreProtected: true })
    total += 1
    if (after.total === 0) {
      clean += 1
      continue
    }
    residual += 1
    worst.push({
      index: total,
      start: offset,
      chars: [...chunk].length,
      before: before.total,
      after: after.total,
      rate: conversionRate(before.total, after.total),
      rawSnippet: normalizeSnippet(chunk, 120),
      outputSnippet: normalizeSnippet(output, 120)
    })
  }
  return {
    total,
    clean,
    residual,
    worst: worst
      .sort((a, b) => b.after - a.after || b.before - a.before)
      .slice(0, 12)
  }
}

function runRegressionCases(convertText) {
  return REGRESSION_CASES.map(item => {
    const output = convertText(item.input, 'simplified')
    const missing = item.expectedIncludes.filter(fragment => !output.includes(fragment))
    return {
      ...item,
      output,
      passed: missing.length === 0,
      missing
    }
  })
}

function analyzeFile(file, convertText, t2sCharMap) {
  const started = Date.now()
  const simplified = convertText(file.raw, 'simplified')
  const simplifiedAgain = convertText(simplified, 'simplified')
  const before = countMappedChars(file.raw, t2sCharMap)
  const after = countMappedChars(simplified, t2sCharMap, { ignoreProtected: true })
  const protectedAfter = countMappedChars(simplified, t2sCharMap, { onlyProtected: true })

  return {
    path: file.path,
    name: file.name,
    bytes: file.bytes,
    chars: file.chars,
    replacementChars: file.replacementChars,
    changedChars: approximateDiffCount(file.raw, simplified),
    before,
    after,
    protectedAfter,
    rate: conversionRate(before.total, after.total),
    secondPassDiff: approximateDiffCount(simplified, simplifiedAgain),
    contexts: findContexts(simplified, after.top.map(item => item.ch), 10),
    paragraphs: scanParagraphs(file.raw, convertText, t2sCharMap),
    windows: scanWindows(file.raw, convertText, t2sCharMap),
    rawPreview: file.rawPreview,
    simplifiedPreview: normalizeSnippet(simplified, 360),
    durationMs: Date.now() - started
  }
}

function summarizeReports(reports) {
  const totals = reports.reduce(
    (memo, file) => {
      memo.bytes += file.bytes
      memo.chars += file.chars
      memo.changedChars += file.changedChars
      memo.replacementChars += file.replacementChars
      memo.before += file.before.total
      memo.after += file.after.total
      memo.protectedAfter += file.protectedAfter.total
      memo.paragraphs += file.paragraphs.total
      memo.residualParagraphs += file.paragraphs.residualCount
      memo.windows += file.windows.total
      memo.residualWindows += file.windows.residual
      memo.secondPassDiff += file.secondPassDiff
      return memo
    },
    {
      bytes: 0,
      chars: 0,
      changedChars: 0,
      replacementChars: 0,
      before: 0,
      after: 0,
      protectedAfter: 0,
      paragraphs: 0,
      residualParagraphs: 0,
      windows: 0,
      residualWindows: 0,
      secondPassDiff: 0
    }
  )
  totals.rate = conversionRate(totals.before, totals.after)
  return totals
}

function runRound(index, files, convertText, t2sCharMap) {
  const startedAt = new Date()
  const started = Date.now()
  const regressions = runRegressionCases(convertText)
  const reports = files.map(file => analyzeFile(file, convertText, t2sCharMap))
  const totals = summarizeReports(reports)
  const failed = regressions.filter(item => !item.passed).length

  return {
    index,
    startedAt: startedAt.toLocaleString('zh-CN', { hour12: false }),
    durationMs: Date.now() - started,
    files: reports,
    totals,
    regressionPassed: regressions.length - failed,
    regressionTotal: regressions.length,
    failed,
    regressions,
    passed: failed === 0 && totals.after === 0 && totals.residualParagraphs === 0 && totals.residualWindows === 0
  }
}

function buildSummary(files, rounds) {
  const finalRound = rounds[rounds.length - 1]
  const durations = rounds.map(round => round.durationMs)
  const fileSummaries = files.map((file, fileIndex) => {
    const samples = rounds.map(round => round.files[fileIndex])
    const final = samples[samples.length - 1]
    const afterValues = samples.map(item => item.after.total)
    const protectedValues = samples.map(item => item.protectedAfter.total)
    const residualParagraphValues = samples.map(item => item.paragraphs.residualCount)
    const residualWindowValues = samples.map(item => item.windows.residual)
    const durationValues = samples.map(item => item.durationMs)
    return {
      name: file.name,
      bytes: file.bytes,
      chars: file.chars,
      before: final.before.total,
      afterMin: min(afterValues),
      afterMax: max(afterValues),
      afterAvg: avg(afterValues),
      protectedMax: max(protectedValues),
      residualParagraphMax: max(residualParagraphValues),
      residualWindowMax: max(residualWindowValues),
      durationAvg: avg(durationValues),
      durationMin: min(durationValues),
      durationMax: max(durationValues),
      changedChars: final.changedChars,
      rate: final.rate,
      final
    }
  })
  const globalTop = {
    before: mergeMappedItems(finalRound.files.map(file => file.before), 36),
    after: mergeMappedItems(finalRound.files.map(file => file.after), 36),
    protected: mergeMappedItems(finalRound.files.map(file => file.protectedAfter), 36)
  }

  return {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    reportPath: REPORT_PATH,
    jsonPath: JSON_PATH,
    rounds: rounds.length,
    allPassed: rounds.every(round => round.passed),
    durationTotal: durations.reduce((sum, item) => sum + item, 0),
    durationAvg: avg(durations),
    durationMin: min(durations),
    durationMax: max(durations),
    files: fileSummaries,
    globalTop,
    termBank: collectTermBank(finalRound.regressions),
    finalRound,
    roundRows: rounds.map(round => ({
      index: round.index,
      startedAt: round.startedAt,
      durationMs: round.durationMs,
      passed: round.passed,
      regression: `${round.regressionPassed}/${round.regressionTotal}`,
      ...round.totals
    }))
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function statusClass(passed) {
  return passed ? 'ok' : 'fail'
}

function statusText(passed) {
  return passed ? 'PASS' : 'CHECK'
}

function renderTopChars(items) {
  if (!items.length) return '<span class="muted">EMPTY</span>'
  return `<div class="chips">${items
    .map(
      item =>
        `<span class="chip"><b>${escapeHtml(item.ch)}</b><span>${escapeHtml(item.mappedTo)}</span><em>${formatNumber(
          item.count
        )}</em></span>`
    )
    .join('')}</div>`
}

function renderTermChips(items) {
  if (!items.length) return '<span class="muted">EMPTY</span>'
  return `<div class="term-list">${items.map(item => `<span class="term-chip">${escapeHtml(item)}</span>`).join('')}</div>`
}

function renderScanRows(rows, type) {
  if (!rows.length) {
    return '<tr><td colspan="7" class="muted">NO RESIDUAL BLOCKS</td></tr>'
  }
  return rows
    .map(row => {
      const label = type === 'window' ? `#${row.index} / ${formatNumber(row.start)}` : `#${row.index}`
      return `<tr>
        <td>${label}</td>
        <td>${formatNumber(row.chars)}</td>
        <td>${formatNumber(row.before)}</td>
        <td>${formatNumber(row.after)}</td>
        <td>${formatPercent(row.rate)}</td>
        <td><pre>${escapeHtml(row.rawSnippet)}</pre></td>
        <td><pre>${escapeHtml(row.outputSnippet)}</pre></td>
      </tr>`
    })
    .join('')
}

function renderRoundRows(rows) {
  return rows
    .map(
      row => `<tr>
        <td><span class="badge ${statusClass(row.passed)}">${statusText(row.passed)}</span></td>
        <td>#${row.index}</td>
        <td>${escapeHtml(row.startedAt)}</td>
        <td>${formatMs(row.durationMs)}</td>
        <td>${row.regression}</td>
        <td>${formatNumber(row.before)} -&gt; ${formatNumber(row.after)}</td>
        <td>${formatNumber(row.protectedAfter)}</td>
        <td>${formatNumber(row.residualParagraphs)} / ${formatNumber(row.paragraphs)}</td>
        <td>${formatNumber(row.residualWindows)} / ${formatNumber(row.windows)}</td>
      </tr>`
    )
    .join('')
}

function renderFileSummaryRows(files) {
  return files
    .map(
      file => `<tr>
        <td>${escapeHtml(file.name)}</td>
        <td>${formatNumber(file.chars)}</td>
        <td>${formatNumber(file.before)} -&gt; ${formatNumber(file.afterMax)}</td>
        <td>${formatPercent(file.rate)}</td>
        <td>${formatNumber(file.protectedMax)}</td>
        <td>${formatNumber(file.residualParagraphMax)}</td>
        <td>${formatNumber(file.residualWindowMax)}</td>
        <td>${formatMs(file.durationAvg)} <span class="muted">[${formatMs(file.durationMin)}-${formatMs(file.durationMax)}]</span></td>
      </tr>`
    )
    .join('')
}

function renderRegressionRows(regressions) {
  return regressions
    .map(
      item => `<tr>
        <td><span class="badge ${statusClass(item.passed)}">${statusText(item.passed)}</span></td>
        <td>${escapeHtml(item.name)}</td>
        <td><pre>${escapeHtml(item.input)}</pre></td>
        <td><pre>${escapeHtml(item.output)}</pre></td>
        <td>${item.missing.length ? escapeHtml(item.missing.join(' / ')) : '<span class="muted">NONE</span>'}</td>
      </tr>`
    )
    .join('')
}

function renderFileDetails(files) {
  return files
    .map(file => {
      const final = file.final
      return `<section class="panel">
        <div class="section-title">
          <h2>${escapeHtml(file.name)}</h2>
          <span class="badge ${final.after.total === 0 ? 'ok' : 'fail'}">${final.after.total === 0 ? 'CLEAN' : 'RESIDUAL'}</span>
        </div>
        <div class="mini-grid">
          <div><span>CHARS</span><strong>${formatNumber(final.chars)}</strong></div>
          <div><span>CHANGED</span><strong>${formatNumber(final.changedChars)}</strong></div>
          <div><span>RATE</span><strong>${formatPercent(final.rate)}</strong></div>
          <div><span>MAP</span><strong>${formatNumber(final.before.total)} -&gt; ${formatNumber(final.after.total)}</strong></div>
          <div><span>PARAGRAPH</span><strong>${formatNumber(final.paragraphs.residualCount)} / ${formatNumber(final.paragraphs.total)}</strong></div>
          <div><span>WINDOW</span><strong>${formatNumber(final.windows.residual)} / ${formatNumber(final.windows.total)}</strong></div>
        </div>

        <h3>PREVIEW</h3>
        <div class="preview-grid">
          <div class="preview"><b>RAW</b><pre>${escapeHtml(final.rawPreview)}</pre></div>
          <div class="preview"><b>SIMPLIFIED</b><pre>${escapeHtml(final.simplifiedPreview)}</pre></div>
        </div>

        ${
          final.after.total > 0
            ? `<h3>RESIDUAL SAMPLES</h3><table><thead><tr><th>ID</th><th>CHARS</th><th>BEFORE</th><th>AFTER</th><th>RATE</th><th>RAW</th><th>OUTPUT</th></tr></thead><tbody>${renderScanRows(
                final.paragraphs.worst,
                'paragraph'
              )}</tbody></table>`
            : ''
        }
      </section>`
    })
    .join('')
}

function renderReport(summary) {
  const final = summary.finalRound.totals
  const passedCount = summary.finalRound.regressionPassed
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cirno Conversion Summary</title>
  <style>
    :root {
      --paper: #f6f7f1;
      --ink: #141414;
      --panel: #fffdf5;
      --cyan: #00a7b5;
      --pink: #f0457a;
      --yellow: #ffd84d;
      --green: #16a34a;
      --red: #dc2626;
      --muted: #60646c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background-color: var(--paper);
      background-image:
        linear-gradient(#d9dce2 1px, transparent 1px),
        linear-gradient(90deg, #d9dce2 1px, transparent 1px);
      background-size: 18px 18px;
      font: 14px/1.55 Consolas, "Courier New", "Microsoft YaHei", monospace;
      letter-spacing: 0;
    }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 26px; }
    header {
      border: 3px solid var(--ink);
      background: var(--panel);
      box-shadow: 8px 8px 0 var(--ink);
      padding: 18px;
      margin-bottom: 22px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: end;
    }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; text-transform: uppercase; }
    h2 { font-size: 18px; text-transform: uppercase; }
    h3 {
      font-size: 13px;
      margin: 18px 0 8px;
      padding-left: 8px;
      border-left: 10px solid var(--cyan);
      text-transform: uppercase;
    }
    .subline { color: var(--muted); margin-top: 6px; }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 76px;
      padding: 4px 8px;
      border: 2px solid var(--ink);
      background: white;
      box-shadow: 3px 3px 0 var(--ink);
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.ok { background: #dff8e8; color: var(--green); }
    .badge.fail { background: #ffe1e7; color: var(--red); }
    .badge.warn { background: #fff3b0; color: #8a5a00; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .metric, .panel {
      border: 3px solid var(--ink);
      background: var(--panel);
      box-shadow: 6px 6px 0 var(--ink);
    }
    .metric { padding: 14px; min-height: 106px; position: relative; }
    .metric::after {
      content: "";
      position: absolute;
      right: 8px;
      top: 8px;
      width: 14px;
      height: 14px;
      background: var(--yellow);
      border: 2px solid var(--ink);
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .metric strong { display: block; font-size: 25px; line-height: 1.2; margin-top: 8px; }
    .metric em { display: block; color: var(--muted); font-style: normal; margin-top: 8px; }
    .panel { padding: 16px; margin: 18px 0; overflow: hidden; }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 3px solid var(--ink);
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .mini-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }
    .mini-grid div {
      border: 2px solid var(--ink);
      padding: 9px;
      background: white;
    }
    .mini-grid span { display: block; color: var(--muted); font-size: 11px; }
    .mini-grid strong { display: block; font-size: 15px; margin-top: 4px; }
    .note {
      border: 2px dashed var(--ink);
      background: #eaffff;
      padding: 12px;
      margin-top: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border: 2px solid var(--ink);
    }
    th, td {
      border: 2px solid var(--ink);
      padding: 8px;
      vertical-align: top;
      text-align: left;
    }
    th {
      background: #141414;
      color: white;
      font-size: 12px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 150px;
      overflow: auto;
      font-family: "Microsoft YaHei", Consolas, monospace;
    }
    .muted { color: var(--muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      border: 2px solid var(--ink);
      background: white;
      padding: 5px 8px;
      box-shadow: 3px 3px 0 var(--ink);
    }
    .chip b { color: var(--pink); font-size: 16px; }
    .chip span { color: var(--cyan); font-weight: 700; }
    .chip em { color: var(--muted); font-style: normal; }
    .term-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .term-chip {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 4px 8px;
      border: 2px solid var(--ink);
      background: #eaffff;
      box-shadow: 3px 3px 0 var(--ink);
      font-family: "Microsoft YaHei", Consolas, monospace;
    }
    .preview-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .preview {
      border: 2px solid var(--ink);
      background: white;
    }
    .preview b {
      display: block;
      padding: 8px;
      border-bottom: 2px solid var(--ink);
      background: var(--yellow);
    }
    .preview pre { padding: 10px; min-height: 130px; }
    @media (max-width: 980px) {
      .wrap { padding: 14px; }
      header { display: block; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mini-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preview-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Cirno Conversion Summary</h1>
        <div class="subline">TEST_DIR: ${escapeHtml(path.relative(ROOT_DIR, TEST_DIR))} · GENERATED: ${escapeHtml(summary.generatedAt)}</div>
      </div>
      <span class="badge ${summary.allPassed ? 'ok' : 'fail'}">${summary.allPassed ? 'ALL PASS' : 'CHECK'}</span>
    </header>

    <div class="metrics">
      <div class="metric"><span>Rounds</span><strong>${formatNumber(summary.rounds)}</strong><em>${formatMs(summary.durationAvg)} avg</em></div>
      <div class="metric"><span>Files / Chars</span><strong>${formatNumber(summary.files.length)} / ${formatNumber(final.chars)}</strong><em>${formatNumber(final.bytes)} bytes</em></div>
      <div class="metric"><span>Residual</span><strong>${formatNumber(final.after)}</strong><em>${formatNumber(final.before)} mapped hits</em></div>
      <div class="metric"><span>Regression</span><strong>${formatNumber(passedCount)} / ${formatNumber(summary.finalRound.regressionTotal)}</strong><em>protected ${formatNumber(final.protectedAfter)}</em></div>
    </div>

    <section class="panel">
      <div class="section-title">
        <h2>Summary</h2>
        <span class="badge ${summary.allPassed ? 'ok' : 'fail'}">${summary.allPassed ? 'stable' : 'unstable'}</span>
      </div>
      <div class="note">
        共 ${formatNumber(summary.files.length)} 份文本执行 ${formatNumber(summary.rounds)} 轮。最终异常残留 ${formatNumber(final.after)}，段落残留 ${formatNumber(final.residualParagraphs)}，分片残留 ${formatNumber(final.residualWindows)}；保护性保留 ${formatNumber(final.protectedAfter)} 个，不计入异常。
      </div>
    </section>

    <section class="panel">
      <div class="section-title"><h2>Round Matrix</h2></div>
      <table>
        <thead><tr><th>Status</th><th>Round</th><th>Start</th><th>Time</th><th>Regression</th><th>Map</th><th>Protected</th><th>Paragraph</th><th>Window</th></tr></thead>
        <tbody>${renderRoundRows(summary.roundRows)}</tbody>
      </table>
    </section>

    <section class="panel">
      <div class="section-title"><h2>File Aggregate</h2></div>
      <table>
        <thead><tr><th>File</th><th>Chars</th><th>Map</th><th>Rate</th><th>Protected</th><th>Paragraph Residual</th><th>Window Residual</th><th>Time Avg</th></tr></thead>
        <tbody>${renderFileSummaryRows(summary.files)}</tbody>
      </table>
    </section>

    <section class="panel">
      <div class="section-title"><h2>Global Lexicon</h2></div>
      <h3>TOP BEFORE / ALL BOOKS</h3>
      ${renderTopChars(summary.globalTop.before)}
      <h3>RESIDUAL AFTER / ALL BOOKS</h3>
      ${renderTopChars(summary.globalTop.after)}
      <h3>PROTECTED KEEP / ALL BOOKS</h3>
      ${renderTopChars(summary.globalTop.protected)}
      <h3>TERMS / PHRASES</h3>
      ${renderTermChips(summary.termBank)}
    </section>

    <section class="panel">
      <div class="section-title"><h2>Regression Cases</h2></div>
      <table>
        <thead><tr><th>Status</th><th>Case</th><th>Input</th><th>Output</th><th>Missing</th></tr></thead>
        <tbody>${renderRegressionRows(summary.finalRound.regressions)}</tbody>
      </table>
    </section>

    ${renderFileDetails(summary.files)}
  </div>
</body>
</html>`
}

function writeJsonSummary(summary) {
  const compact = {
    generatedAt: summary.generatedAt,
    rounds: summary.rounds,
    allPassed: summary.allPassed,
    duration: {
      totalMs: summary.durationTotal,
      avgMs: summary.durationAvg,
      minMs: summary.durationMin,
      maxMs: summary.durationMax
    },
    final: summary.finalRound.totals,
    roundRows: summary.roundRows,
    globalTop: summary.globalTop,
    termBank: summary.termBank,
    files: summary.files.map(file => ({
      name: file.name,
      bytes: file.bytes,
      chars: file.chars,
      before: file.before,
      afterMin: file.afterMin,
      afterMax: file.afterMax,
      protectedMax: file.protectedMax,
      residualParagraphMax: file.residualParagraphMax,
      residualWindowMax: file.residualWindowMax,
      durationAvg: file.durationAvg
    }))
  }
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(compact, null, 2)}\n`, 'utf8')
}

function main() {
  const roundsToRun = parseRounds()
  const { convertText, t2sCharMap } = loadConverter()
  const files = readTestFiles()
  if (!files.length) {
    throw new Error(`No text files found in ${TEST_DIR}`)
  }

  const rounds = []
  for (let index = 1; index <= roundsToRun; index += 1) {
    rounds.push(runRound(index, files, convertText, t2sCharMap))
  }

  const summary = buildSummary(files, rounds)
  fs.writeFileSync(REPORT_PATH, renderReport(summary), 'utf8')
  writeJsonSummary(summary)

  const final = summary.finalRound.totals
  console.log(
    JSON.stringify(
      {
        report: REPORT_PATH,
        json: JSON_PATH,
        rounds: summary.rounds,
        files: summary.files.length,
        chars: final.chars,
        paragraphs: final.paragraphs,
        residualParagraphs: final.residualParagraphs,
        windows: final.windows,
        residualWindows: final.residualWindows,
        before: final.before,
        after: final.after,
        protectedAfter: final.protectedAfter,
        conversionRate: Number(final.rate.toFixed(4)),
        regressionPassed: summary.finalRound.regressionPassed,
        regressionTotal: summary.finalRound.regressionTotal,
        durationAvgMs: Number(summary.durationAvg.toFixed(0)),
        allPassed: summary.allPassed
      },
      null,
      2
    )
  )
}

main()
