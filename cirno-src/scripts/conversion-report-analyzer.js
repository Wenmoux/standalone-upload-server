/**
 * [INPUT]: 依赖本地转换样本、生产 chinese-convert 规则、回归语料与文件系统
 * [OUTPUT]: 对外提供样本发现、段落/窗口扫描、回归执行、轮次统计与汇总模型
 * [POS]: cirno-src/scripts 的繁简转换分析核心，只生成结构化事实，不渲染报告或决定进程退出码
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const TEST_DIR = path.join(ROOT_DIR, 'test')
const INPUT_EXTENSIONS = new Set(['.txt', '.md', '.text'])

const REGRESSION_CASES = [
  {
    name: '微信对话与费用',
    input: '微信对話框裏，備注为“惡毒后媽”的头像发來一條新消息：這个月开始生活費調整到1000塊哦。',
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

function builtInRegressionFile() {
  const raw = REGRESSION_CASES.map(item => item.input).join('\n')
  return {
    path: path.join(TEST_DIR, 'built-in-regression.txt'),
    name: 'built-in-regression.txt',
    bytes: Buffer.byteLength(raw),
    raw,
    chars: [...raw].length,
    replacementChars: countReplacementChars(raw),
    rawPreview: normalizeSnippet(raw, 360)
  }
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
  const protectedPositions =
    options.ignoreProtected || options.onlyProtected ? getProtectedResidualPositions(text) : null
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
        snippet: text.slice(start, end).replace(/\s+/g, ' ').trim()
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
    worst: worst.sort((a, b) => b.after - a.after || b.before - a.before || b.chars - a.chars).slice(0, 12)
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
    worst: worst.sort((a, b) => b.after - a.after || b.before - a.before).slice(0, 12)
  }
}

function runRegressionCases(convertText) {
  return REGRESSION_CASES.map(item => {
    const output = convertText(item.input, 'simplified')
    const secondPass = convertText(output, 'simplified')
    const missing = item.expectedIncludes.filter(fragment => !output.includes(fragment))
    if (secondPass !== output) missing.push(`二次转换结果漂移：${normalizeSnippet(secondPass, 120)}`)
    return {
      ...item,
      output,
      secondPass,
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
    contexts: findContexts(
      simplified,
      after.top.map(item => item.ch),
      10
    ),
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
    passed:
      failed === 0 &&
      totals.replacementChars === 0 &&
      totals.after === 0 &&
      totals.residualParagraphs === 0 &&
      totals.residualWindows === 0 &&
      totals.secondPassDiff === 0
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
    before: mergeMappedItems(
      finalRound.files.map(file => file.before),
      36
    ),
    after: mergeMappedItems(
      finalRound.files.map(file => file.after),
      36
    ),
    protected: mergeMappedItems(
      finalRound.files.map(file => file.protectedAfter),
      36
    )
  }

  return {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
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

module.exports = {
  buildSummary,
  builtInRegressionFile,
  loadConverter,
  readTestFiles,
  runRound
}
