/**
 * [INPUT]: 依赖转换分析核心、纯报告渲染器、轮次参数与报告输出目录
 * [OUTPUT]: 提供繁简转换验证 CLI、HTML/JSON 报告写入和失败退出码
 * [POS]: cirno-src/scripts 的转换报告组合根，只编排分析与输出，保持 npm test:convert 入口稳定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs')
const path = require('path')
const {
  buildSummary,
  builtInRegressionFile,
  loadConverter,
  readTestFiles,
  runRound
} = require('./conversion-report-analyzer')
const { buildJsonSummary, renderReport } = require('./conversion-report-renderer')

const ROOT_DIR = path.resolve(__dirname, '..')
const TEST_DIR = path.join(ROOT_DIR, 'test')
const REPORT_PATH = path.join(TEST_DIR, 'conversion-summary-report.html')
const JSON_PATH = path.join(TEST_DIR, 'conversion-summary-report.json')
const DEFAULT_ROUNDS = 5

function parseRounds(argv = process.argv.slice(2)) {
  const args = argv
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

function main(argv = process.argv.slice(2)) {
  const roundsToRun = parseRounds(argv)
  const { convertText, t2sCharMap } = loadConverter()
  const files = readTestFiles()
  if (!files.length) files.push(builtInRegressionFile())

  const rounds = []
  for (let index = 1; index <= roundsToRun; index += 1) {
    rounds.push(runRound(index, files, convertText, t2sCharMap))
  }

  const summary = buildSummary(files, rounds)
  fs.writeFileSync(REPORT_PATH, renderReport(summary), 'utf8')
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(buildJsonSummary(summary), null, 2)}\n`, 'utf8')

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
        secondPassDiff: final.secondPassDiff,
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
  if (!summary.allPassed) process.exitCode = 1
  return summary
}

if (require.main === module) main()

module.exports = { main, parseRounds }
