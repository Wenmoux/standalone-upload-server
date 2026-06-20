export const DEFAULT_READER_SETTINGS = {
  theme: 'default',
  fontSize: 18,
  lineHeight: 1.9,
  paragraphSpacing: 0.7,
  contentWidth: 760,
  pagePadding: 72,
  fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
  convertMode: 'none',
  titleStyle: 'classic',
  customHeaderEnabled: false,
  customHeaderImage: '',
  customHeaderChapterLabel: '',
  customHeaderTitle: '',
  paragraphIndent: 2,
  letterSpacing: 0,
  textAlign: 'left',
  fontWeight: 400,
  customBg: '#f4ead8',
  customPaper: '#fff9ed',
  customText: '#2f251d',
  customAccent: '#1b88ee',
  textColor: '#0d141e',
  ttsEngine: 'browser',
  ttsVoice: '',
  ttsEdgeVoice: 'zh-CN-XiaoxiaoNeural',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsChunkLength: 800,
  ttsPreloadCount: 1,
  ttsApiUrl: '',
  ttsApiMethod: 'POST',
  ttsApiProxy: false,
  ttsApiHeaders: '{\n  "Content-Type": "application/json"\n}',
  ttsApiBody: '{\n  "text": "{{text}}",\n  "voice": "{{voice}}",\n  "speed": {{rate}},\n  "pitch": {{pitch}},\n  "volume": {{volume}}\n}',
  ttsApiResponse: 'audio',
  ttsApiAudioPath: 'audio',
  ttsApiAudioMime: 'audio/mpeg',
  ttsVolcAppId: '',
  ttsVolcToken: '',
  ttsVolcCluster: 'volcano_tts',
  ttsVolcVoice: 'zh_female_xiaoxiao_moon_bigtts',
  ttsAliApiKey: '',
  ttsAliModel: 'qwen3-tts-flash',
  ttsAliVoice: 'Cherry',
  ttsAliInstructions: '温柔自然地朗读小说旁白',
  ttsAzureKey: '',
  ttsAzureRegion: '',
  ttsAzureVoice: 'zh-CN-XiaoxiaoNeural',
  ttsElevenKey: '',
  ttsElevenVoiceId: '',
  ttsElevenModel: 'eleven_flash_v2_5',
  ttsCartesiaKey: '',
  ttsCartesiaVoiceId: '',
  ttsCartesiaModel: 'sonic-3',
  ttsCartesiaLanguage: 'zh'
}

export const READER_THEME_OPTIONS = [
  {
    value: 'default',
    label: '默认',
    colors: {
      page: '#f6f7f9',
      paper: '#ffffff',
      topbar: 'rgba(255, 255, 255, 0.96)',
      text: '#0d141e',
      muted: '#626b78',
      border: 'rgba(33, 40, 50, 0.1)',
      soft: '#f1f3f6',
      control: '#ffffff',
      accent: '#1b88ee',
      shadow: '0 8px 32px rgba(0, 25, 104, 0.1)'
    }
  },
  {
    value: 'paper',
    label: '纸书',
    colors: {
      page: '#e7dcc9',
      paper: '#fbf3e4',
      topbar: 'rgba(251, 243, 228, 0.96)',
      text: '#2f251d',
      muted: '#7a6754',
      border: 'rgba(97, 70, 41, 0.18)',
      soft: '#efe2ce',
      control: '#fff9ed',
      accent: '#9b5d2e',
      shadow: '0 10px 30px rgba(88, 60, 30, 0.14)'
    }
  },
  {
    value: 'green',
    label: '护眼',
    colors: {
      page: '#dbe8d3',
      paper: '#edf7e8',
      topbar: 'rgba(237, 247, 232, 0.96)',
      text: '#223628',
      muted: '#5f7464',
      border: 'rgba(63, 96, 69, 0.18)',
      soft: '#dfeedd',
      control: '#f5fbf1',
      accent: '#3d8b58',
      shadow: '0 10px 30px rgba(45, 89, 55, 0.12)'
    }
  },
  {
    value: 'blue',
    label: '静蓝',
    colors: {
      page: '#dce8ef',
      paper: '#f0f7fb',
      topbar: 'rgba(240, 247, 251, 0.96)',
      text: '#22313f',
      muted: '#64798a',
      border: 'rgba(51, 87, 113, 0.16)',
      soft: '#e3f0f7',
      control: '#f8fcff',
      accent: '#417aa0',
      shadow: '0 10px 30px rgba(46, 82, 111, 0.12)'
    }
  },
  {
    value: 'dark',
    label: '夜间',
    colors: {
      page: '#111722',
      paper: '#1f2430',
      topbar: 'rgba(31, 36, 48, 0.96)',
      text: '#d8dee9',
      muted: '#9aa7b7',
      border: 'rgba(214, 224, 238, 0.12)',
      soft: '#252d3b',
      control: '#283142',
      accent: '#79a8ff',
      shadow: '0 12px 32px rgba(0, 0, 0, 0.28)'
    }
  },
  {
    value: 'black',
    label: '纯黑',
    colors: {
      page: '#000000',
      paper: '#0b0d10',
      topbar: 'rgba(11, 13, 16, 0.96)',
      text: '#d6d7d9',
      muted: '#8d949d',
      border: 'rgba(214, 215, 217, 0.13)',
      soft: '#15181d',
      control: '#15181d',
      accent: '#8ab4ff',
      shadow: '0 12px 32px rgba(0, 0, 0, 0.36)'
    }
  },
  {
    value: 'custom',
    label: '自定义',
    colors: {}
  }
]

