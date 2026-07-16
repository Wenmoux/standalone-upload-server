/**
 * [INPUT]: 依赖转换分析核心生成的结构化 summary 模型
 * [OUTPUT]: 对外提供 HTML 报告渲染与机器可读 JSON 摘要构建
 * [POS]: cirno-src/scripts 的繁简转换纯展示层，不扫描正文、不访问文件系统也不修改进程状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
        <div class="subline">TEST_DIR: ${escapeHtml(summary.sourceLabel || 'test')} · GENERATED: ${escapeHtml(summary.generatedAt)}</div>
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

function buildJsonSummary(summary) {
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
  return compact
}

module.exports = { buildJsonSummary, renderReport }
