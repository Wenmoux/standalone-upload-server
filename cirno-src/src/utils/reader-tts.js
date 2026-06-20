const CLOUD_TTS_ENGINES = new Set(['volcengine', 'aliyun', 'azure', 'elevenlabs', 'cartesia'])

export const CLOUD_TTS_SETTING_KEYS = [
  'ttsVolcAppId',
  'ttsVolcToken',
  'ttsVolcCluster',
  'ttsVolcVoice',
  'ttsAliApiKey',
  'ttsAliModel',
  'ttsAliVoice',
  'ttsAliInstructions',
  'ttsAzureKey',
  'ttsAzureRegion',
  'ttsAzureVoice',
  'ttsElevenKey',
  'ttsElevenVoiceId',
  'ttsElevenModel',
  'ttsCartesiaKey',
  'ttsCartesiaVoiceId',
  'ttsCartesiaModel',
  'ttsCartesiaLanguage'
]

export function isCloudTtsEngine(engine) {
  return CLOUD_TTS_ENGINES.has(String(engine || ''))
}

export function ttsChunkLimit(value, fallback = 800) {
  const parsed = Number(value || fallback)
  return Number.isFinite(parsed) ? Math.max(120, parsed) : fallback
}

function sentenceCutIndex(text, limit) {
  let cut = Math.max(
    text.lastIndexOf('。', limit),
    text.lastIndexOf('！', limit),
    text.lastIndexOf('？', limit),
    text.lastIndexOf('\n', limit)
  )
  if (cut < limit * 0.45) cut = limit
  return cut
}

function pushTextChunks(text, limit, chunks, meta, paragraphIndex) {
  let rest = String(text || '')
  while (rest.length > limit) {
    const cut = sentenceCutIndex(rest, limit)
    chunks.push(rest.slice(0, cut + 1).trim())
    if (meta) meta.push({ paragraphIndex })
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) {
    chunks.push(rest)
    if (meta) meta.push({ paragraphIndex })
  }
}

export function splitTtsText(text, chunkLength = 800) {
  const limit = ttsChunkLimit(chunkLength)
  const chunks = []
  const pieces = String(text || '')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
  for (const piece of pieces.length ? pieces : [String(text || '')]) {
    pushTextChunks(piece, limit, chunks)
  }
  return chunks
}

export function buildTtsQueueFromParagraphs(paragraphs = [], paragraphText, chunkLength = 800) {
  const limit = ttsChunkLimit(chunkLength)
  const chunks = []
  const meta = []
  ;(paragraphs || []).forEach((item, index) => {
    const text = typeof paragraphText === 'function' ? paragraphText(index, item) : item && (item.displayText || item.text)
    const rest = String(text || '').trim()
    if (!rest) return
    pushTextChunks(rest, limit, chunks, meta, index)
  })
  return { chunks, meta }
}

export function jsonEscape(value) {
  return JSON.stringify(String(value || '')).slice(1, -1)
}

export function renderTtsTemplate(template, text, settings = {}) {
  const rate = String(Number(settings.ttsRate || 1))
  const vars = {
    text: jsonEscape(text),
    jsonText: JSON.stringify(String(text || '')),
    voice: jsonEscape(settings.ttsVoice),
    jsonVoice: JSON.stringify(String(settings.ttsVoice || '')),
    rate,
    speed: rate,
    pitch: String(Number(settings.ttsPitch || 1)),
    volume: String(Number(settings.ttsVolume || 1))
  }
  return String(template || '').replace(/\{\{(text|jsonText|voice|jsonVoice|rate|speed|pitch|volume)\}\}/g, (_, key) => vars[key])
}

export function parseTtsHeaders(rawHeaders) {
  const raw = String(rawHeaders || '').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Headers 必须是 JSON 对象')
  return parsed
}

export function getByPath(data, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), data)
}

export function parseAudioFromJson(data = {}, audioPath = '') {
  const picked =
    getByPath(data, audioPath) ||
    data.audio ||
    data.audioUrl ||
    data.audio_url ||
    data.url ||
    (data.data && (data.data.audio || data.data.audioUrl || data.data.audio_url || data.data.url))
  if (!picked) throw new Error('响应 JSON 中没有找到音频字段')
  return String(picked)
}

export function audioSourceFromBase64(value, mime = 'audio/mpeg') {
  const text = String(value || '')
  if (/^data:audio\//.test(text)) return text
  return `data:${mime || 'audio/mpeg'};base64,${text}`
}

export function cloudTtsSettings(settings = {}) {
  return CLOUD_TTS_SETTING_KEYS.reduce((result, key) => {
    result[key] = settings[key]
    return result
  }, {})
}