export const READER_FONT_OPTIONS = [
  { value: 'PingFang SC, Microsoft YaHei, sans-serif', label: '系统黑体' },
  { value: 'Noto Serif SC, Songti SC, SimSun, serif', label: '宋体 / 思源宋体' },
  { value: 'LXGW WenKai, KaiTi, serif', label: '霞鹜文楷 / 楷体' },
  { value: 'Arial, PingFang SC, Microsoft YaHei, sans-serif', label: 'Arial' }
]

export const EDGE_TTS_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声 · 普通话' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声 · 普通话' },
  { value: 'zh-CN-YunjianNeural', label: '云健 · 男声 · 普通话' },
  { value: 'zh-CN-YunxiNeural', label: '云希 · 男声 · 普通话' },
  { value: 'zh-CN-YunxiaNeural', label: '云夏 · 男声 · 普通话' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 · 男声 · 普通话' },
  { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女声 · 东北' },
  { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 女声 · 陕西' },
  { value: 'zh-HK-HiuGaaiNeural', label: '曉佳 · 女声 · 粤语' },
  { value: 'zh-HK-HiuMaanNeural', label: '曉曼 · 女声 · 粤语' },
  { value: 'zh-HK-WanLungNeural', label: '雲龍 · 男声 · 粤语' },
  { value: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 女声 · 台湾' },
  { value: 'zh-TW-HsiaoYuNeural', label: '曉雨 · 女声 · 台湾' },
  { value: 'zh-TW-YunJheNeural', label: '雲哲 · 男声 · 台湾' }
]

export function cloneReaderSettings() {
  return Object.assign({}, DEFAULT_READER_SETTINGS)
}

export function clampNumber(value, min, max, fallback) {
  const num = Number(value)
  if (Number.isNaN(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

export function normalizeReaderSettings(settings, themeOptions = READER_THEME_OPTIONS) {
  const next = Object.assign(cloneReaderSettings(), settings || {})
  if (settings && settings.textColor && !settings.customText) next.customText = settings.textColor
  next.fontSize = Math.round(clampNumber(next.fontSize, 14, 32, DEFAULT_READER_SETTINGS.fontSize))
  next.lineHeight = Number(clampNumber(next.lineHeight, 1.4, 2.8, DEFAULT_READER_SETTINGS.lineHeight).toFixed(1))
  next.paragraphSpacing = Number(
    clampNumber(next.paragraphSpacing, 0.2, 1.8, DEFAULT_READER_SETTINGS.paragraphSpacing).toFixed(1)
  )
  next.contentWidth = Math.round(clampNumber(next.contentWidth, 620, 980, DEFAULT_READER_SETTINGS.contentWidth))
  next.pagePadding = Math.round(clampNumber(next.pagePadding, 28, 96, DEFAULT_READER_SETTINGS.pagePadding))
  next.paragraphIndent = Number(next.paragraphIndent) === 0 ? 0 : 2
  next.letterSpacing = Number(
    clampNumber(next.letterSpacing, 0, 2, DEFAULT_READER_SETTINGS.letterSpacing).toFixed(1)
  )
  next.fontWeight = Number(next.fontWeight) === 500 ? 500 : 400
  next.textAlign = next.textAlign === 'justify' ? 'justify' : 'left'
  next.customHeaderEnabled = !!next.customHeaderEnabled
  next.customHeaderImage = String(next.customHeaderImage || '')
  next.customHeaderChapterLabel = String(next.customHeaderChapterLabel || '').slice(0, 40)
  next.customHeaderTitle = String(next.customHeaderTitle || '').slice(0, 80)
  next.ttsEngine = ['browser', 'edge', 'volcengine', 'aliyun', 'azure', 'elevenlabs', 'cartesia', 'custom'].includes(next.ttsEngine) ? next.ttsEngine : 'browser'
  next.ttsVoice = String(next.ttsVoice || '')
  next.ttsEdgeVoice = String(next.ttsEdgeVoice || DEFAULT_READER_SETTINGS.ttsEdgeVoice)
  next.ttsRate = Number(clampNumber(next.ttsRate, 0.5, 3, DEFAULT_READER_SETTINGS.ttsRate).toFixed(2))
  next.ttsPitch = Number(clampNumber(next.ttsPitch, 0, 2, DEFAULT_READER_SETTINGS.ttsPitch).toFixed(2))
  next.ttsVolume = Number(clampNumber(next.ttsVolume, 0, 1, DEFAULT_READER_SETTINGS.ttsVolume).toFixed(2))
  next.ttsChunkLength = Math.round(clampNumber(next.ttsChunkLength, 120, 2000, DEFAULT_READER_SETTINGS.ttsChunkLength))
  next.ttsPreloadCount = Math.round(clampNumber(next.ttsPreloadCount, 0, 3, DEFAULT_READER_SETTINGS.ttsPreloadCount))
  next.ttsApiUrl = String(next.ttsApiUrl || '')
  next.ttsApiMethod = String(next.ttsApiMethod || '').toUpperCase() === 'PUT' ? 'PUT' : 'POST'
  next.ttsApiProxy = !!next.ttsApiProxy
  next.ttsApiHeaders = String(next.ttsApiHeaders || DEFAULT_READER_SETTINGS.ttsApiHeaders)
  next.ttsApiBody = String(next.ttsApiBody || DEFAULT_READER_SETTINGS.ttsApiBody)
  next.ttsApiResponse = ['audio', 'json-url', 'json-base64'].includes(next.ttsApiResponse) ? next.ttsApiResponse : 'audio'
  next.ttsApiAudioPath = String(next.ttsApiAudioPath || DEFAULT_READER_SETTINGS.ttsApiAudioPath)
  next.ttsApiAudioMime = String(next.ttsApiAudioMime || DEFAULT_READER_SETTINGS.ttsApiAudioMime)
  next.ttsVolcAppId = String(next.ttsVolcAppId || '')
  next.ttsVolcToken = String(next.ttsVolcToken || '')
  next.ttsVolcCluster = String(next.ttsVolcCluster || DEFAULT_READER_SETTINGS.ttsVolcCluster)
  next.ttsVolcVoice = String(next.ttsVolcVoice || DEFAULT_READER_SETTINGS.ttsVolcVoice)
  next.ttsAliApiKey = String(next.ttsAliApiKey || '')
  next.ttsAliModel = String(next.ttsAliModel || DEFAULT_READER_SETTINGS.ttsAliModel)
  next.ttsAliVoice = String(next.ttsAliVoice || DEFAULT_READER_SETTINGS.ttsAliVoice)
  next.ttsAliInstructions = String(next.ttsAliInstructions || DEFAULT_READER_SETTINGS.ttsAliInstructions)
  next.ttsAzureKey = String(next.ttsAzureKey || '')
  next.ttsAzureRegion = String(next.ttsAzureRegion || '')
  next.ttsAzureVoice = String(next.ttsAzureVoice || DEFAULT_READER_SETTINGS.ttsAzureVoice)
  next.ttsElevenKey = String(next.ttsElevenKey || '')
  next.ttsElevenVoiceId = String(next.ttsElevenVoiceId || '')
  next.ttsElevenModel = String(next.ttsElevenModel || DEFAULT_READER_SETTINGS.ttsElevenModel)
  next.ttsCartesiaKey = String(next.ttsCartesiaKey || '')
  next.ttsCartesiaVoiceId = String(next.ttsCartesiaVoiceId || '')
  next.ttsCartesiaModel = String(next.ttsCartesiaModel || DEFAULT_READER_SETTINGS.ttsCartesiaModel)
  next.ttsCartesiaLanguage = String(next.ttsCartesiaLanguage || DEFAULT_READER_SETTINGS.ttsCartesiaLanguage)
  if (next.theme === 'warm') next.theme = 'paper'
  if (!themeOptions.some(item => item.value === next.theme)) next.theme = DEFAULT_READER_SETTINGS.theme
  return next
}
