/**
 * [INPUT]: 依赖父级传入的 Reader 设置、主题、音色与章头状态
 * [OUTPUT]: 对外提供 ReaderSettingsPanel 的 props、语义事件和无副作用预览计算
 * [POS]: Reader settings panel 的交互控制器，把表单动作收敛为父级可处理的领域事件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export default {
  name: 'ReaderSettingsPanel',
  props: {
    readerSettings: {
      type: Object,
      default: () => ({})
    },
    readerSettingsDrawerWidth: {
      type: Number,
      default: 520
    },
    readerSettingsVisible: {
      type: Boolean,
      default: false
    },
    currentThemeLabel: {
      type: String,
      default: ''
    },
    themeOptions: {
      type: Array,
      default: () => []
    },
    fontOptions: {
      type: Array,
      default: () => []
    },
    availableTtsVoices: {
      type: Array,
      default: () => []
    },
    edgeTtsVoices: {
      type: Array,
      default: () => []
    },
    customHeaderImageSrc: {
      type: String,
      default: ''
    },
    customHeaderChapterNumber: {
      type: String,
      default: ''
    },
    customHeaderTitleText: {
      type: String,
      default: ''
    },
    ttsLoading: {
      type: Boolean,
      default: false
    }
  },
  emits: [
    'close',
    'update-setting',
    'update-custom-setting',
    'select-theme',
    'step-setting',
    'upload-header',
    'clear-header',
    'tts-action',
    'reset'
  ],
  methods: {
    setReaderSetting(key, value) {
      this.$emit('update-setting', key, value)
    },
    setCustomReaderSetting(key, value) {
      this.$emit('update-custom-setting', key, value)
    },
    selectReaderTheme(theme) {
      this.$emit('select-theme', theme)
    },
    stepReaderSetting(key, step, min, max) {
      this.$emit('step-setting', key, step, min, max)
    },
    handleCustomHeaderImageUpload(event) {
      this.$emit('upload-header', event)
    },
    clearCustomHeaderImage() {
      this.$emit('clear-header')
    },
    startTts() {
      this.$emit('tts-action', 'start')
    },
    pauseTts() {
      this.$emit('tts-action', 'pause')
    },
    resumeTts() {
      this.$emit('tts-action', 'resume')
    },
    stopTts() {
      this.$emit('tts-action', 'stop')
    },
    resetReaderSettings() {
      this.$emit('reset')
    },
    themePreviewStyle(item) {
      const fallback = {
        page: '#f4f0e8',
        paper: '#fffdf8',
        text: '#2d2a26',
        accent: '#8c5a32'
      }
      const palette =
        item && item.value === 'custom'
          ? {
              page: this.readerSettings.customBg,
              paper: this.readerSettings.customPaper,
              text: this.readerSettings.customText,
              accent: this.readerSettings.customAccent
            }
          : (item && item.colors) || fallback
      return {
        '--preview-page': palette.page || fallback.page,
        '--preview-paper': palette.paper || fallback.paper,
        '--preview-text': palette.text || fallback.text,
        '--preview-accent': palette.accent || fallback.accent
      }
    }
  }
}
