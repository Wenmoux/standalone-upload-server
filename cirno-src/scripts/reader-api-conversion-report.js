/**
 * [INPUT]: 依赖 Reader API 转换扫描器生成的脱敏状态模型与目标报告路径
 * [OUTPUT]: 对外提供 Markdown 与 HTML 扫描报告写入器
 * [POS]: cirno-src/scripts 的 Reader API 转换扫描展示层，不请求 API、不转换正文也不持有断点状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs')

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

function writeMarkdown(filePath, state) {
  const s = state.summary
  const regressionRows = state.regressions
    .map(item => `| ${item.passed ? '通过' : '失败'} | ${item.name} | ${item.missing.join('、') || '无'} |`)
    .join('\n')
  const issueRows =
    state.issues
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

${
  topCounts(state.residualCharCounts, 40)
    .map(item => `- \`${item.char}\`：${item.count}`)
    .join('\n') || '无'
}

## 保护性保留 TOP

${
  topCounts(state.protectedCharCounts, 40)
    .map(item => `- \`${item.char}\`：${item.count}`)
    .join('\n') || '无'
}

## 同形字提示 TOP

${
  topCounts(state.sameFormCharCounts, 40)
    .map(item => `- \`${item.char}\`：${item.count}`)
    .join('\n') || '无'
}

## OpenCC 偏好提示 TOP

${
  topCounts(state.openccAuditCounts, 40)
    .map(item => `- \`${item.char}\`：${item.count}`)
    .join('\n') || '无'
}

## 异常样例

${issueRows}
`
  fs.writeFileSync(filePath, md, 'utf8')
}

function renderCountChips(counts, t2sCharMap) {
  const rows = topCounts(counts, 80)
  if (!rows.length) return '<span class="muted">EMPTY</span>'
  return `<div class="chips">${rows
    .map(
      item =>
        `<span class="chip"><b>${esc(item.char)}</b><span>${esc(t2sCharMap ? t2sCharMap[item.char] || '' : '')}</span><em>${num(item.count)}</em></span>`
    )
    .join('')}</div>`
}

function writeHtml(filePath, state) {
  const s = state.summary
  const passed =
    state.status === 'finished' && s.afterHits === 0 && s.errors === 0 && state.regressions.every(item => item.passed)
  const issueRows =
    state.issues
      .slice(0, 500)
      .map(
        item => `
    <tr>
      <td>${esc(item.bookId)}</td>
      <td>${esc(item.bookTitle)}</td>
      <td>${esc(item.chapterId)}</td>
      <td>${esc(item.chapterTitle)}</td>
      <td>${num(item.afterHits)}</td>
      <td>${item.hits.map(hit => `<div class="hit-line"><b>${esc(hit.char)}</b><span>${esc(hit.snippet)}</span></div>`).join('')}</td>
    </tr>`
      )
      .join('') || '<tr><td colspan="6"><span class="muted">无异常残留</span></td></tr>'

  const regressionRows = state.regressions
    .map(
      item => `
    <tr>
      <td><span class="badge ${item.passed ? 'ok' : 'fail'}">${item.passed ? 'PASS' : 'FAIL'}</span></td>
      <td>${esc(item.name)}</td>
      <td><pre>${esc(item.input)}</pre></td>
      <td><pre>${esc(item.output)}</pre></td>
      <td>${item.missing.length ? esc(item.missing.join(' / ')) : '<span class="muted">NONE</span>'}</td>
    </tr>`
    )
    .join('')

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

module.exports = { writeHtml, writeMarkdown }
