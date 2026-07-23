/**
 * [INPUT]: 依赖 Reader 组合根的章节/滚动状态、主题与正文纯工具、图片净化、浏览器存储及消息反馈
 * [OUTPUT]: 默认导出阅读设置、主题、章节头图、台湾词汇/用户词表与繁简显示重建状态机
 * [POS]: cirno-src/src/mixins 的阅读外观切片，被 Reader.vue 消费并与纠错/导航/TTS mixin 协作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import defaultCraneHeaderImage from '@/assets/reader-crane-header.png'
import defaultJianghuHeaderImage from '@/assets/reader-jianghu-top.png'
import { sanitizeImageUrl } from '../utils/sanitize-html'
import {
  convertParagraphText,
  convertRawText,
  isIhuabenChapterInfo,
  isPictureParagraph,
  normalizeParagraphLine,
  parseIhuabenHtml
} from '../utils/reader-content'
import {
  DEFAULT_READER_SETTINGS,
  EDGE_TTS_VOICES,
  READER_FONT_OPTIONS,
  READER_THEME_OPTIONS,
  cloneReaderSettings,
  normalizeReaderSettings as normalizeReaderSettingsValue
} from '../utils/reader-settings'

let chineseConverterLoader = null
const CUSTOM_HEADER_CHAPTER_REGEX =
  /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷篇话节集]/i
const CUSTOM_HEADER_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024

function isConversionMode(mode) {
  return mode === 'simplified' || mode === 'traditional'
}

function loadChineseConverter() {
  if (!chineseConverterLoader) {
    chineseConverterLoader = import('../utils/chinese-convert').then(module => module.convertText)
  }
  return chineseConverterLoader
}

export default {
  data() {
    return {
      readerSettingsVisible: false,
      readerSettings: cloneReaderSettings(),
      themeOptions: READER_THEME_OPTIONS,
      fontOptions: READER_FONT_OPTIONS,
      edgeTtsVoices: EDGE_TTS_VOICES,
      chineseConvert: null,
      conversionRequestId: 0,
      conversionSettingsTimer: null
    }
  },
  mounted() {
    this.loadReaderSettings()
  },
  watch: {
    'readerSettings.convertMode'(newValue, oldValue) {
      if (newValue === oldValue) return
      this.rebuildChapterDisplayContent()
    },
    'readerSettings.convertTwPhrases'(newValue, oldValue) {
      if (newValue === oldValue || this.readerSettings.convertMode !== 'simplified') return
      this.rebuildChapterDisplayContent()
    },
    'readerSettings.convertGlossary'(newValue, oldValue) {
      if (newValue === oldValue || this.readerSettings.convertMode !== 'simplified') return
      this.scheduleConversionRebuild(250)
    }
  },
  beforeUnmount() {
    if (this.conversionSettingsTimer) window.clearTimeout(this.conversionSettingsTimer)
    this.conversionSettingsTimer = null
  },
  computed: {
    readerSettingsDrawerWidth() {
      return window.innerWidth <= 820 ? '100vw' : 430
    },
    readerPalette() {
      return this.getReaderPalette()
    },
    readerThemeStyle() {
      const palette = this.readerPalette
      return {
        '--reader-page-bg': palette.page,
        '--reader-paper-bg': palette.paper,
        '--reader-topbar-bg': palette.topbar,
        '--reader-text-color': palette.text,
        '--reader-muted-color': palette.muted,
        '--reader-border-color': palette.border,
        '--reader-soft-bg': palette.soft,
        '--reader-control-bg': palette.control,
        '--reader-accent-color': palette.accent,
        '--reader-shadow': palette.shadow,
        '--reader-content-width': `${this.readerSettings.contentWidth}px`
      }
    },
    readerTextColor() {
      return this.readerPalette.text
    },
    readerAccentColor() {
      return this.readerPalette.accent
    },
    currentThemeLabel() {
      const theme = this.themeOptions.find(item => item.value === this.readerSettings.theme)
      return theme ? theme.label : '默认'
    },
    customChapterHeaderVisible() {
      return !!this.readerSettings.customHeaderEnabled
    },
    customHeaderImageSrc() {
      const customImage = sanitizeImageUrl(this.readerSettings.customHeaderImage)
      const builtInImage =
        this.readerSettings.chapterHeaderPreset === 'style1' ? defaultJianghuHeaderImage : defaultCraneHeaderImage
      return customImage || sanitizeImageUrl(builtInImage)
    },
    customHeaderChapterNumber() {
      const override = String(this.readerSettings.customHeaderChapterLabel || '').trim()
      if (override) return override
      const match = String(this.chapterTitle || '').match(CUSTOM_HEADER_CHAPTER_REGEX)
      if (match) return match[0].replace(/\s+/g, '')
      const index = Number(this.chapterIndex)
      return index >= 0 ? `第${index + 1}章` : '章节'
    },
    customHeaderTitleText() {
      const override = String(this.readerSettings.customHeaderTitle || '').trim()
      if (override) return override
      const title = this.chapterTitleWithoutNumber(this.chapterTitle)
      return title || this.chapterTitle || this.book_info.book_name || this.book_info.title || '正文'
    },
    customChapterHeaderStyle() {
      const padding = Math.max(20, Math.min(120, Number(this.readerSettings.pagePadding || 72)))
      if (this.readerSettings.chapterHeaderPreset === 'style1') {
        return { padding: `108px ${padding}px 18px` }
      }
      return { padding: `128px ${padding}px 28px` }
    }
  },
  methods: {
    normalizeReaderSettings(settings) {
      return normalizeReaderSettingsValue(settings, this.themeOptions)
    },
    getReaderPalette(themeValue) {
      const theme = themeValue || this.readerSettings.theme
      if (theme === 'custom') {
        return {
          page: this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customBg,
          paper: this.readerSettings.customPaper || this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customPaper,
          topbar: this.readerSettings.customPaper || DEFAULT_READER_SETTINGS.customPaper,
          text: this.readerSettings.customText || this.readerSettings.textColor || DEFAULT_READER_SETTINGS.customText,
          muted: this.readerSettings.customText || DEFAULT_READER_SETTINGS.customText,
          border: 'rgba(90, 75, 58, 0.2)',
          soft: this.readerSettings.customBg || DEFAULT_READER_SETTINGS.customBg,
          control: this.readerSettings.customPaper || DEFAULT_READER_SETTINGS.customPaper,
          accent: this.readerSettings.customAccent || DEFAULT_READER_SETTINGS.customAccent,
          shadow: '0 10px 30px rgba(0, 0, 0, 0.12)'
        }
      }
      const picked = this.themeOptions.find(item => item.value === theme) || this.themeOptions[0]
      return picked.colors
    },
    themePreviewStyle(item) {
      const palette = this.getReaderPalette(item.value)
      return {
        '--preview-page': palette.page,
        '--preview-paper': palette.paper,
        '--preview-text': palette.text,
        '--preview-accent': palette.accent
      }
    },
    chapterTitleWithoutNumber(value) {
      return String(value || '')
        .replace(CUSTOM_HEADER_CHAPTER_REGEX, '')
        .replace(/^[\s:：·.。-]+/, '')
        .replace(/[\s:：·.。-]+$/, '')
        .trim()
    },
    loadReaderSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem('cirnoReaderSettings') || '{}')
        this.readerSettings = this.normalizeReaderSettings(saved)
      } catch (e) {}
      this.applyReaderTheme()
    },
    saveReaderSettings() {
      try {
        localStorage.setItem('cirnoReaderSettings', JSON.stringify(this.readerSettings))
      } catch (e) {
        this.$message.error('阅读设置保存失败，图片可能过大')
      }
      this.applyReaderTheme()
    },
    handleCustomHeaderImageUpload(event) {
      const file = event && event.target && event.target.files && event.target.files[0]
      if (!file) return
      if (!/^image\//i.test(file.type || '')) {
        this.$message.error('请选择图片文件')
        event.target.value = ''
        return
      }
      if (file.size > CUSTOM_HEADER_IMAGE_MAX_BYTES) {
        this.$message.error('头图请控制在 1.5MB 内')
        event.target.value = ''
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        this.setReaderSetting('customHeaderImage', String(reader.result || ''))
        this.$message.success('头图已更新')
      }
      reader.onerror = () => this.$message.error('图片读取失败')
      reader.readAsDataURL(file)
      event.target.value = ''
    },
    clearCustomHeaderImage() {
      this.setReaderSetting('customHeaderImage', '')
    },
    applyReaderTheme() {
      this.$nextTick(() => this.updateReaderLayout())
    },
    isPictureParagraph(text) {
      return isPictureParagraph(text)
    },
    isIhuabenChapterInfo(info = {}) {
      return isIhuabenChapterInfo(info)
    },
    parseIhuabenHtml(html = '') {
      return parseIhuabenHtml(html)
    },
    normalizeParagraphLine(text) {
      return normalizeParagraphLine(text)
    },
    async ensureChineseConverter() {
      if (this.chineseConvert) return this.chineseConvert
      this.chineseConvert = await loadChineseConverter()
      return this.chineseConvert
    },
    convertRawText(text, converter, mode) {
      return convertRawText(text, converter, mode, isConversionMode, this.readerConversionOptions())
    },
    convertParagraphText(text, converter, mode) {
      return convertParagraphText(text, converter, mode, isConversionMode, this.readerConversionOptions())
    },
    readerConversionOptions() {
      return {
        twPhrases: this.readerSettings.convertTwPhrases,
        glossary: this.readerSettings.convertGlossary
      }
    },
    scheduleConversionRebuild(delay = 0) {
      if (this.conversionSettingsTimer) window.clearTimeout(this.conversionSettingsTimer)
      if (!delay) {
        this.conversionSettingsTimer = null
        return this.rebuildChapterDisplayContent()
      }
      this.conversionSettingsTimer = window.setTimeout(() => {
        this.conversionSettingsTimer = null
        this.rebuildChapterDisplayContent()
      }, delay)
    },
    async rebuildChapterDisplayContent() {
      const source = this.chapterContentData || []
      const mode = this.readerSettings.convertMode
      const requestId = ++this.conversionRequestId
      const converter = isConversionMode(mode) ? await this.ensureChineseConverter() : null
      if (requestId !== this.conversionRequestId) return
      source.forEach(item => {
        if (!item) return
        item.displayText =
          item.type && String(item.type).indexOf('ihuaben-') === 0
            ? this.convertRawText(item.text || '', converter, mode)
            : this.convertParagraphText(item.text, converter, mode)
      })
      this.chapterDisplayContentData = source.slice()
      this.hideCorrectionPicker()
      this.$nextTick(() => {
        if (this.loading === 1) this.updateReaderLayout()
      })
    },
    setReaderSetting(key, value) {
      this.readerSettings = this.normalizeReaderSettings(Object.assign({}, this.readerSettings, { [key]: value }))
      this.saveReaderSettings()
    },
    selectReaderTheme(theme) {
      const changes = { theme }
      if (theme === 'jianghu') {
        Object.assign(changes, {
          customHeaderEnabled: true,
          chapterHeaderPreset: 'style1',
          fontFamily: 'Noto Serif SC, Songti SC, SimSun, serif',
          paragraphIndent: 2,
          textAlign: 'justify',
          titleStyle: 'center'
        })
      }
      this.readerSettings = this.normalizeReaderSettings(Object.assign({}, this.readerSettings, changes))
      this.saveReaderSettings()
    },
    setCustomReaderSetting(key, value) {
      this.readerSettings = this.normalizeReaderSettings(
        Object.assign({}, this.readerSettings, { [key]: value, theme: 'custom' })
      )
      this.saveReaderSettings()
    },
    stepReaderSetting(key, step, min, max) {
      const current = Number(this.readerSettings[key]) || 0
      this.setReaderSetting(key, Math.min(max, Math.max(min, current + step)))
    },
    resetReaderSettings() {
      this.readerSettings = cloneReaderSettings()
      this.saveReaderSettings()
      this.$message.success('阅读设置已恢复默认')
    },
    updateReaderLayout() {
      if (this.contentDiv) this.windowSizeHandler()
      if (this.containerScroll && this.containerScroll.update) this.containerScroll.update()
    },
    openReaderSettings() {
      this.readerSettingsVisible = true
    },
    charLength(value) {
      return Array.from(String(value || '')).length
    },
    toggleConvertModeQuick() {
      const order = ['none', 'simplified', 'traditional']
      const current = order.indexOf(this.readerSettings.convertMode)
      const next = order[(current + 1) % order.length]
      this.setReaderSetting('convertMode', next)
      const label = { none: '原文', simplified: '简体', traditional: '繁体' }[next]
      this.$message.success(`繁简转换：${label}`)
    }
  }
}
