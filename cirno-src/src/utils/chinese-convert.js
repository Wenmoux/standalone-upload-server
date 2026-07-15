/**
 * [INPUT]: 依赖 opencc-js 的台湾繁体/简体与简体/台湾繁体词典，以及 Reader 传入的台湾词汇和用户词表选项
 * [OUTPUT]: 对外提供上下文安全的 convertText 双向转换函数和仅含真实残留字的冻结兜底映射
 * [POS]: cirno-src/src/utils 的繁简转换唯一事实源；OpenCC 负责主体转换，本文件只补小说语境、用户术语和罕见残留
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as OpenCCT2CN from 'opencc-js/t2cn'
import * as OpenCCCN2T from 'opencc-js/cn2t'

const openccToSimplified = OpenCCT2CN.Converter({ from: 'tw', to: 'cn' })
const openccToSimplifiedPhrases = OpenCCT2CN.Converter({ from: 'twp', to: 'cn' })
const openccToTraditional = OpenCCCN2T.Converter({ from: 'cn', to: 'tw' })
const openccSimplifiedToTw = OpenCCCN2T.Converter({ from: 'cn', to: 'tw' })

const legacyPrePhrasePairs = [
  ['軟體', '软件'],
  ['網路', '网络'],
  ['伺服器', '服务器'],
  ['用戶', '用户'],
  ['帳號', '账号'],
  ['登入', '登录'],
  ['登出', '退出'],
  ['身分', '身份'],
  ['計畫', '计划'],
  ['備註', '备注'],
  ['想像', '想象'],
  ['螢幕', '屏幕'],
  ['熒幕', '屏幕'],
  ['圖示', '图标'],
  ['介面', '界面'],
  ['滑鼠', '鼠标'],
  ['硬體', '硬件'],
  ['資訊', '信息'],
  ['訊息', '消息'],
  ['做著作業', '做着作业'],
  ['寫著作業', '写着作业'],
  ['忍著作嘔', '忍着作呕'],
  ['強忍著作嘔', '强忍着作呕'],
  ['忍受著作嘔', '忍受着作呕'],
  ['起著作用', '起着作用'],
  ['跟著作美', '跟着作美'],
  ['伏著作', '伏着作'],
  ['長阪', '长坂'],
  ['长阪', '长坂']
]

const protectedPhrasePairs = [
  ['變徵', '变徵'],
  ['变徵', '变徵'],
  ['原著', '原著'],
  ['所著', '所著'],
  ['撰著', '撰著'],
  ['論著', '论著'],
  ['论著', '论著'],
  ['遺著', '遗著'],
  ['遗著', '遗著'],
  ['編著', '编著'],
  ['編者著', '编者著'],
  ['名著', '名著'],
  ['巨著', '巨著'],
  ['專著', '专著'],
  ['譯著', '译著'],
  ['土著', '土著'],
  ['著述', '著述'],
  ['著錄', '著录'],
  ['著录', '著录'],
  ['著者', '著者']
]

const protectedPhraseRules = [
  [/(?<!配)合著/g, '合著'],
  [/(?<![背拿看讀读捧抱寫写])著書/g, '著书'],
  [/著名(?![字子諱讳單单片冊册牌號号額额聲声])/g, '著名'],
  [/著作(?![對对為为品])/g, '著作']
]

const postOpenCcPhrasePairs = [
  ['显着', '显著'],
  ['卓着', '卓著'],
  ['昭着', '昭著'],
  ['着称', '著称'],
  ['着述', '著述'],
  ['编者着', '编者著'],
  ['编着', '编著'],
  ['原着', '原著'],
  ['译着', '译著'],
  ['名着', '名著'],
  ['巨着', '巨著'],
  ['专着', '专著'],
  ['土着', '土著'],
  ['什幺', '什么'],
  ['这幺', '这么'],
  ['那幺', '那么'],
  ['怎幺', '怎么'],
  ['多幺', '多么'],
  ['要幺', '要么']
]

const s2tPrePhrasePairs = [
  ['软体', '軟體'],
  ['软件', '軟體'],
  ['网络', '網路'],
  ['服务器', '伺服器'],
  ['用户', '用戶'],
  ['账号', '帳號'],
  ['登录', '登入'],
  ['退出', '登出'],
  ['身份', '身分'],
  ['计划', '計畫'],
  ['备注', '備註'],
  ['想象', '想像'],
  ['屏幕', '螢幕'],
  ['图标', '圖示'],
  ['界面', '介面'],
  ['鼠标', '滑鼠'],
  ['硬件', '硬體'],
  ['信息', '資訊'],
  ['消息', '訊息']
]

const s2tPostPhrasePairs = [
  ['頭發', '頭髮'],
  ['理發', '理髮'],
  ['發型', '髮型'],
  ['長發', '長髮'],
  ['短發', '短髮'],
  ['白發', '白髮'],
  ['黑發', '黑髮'],
  ['銀發', '銀髮'],
  ['金發', '金髮'],
  ['卷發', '捲髮'],
  ['發絲', '髮絲'],
  ['干淨', '乾淨'],
  ['乾净', '乾淨'],
  ['干脆', '乾脆'],
  ['干杯', '乾杯'],
  ['干媽', '乾媽'],
  ['干爹', '乾爹'],
  ['乾部', '幹部'],
  ['乾活', '幹活'],
  ['乾事', '幹事'],
  ['乾線', '幹線'],
  ['骨乾', '骨幹'],
  ['樹乾', '樹幹'],
  ['主乾', '主幹'],
  ['才乾', '才幹'],
  ['能乾', '能幹'],
  ['乾掉', '幹掉'],
  ['乾擾', '干擾'],
  ['乾涉', '干涉'],
  ['皇後', '皇后'],
  ['王後', '王后'],
  ['太後', '太后'],
  ['公裡', '公里'],
  ['裡程', '里程'],
  ['鄰裡', '鄰里'],
  ['故裡', '故里'],
  ['面包', '麵包'],
  ['面條', '麵條'],
  ['拉面', '拉麵'],
  ['泡面', '泡麵'],
  ['冷面', '冷麵'],
  ['炒面', '炒麵'],
  ['時鍾', '時鐘'],
  ['鍾表', '鐘錶']
]

const t2sCharMap = Object.freeze({
  壹: '一',
  弌: '一',
  貳: '二',
  贰: '二',
  弍: '二',
  叁: '三',
  肆: '四',
  伍: '五',
  陸: '六',
  陆: '六',
  柒: '七',
  捌: '八',
  玖: '九',
  拾: '十',
  佰: '百',
  仟: '千',
  啣: '衔',
  嗹: '啭',
  妳: '你',
  媿: '愧',
  嶴: '岙',
  彞: '彝',
  慇: '殷',
  撢: '掸',
  暱: '昵',
  杴: '锨',
  濔: '沵',
  瑯: '琅',
  瞭: '了',
  籐: '藤',
  艶: '艳',
  衹: '只',
  著: '着',
  鈽: '钸',
  鎦: '镏',
  裏: '里',
  裡: '里',
  祕: '秘',
  祇: '只'
})

const s2tCharMap = Object.freeze({
  一: '壹',
  二: '貳',
  三: '叁',
  六: '陸',
  里: '裡',
  发: '發',
  干: '乾',
  钟: '鐘'
})

const particleVerbs = [
  '做',
  '寫',
  '写',
  '拿',
  '看',
  '盯',
  '瞪',
  '對',
  '对',
  '帶',
  '带',
  '把',
  '忍',
  '受',
  '起',
  '跟',
  '伏',
  '明',
  '沿',
  '就',
  '照',
  '依',
  '靠',
  '守',
  '抓',
  '握',
  '抱',
  '捧',
  '拎',
  '提',
  '舉',
  '举',
  '扛',
  '背',
  '牽',
  '牵',
  '拉',
  '推',
  '拖',
  '扯',
  '盼',
  '望',
  '指',
  '按',
  '壓',
  '压',
  '扶'
]
const particleVerbPattern = particleVerbs.map(escapeRegExp).join('|')
const particleBeforeOpenCcRegex = new RegExp(`(${particleVerbPattern})著(?=作(?:業|业|戰|战|用|為|为|對|对))`, 'g')
const postOpenCcParticleRegex = new RegExp(`(${particleVerbPattern})著(?=作(?:业|战|用|为|对))`, 'g')
const t2sFallbackRegex = new RegExp(`[${Object.keys(t2sCharMap).map(escapeRegExp).join('')}]`, 'g')

const applyLegacyPrePhrases = compilePhraseReplacer(legacyPrePhrasePairs)
const applyPostOpenCcPhrases = compilePhraseReplacer(postOpenCcPhrasePairs)
const applyS2tPrePhrases = compilePhraseReplacer(s2tPrePhrasePairs)
const applyS2tPostPhrases = compilePhraseReplacer(s2tPostPhrasePairs)

function convertTraditionalToSimplified(text, options = {}) {
  const useTwPhrases = options.twPhrases !== false
  const converter = useTwPhrases ? openccToSimplifiedPhrases : openccToSimplified
  const phrasePatched = useTwPhrases ? applyLegacyPrePhrases(text) : text
  const particlePatched = phrasePatched.replace(particleBeforeOpenCcRegex, '$1着')
  const glossaryEntries = buildGlossaryEntries(options.glossary || {}, converter)
  const protectedResult = protectConversionPhrases(particlePatched, glossaryEntries)
  const fallbackPatched = protectedResult.text.replace(t2sFallbackRegex, char => t2sCharMap[char] || char)
  const converted = converter(fallbackPatched).replace(t2sFallbackRegex, char => t2sCharMap[char] || char)
  const postPatched = applyPostOpenCcPhrases(converted.replace(postOpenCcParticleRegex, '$1着'))
  return restoreProtectedPhrases(postPatched, protectedResult)
}

function convertSimplifiedToTraditional(text) {
  return applyS2tPostPhrases(openccToTraditional(applyS2tPrePhrases(text)))
}

function buildGlossaryEntries(glossary, converter) {
  const records = typeof glossary === 'string' ? parseGlossaryText(glossary) : glossary || {}
  return Object.entries(records)
    .map(([rawSource, rawTarget]) => {
      const source = String(rawSource || '').trim()
      if (!source) return null
      const target = String(rawTarget ?? source)
      const normalizedSource = converter(source)
      return {
        sources: uniqueStrings([
          source,
          normalizedSource,
          openccSimplifiedToTw(source),
          openccSimplifiedToTw(normalizedSource)
        ]),
        target
      }
    })
    .filter(Boolean)
    .sort((a, b) => longestSource(b) - longestSource(a))
}

function parseGlossaryText(value) {
  const glossary = {}
  String(value || '')
    .split(/\r?\n/)
    .forEach(line => {
      const separator = line.indexOf('=>')
      if (separator < 0) return
      const source = line.slice(0, separator).trim()
      if (!source) return
      glossary[source] = line.slice(separator + 2).trim() || source
    })
  return glossary
}

function protectConversionPhrases(text, glossaryEntries) {
  const entries = [
    ...protectedPhrasePairs.map(([source, target]) => ({ sources: [source], target })),
    ...glossaryEntries
  ].sort((a, b) => longestSource(b) - longestSource(a))
  const replacements = new Map()
  for (const entry of entries) {
    for (const source of entry.sources) if (source && !replacements.has(source)) replacements.set(source, entry.target)
  }

  const envelope = placeholderEnvelope(text)
  const values = []
  let output = text
  const sources = [...replacements.keys()].sort((a, b) => b.length - a.length)
  if (sources.length) {
    const regex = new RegExp(sources.map(escapeRegExp).join('|'), 'g')
    output = output.replace(regex, source => envelope.token(values.push(replacements.get(source) || source) - 1))
  }
  for (const [pattern, target] of protectedPhraseRules) {
    pattern.lastIndex = 0
    output = output.replace(pattern, () => envelope.token(values.push(target) - 1))
  }
  return { text: output, values, regex: envelope.regex }
}

function placeholderEnvelope(text) {
  const pairs = [
    ['\uE000', '\uE001'],
    ['\uE100', '\uE101'],
    ['\uF000', '\uF001']
  ]
  const [open, close] = pairs.find(([left, right]) => !text.includes(left) && !text.includes(right)) || [
    '\u0002',
    '\u0003'
  ]
  return {
    token: index => `${open}${index}${close}`,
    regex: new RegExp(`${escapeRegExp(open)}(\\d+)${escapeRegExp(close)}`, 'g')
  }
}

function restoreProtectedPhrases(text, protectedResult) {
  if (!protectedResult.values.length) return text
  return text.replace(protectedResult.regex, (token, index) => protectedResult.values[Number(index)] ?? token)
}

function compilePhraseReplacer(pairs) {
  const replacements = new Map(pairs)
  const sources = [...replacements.keys()].sort((a, b) => b.length - a.length)
  if (!sources.length) return text => text
  const regex = new RegExp(sources.map(escapeRegExp).join('|'), 'g')
  return text => String(text || '').replace(regex, source => replacements.get(source) || source)
}

function longestSource(entry) {
  return Math.max(0, ...entry.sources.map(item => item.length))
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function convertText(text, mode, options = {}) {
  const input = String(text || '')
  if (!input || mode === 'none') return input
  if (mode === 'simplified') return convertTraditionalToSimplified(input, options)
  if (mode === 'traditional') return convertSimplifiedToTraditional(input)
  return input
}

export { t2sCharMap, s2tCharMap }
