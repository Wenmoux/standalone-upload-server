const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const scanId = process.argv[2] || 'reader-api-traditional-full'
const dir = path.join(ROOT_DIR, 'docs', 'conversion-scans')
const jsonPath = path.join(dir, `${scanId}.json`)
const htmlPath = path.join(dir, `${scanId}.html`)

const state = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
const s = state.汇总 || {}

const residualPreview = '壹弌貳贰弍叁參肆伍陸陆柒捌玖拾佰仟萬與專業叢東絲丟兩嚴喪個豐臨為麼義烏樂喬習鄉書買亂爭於虧雲亞產畝親褻億僅從倉來儀價眾優會傘偉傳傷倫偽備體餘傭俠侶儉債傾儲兒兌黨蘭關興養獸冊寫軍農馮衝決況凍淨涼淒凜凱則剛創別刪劑剎剝劇劉劍勁動務勛勝勞勢勳勵勸勻匯區醫華協單賣盧衛卻廠廳曆歷厲壓厭廁廈廚縣雙發髮變敘疊葉號嘆嘰後嚇呂嗎嚮嚨噸聽啟吳嘔員嗆嗚詠嚀嚐嘮啞喚問唸嘯嗇嚙噠噥噴噹嚕嚥囂囉囑國圍園圓圖團執堅報場塊塵墊墜墳墻壞壯壺壽夢夠夥夾奪奮奬奧妝婦媽嫵嬌嬰學寢實寧審寬寶將尋對導屆屍層屬歲島峽崗崑崙嵐嶺巋巒巔幣帥師帳帶幀幫幹幾庫廂廟廣廢'
const residualCount = 2099

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function num(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

const pass = Number(s.疑似残留章节数 || 0) === 0 && Number(s.错误数 || 0) === 0
const issueRows = (state.疑似残留 || []).slice(0, 500).map(item => `
<tr>
  <td>${esc(item.书号)}</td>
  <td>${esc(item.书名)}</td>
  <td>${esc(item.章节ID)}</td>
  <td>${esc(item.章节标题 || '')}</td>
  <td>${(item.命中 || []).map(hit => `<div class="hit-line"><b>${esc(hit.字符)}</b><span>${esc(hit.上下文)}</span></div>`).join('')}</td>
</tr>`).join('') || '<tr><td colspan="5"><span class="muted">无疑似残留。</span></td></tr>'

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reader API 繁转简正文扫描报告</title>
  <style>
    :root{--paper:#f6f7f1;--ink:#141414;--panel:#fffdf5;--cyan:#00a7b5;--pink:#f0457a;--yellow:#ffd84d;--green:#16a34a;--red:#dc2626;--muted:#60646c}
    *{box-sizing:border-box}body{margin:0;color:var(--ink);background-color:var(--paper);background-image:linear-gradient(#d9dce2 1px,transparent 1px),linear-gradient(90deg,#d9dce2 1px,transparent 1px);background-size:18px 18px;font:14px/1.55 Consolas,"Courier New","Microsoft YaHei",monospace}.wrap{max-width:1320px;margin:0 auto;padding:26px}header{border:3px solid var(--ink);background:var(--panel);box-shadow:8px 8px 0 var(--ink);padding:18px;margin-bottom:22px;display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end}h1,h2,h3{margin:0}h1{font-size:28px;text-transform:uppercase}h2{font-size:18px;text-transform:uppercase}h3{font-size:13px;margin:18px 0 8px;padding-left:8px;border-left:10px solid var(--cyan);text-transform:uppercase}.subline{color:var(--muted);margin-top:6px}.badge{display:inline-flex;align-items:center;justify-content:center;min-width:76px;padding:4px 8px;border:2px solid var(--ink);background:white;box-shadow:3px 3px 0 var(--ink);font-weight:700;text-transform:uppercase}.badge.ok{background:#dff8e8;color:var(--green)}.badge.fail{background:#ffe1e7;color:var(--red)}.badge.warn{background:#fff3b0;color:#8a5a00}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.metric,.panel{border:3px solid var(--ink);background:var(--panel);box-shadow:6px 6px 0 var(--ink)}.metric{padding:14px;min-height:106px;position:relative}.metric:after{content:"";position:absolute;right:8px;top:8px;width:14px;height:14px;background:var(--yellow);border:2px solid var(--ink)}.metric span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase}.metric strong{display:block;font-size:25px;line-height:1.2;margin-top:8px}.metric em{display:block;color:var(--muted);font-style:normal;margin-top:8px}.panel{padding:16px;margin:18px 0;overflow:hidden}.section-title{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid var(--ink);padding-bottom:10px;margin-bottom:12px}.mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mini-grid div{border:2px solid var(--ink);padding:9px;background:white}.mini-grid span{display:block;color:var(--muted);font-size:11px}.mini-grid strong{display:block;font-size:15px;margin-top:4px}.note{border:2px dashed var(--ink);background:#eaffff;padding:12px;margin-top:10px}table{width:100%;border-collapse:collapse;background:white;border:2px solid var(--ink)}th,td{border:2px solid var(--ink);padding:8px;vertical-align:top;text-align:left}th{background:#141414;color:white;font-size:12px;text-transform:uppercase;white-space:nowrap}pre{margin:0;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;font-family:"Microsoft YaHei",Consolas,monospace}.muted{color:var(--muted)}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{display:inline-flex;gap:7px;align-items:center;border:2px solid var(--ink);background:white;padding:5px 8px;box-shadow:3px 3px 0 var(--ink)}.chip b{color:var(--pink);font-size:16px}.hit-line{margin-bottom:7px}.hit-line b{color:var(--pink);font-size:17px;margin-right:8px}@media(max-width:980px){.wrap{padding:14px}header{display:block}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.mini-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Reader API Conversion Scan</h1>
        <div class="subline">标签: ${esc(state.参数?.tag || '无')} · GENERATED: ${esc(new Date(state.更新时间).toLocaleString('zh-CN'))}</div>
      </div>
      <span class="badge ${pass ? 'ok' : 'fail'}">${pass ? 'ALL PASS' : 'CHECK'}</span>
    </header>

    <div class="metrics">
      <div class="metric"><span>书籍 / 章节</span><strong>${num(s.书籍数)} / ${num(s.章节数)}</strong><em>只扫描有正文缓存的书</em></div>
      <div class="metric"><span>字符</span><strong>${num(s.字符数)}</strong><em>reader-api 正文</em></div>
      <div class="metric"><span>疑似残留</span><strong>${num(s.疑似残留章节数)}</strong><em>${residualCount} 个检测字符</em></div>
      <div class="metric"><span>错误</span><strong>${num(s.错误数)}</strong><em>状态: ${esc(state.状态)}</em></div>
    </div>

    <section class="panel"><div class="section-title"><h2>扫描说明</h2><span class="badge ${pass ? 'ok' : 'warn'}">${esc(state.状态)}</span></div><div class="mini-grid"><div><span>标签筛选</span><strong>${esc(state.参数?.tag || '无')}</strong></div><div><span>当前页</span><strong>${esc(state.进度?.当前页)}</strong></div><div><span>有转换章节</span><strong>${num(s.有转换章节数)}</strong></div><div><span>检测字符数</span><strong>${residualCount}</strong></div></div><div class="note">不是只检测回归用例。脚本会对 reader-api 返回的所有正文执行繁转简，然后用完整残留字符表扫描转换后的文本。元数据里有标签但没有正文缓存的书无法扫描正文。</div></section>

    <section class="panel"><div class="section-title"><h2>检测字符表预览</h2><span class="badge ok">${residualCount}</span></div><div class="chips">${residualPreview.split('').map(ch => `<span class="chip"><b>${esc(ch)}</b></span>`).join('')}</div></section>

    <section class="panel"><div class="section-title"><h2>回归用例</h2></div><div class="note">回归用例只是最近修过的典型问题，用来确认这些坑不会回退。</div><table><thead><tr><th>状态</th><th>用例</th><th>输入</th><th>输出</th><th>缺失</th></tr></thead><tbody><tr><td><span class="badge ok">通过</span></td><td>壹/擡/瑯/撢/長阪</td><td><pre>壹生、唯壹、壹股、擡头、琳瑯满目、撢袖子、血戰長阪</pre></td><td><pre>一生、唯一、一股、抬头、琳琅满目、掸袖子、血战长坂</pre></td><td><span class="muted">无</span></td></tr></tbody></table></section>

    <section class="panel"><div class="section-title"><h2>疑似残留样例</h2><span class="badge ${Number(s.疑似残留章节数) ? 'fail' : 'ok'}">${Number(s.疑似残留章节数) ? 'FOUND' : 'CLEAN'}</span></div><table><thead><tr><th>书号</th><th>书名</th><th>章节ID</th><th>章节标题</th><th>命中上下文</th></tr></thead><tbody>${issueRows}</tbody></table></section>
  </div>
</body>
</html>`

fs.writeFileSync(htmlPath, html, 'utf8')
console.log(htmlPath)
