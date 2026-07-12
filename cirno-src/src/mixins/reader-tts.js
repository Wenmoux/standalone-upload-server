/**
 * [INPUT]: 依赖 Reader TTS 纯工具、浏览器 Speech/Audio/fetch 与 Reader 组合根的段落和设置状态
 * [OUTPUT]: 默认导出浏览器、Edge、云端及自定义 TTS 的队列、请求、播放和清理状态机
 * [POS]: cirno-src/src/mixins 的语音阅读切片，把引擎副作用与 Reader.vue 页面编排分离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  audioSourceFromBase64 as ttsAudioSourceFromBase64,
  buildTtsQueueFromParagraphs as buildReaderTtsQueue,
  cloudTtsSettings as collectCloudTtsSettings,
  isCloudTtsEngine,
  parseAudioFromJson as parseReaderTtsAudioFromJson,
  parseTtsHeaders as parseReaderTtsHeaders,
  renderTtsTemplate as renderReaderTtsTemplate,
  splitTtsText as splitReaderTtsText
} from '../utils/reader-tts'

export default {
  mounted() {
    this.loadTtsVoices()
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = this.loadTtsVoices
  },
  beforeUnmount() {
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === this.loadTtsVoices) {
      window.speechSynthesis.onvoiceschanged = null
    }
    this.stopTts()
  },
  computed: {
    ttsQuickIconClass() {
      return this.ttsPlaying || this.ttsLoading ? 'ri-volume-up-fill control-button' : 'ri-volume-up-line control-button'
    }
  },
  methods: {
    getTtsText() {
      return (this.chapterDisplayContentData || []).map(item => item.displayText || item.text).join('\n')
    },
    getTtsParagraphText(index) {
      const item = this.chapterDisplayContentData[index]
      return ((item && (item.displayText || item.text)) || '').trim()
    },
    loadTtsVoices() {
      if (!window.speechSynthesis) return
      this.availableTtsVoices = window.speechSynthesis.getVoices() || []
    },
    splitTtsText(text) {
      return splitReaderTtsText(text, this.readerSettings.ttsChunkLength)
    },
    buildTtsQueueFromParagraphs() {
      return buildReaderTtsQueue(
        this.chapterContentData,
        index => this.getTtsParagraphText(index),
        this.readerSettings.ttsChunkLength
      )
    },
    scrollTtsParagraphIntoView(index) {
      this.activeTtsParagraphIndex = Number(index)
      this.$nextTick(() => {
        const root = this.$refs.book
        const el = this.$el.querySelector(`p[data-paragraph-index="${index}"]`)
        if (!root || !el) return
        const targetTop = Math.max(0, el.offsetTop - 130)
        root.scrollTo({ top: targetTop, behavior: 'smooth' })
        if (this.containerScroll && this.containerScroll.update) this.containerScroll.update()
      })
    },
    renderTtsTemplate(template, text) {
      return renderReaderTtsTemplate(template, text, this.readerSettings)
    },
    parseTtsHeaders() {
      return parseReaderTtsHeaders(this.readerSettings.ttsApiHeaders)
    },
    parseAudioFromJson(data) {
      return parseReaderTtsAudioFromJson(data, this.readerSettings.ttsApiAudioPath)
    },
    audioSourceFromBase64(value) {
      return ttsAudioSourceFromBase64(value, this.readerSettings.ttsApiAudioMime)
    },
    async requestCustomTtsAudio(text) {
      const url = String(this.readerSettings.ttsApiUrl || '').trim()
      if (!url) throw new Error('请先填写 TTS API 地址')
      const headers = this.parseTtsHeaders()
      const body = this.renderTtsTemplate(this.readerSettings.ttsApiBody, text)
      const request = {
        method: this.readerSettings.ttsApiMethod || 'POST',
        headers,
        body
      }
      const response = this.readerSettings.ttsApiProxy
        ? await fetch('/reader-api/tts/proxy', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, responseType: this.readerSettings.ttsApiResponse, ...request })
          })
        : await fetch(url, request)
      if (!response.ok) throw new Error(`TTS API HTTP ${response.status}`)
      if (this.readerSettings.ttsApiResponse === 'audio') {
        const blob = await response.blob()
        if (!blob.size) throw new Error('TTS API 返回了空音频')
        return URL.createObjectURL(blob)
      }
      const data = await response.json()
      const audio = this.parseAudioFromJson(data)
      if (this.readerSettings.ttsApiResponse === 'json-url') {
        if (/^(https?:|blob:|data:)/i.test(audio)) return audio
        return new URL(audio, url).toString()
      }
      return this.audioSourceFromBase64(audio)
    },
    async requestEdgeTtsAudio(text) {
      const response = await fetch('/reader-api/tts/edge', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: this.readerSettings.ttsEdgeVoice,
          rate: this.readerSettings.ttsRate,
          pitch: this.readerSettings.ttsPitch,
          volume: this.readerSettings.ttsVolume
        })
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `Edge TTS HTTP ${response.status}`)
        }
        throw new Error(`Edge TTS HTTP ${response.status}`)
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('Edge TTS 返回了空音频')
      return URL.createObjectURL(blob)
    },
    cloudTtsSettings() {
      return collectCloudTtsSettings(this.readerSettings)
    },
    async requestCloudTtsAudio(text) {
      const response = await fetch('/reader-api/tts/provider', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.readerSettings.ttsEngine,
          text,
          rate: this.readerSettings.ttsRate,
          pitch: this.readerSettings.ttsPitch,
          volume: this.readerSettings.ttsVolume,
          settings: this.cloudTtsSettings()
        })
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `云 TTS HTTP ${response.status}`)
        }
        throw new Error(`云 TTS HTTP ${response.status}`)
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('云 TTS 返回了空音频')
      return URL.createObjectURL(blob)
    },
    requestQueuedTtsAudio(text) {
      if (this.readerSettings.ttsEngine === 'edge') return this.requestEdgeTtsAudio(text)
      if (isCloudTtsEngine(this.readerSettings.ttsEngine)) return this.requestCloudTtsAudio(text)
      return this.requestCustomTtsAudio(text)
    },
    prefetchQueuedTtsAudio(text) {
      return this.requestQueuedTtsAudio(text).then(
        src => ({ ok: true, src }),
        error => ({ ok: false, error })
      )
    },
    ensureTtsPrefetchWindow(startIndex = this.ttsQueueIndex) {
      if (this.ttsStopped) return
      const preload = Math.max(0, Math.min(3, Number(this.readerSettings.ttsPreloadCount || 0)))
      const start = Math.max(0, Number(startIndex || 0))
      const end = Math.min(this.ttsQueue.length - 1, start + preload)
      for (let i = start; i <= end; i++) {
        if (!this.ttsPrefetchMap[i]) this.ttsPrefetchMap[i] = this.prefetchQueuedTtsAudio(this.ttsQueue[i])
      }
    },
    async getPrefetchedTtsSource(index) {
      if (!this.ttsPrefetchMap[index]) this.ttsPrefetchMap[index] = this.prefetchQueuedTtsAudio(this.ttsQueue[index])
      const fetched = await this.ttsPrefetchMap[index]
      delete this.ttsPrefetchMap[index]
      if (!fetched || !fetched.ok) throw (fetched && fetched.error) || new Error('TTS 预加载失败')
      return fetched.src
    },
    clearTtsPrefetchMap() {
      Object.values(this.ttsPrefetchMap || {}).forEach(promise => {
        Promise.resolve(promise).then(result => {
          if (result && result.ok && result.src && result.src.startsWith('blob:')) URL.revokeObjectURL(result.src)
        })
      })
      this.ttsPrefetchMap = {}
    },
    playAudioSource(src) {
      return new Promise((resolve, reject) => {
        this.revokeTtsAudioUrl()
        this.ttsAudioUrl = src && src.startsWith('blob:') ? src : ''
        this.ttsAudio = new Audio(src)
        this.ttsAudio.volume = Number(this.readerSettings.ttsVolume || 1)
        this.ttsAudio.onended = () => resolve()
        this.ttsAudio.onerror = () => reject(new Error('音频播放失败'))
        this.ttsAudio.play().catch(reject)
      })
    },
    revokeTtsAudioUrl() {
      if (this.ttsAudioUrl) {
        URL.revokeObjectURL(this.ttsAudioUrl)
        this.ttsAudioUrl = ''
      }
    },
    async playCustomTtsQueue() {
      this.ttsLoading = true
      try {
        this.ensureTtsPrefetchWindow()
        while (!this.ttsStopped && this.ttsQueueIndex < this.ttsQueue.length) {
          const meta = this.ttsQueueMeta[this.ttsQueueIndex] || {}
          if (meta.paragraphIndex !== undefined) this.scrollTtsParagraphIntoView(meta.paragraphIndex)
          const src = await this.getPrefetchedTtsSource(this.ttsQueueIndex)
          this.ensureTtsPrefetchWindow(this.ttsQueueIndex + 1)
          this.ttsLoading = false
          this.ttsPlaying = true
          await this.playAudioSource(src)
          this.ttsQueueIndex += 1
          this.ensureTtsPrefetchWindow()
          this.ttsLoading = this.ttsQueueIndex < this.ttsQueue.length && !!this.ttsPrefetchMap[this.ttsQueueIndex]
        }
      } catch (error) {
        if (!this.ttsStopped) this.$message.error(error.message || String(error || 'TTS 播放失败'))
      } finally {
        this.ttsLoading = false
        this.ttsPlaying = false
        if (!this.ttsStopped) this.activeTtsParagraphIndex = -1
        this.clearTtsPrefetchMap()
      }
    },
    startTts() {
      this.stopTts()
      const queue = this.buildTtsQueueFromParagraphs()
      const text = queue.chunks.join('\n')
      if (!queue.chunks.length || !text.trim()) {
        this.$message.warn('当前章节没有可朗读文本')
        return
      }
      this.ttsQueueMeta = queue.meta
      if (
        this.readerSettings.ttsEngine === 'custom' ||
        this.readerSettings.ttsEngine === 'edge' ||
        isCloudTtsEngine(this.readerSettings.ttsEngine)
      ) {
        this.ttsStopped = false
        this.ttsQueue = queue.chunks
        this.ttsQueueIndex = 0
        this.playCustomTtsQueue()
        return
      }
      if (!window.speechSynthesis) {
        this.$message.error('当前浏览器不支持 TTS')
        return
      }
      this.loadTtsVoices()
      this.ttsUtterance = new SpeechSynthesisUtterance(text)
      this.ttsUtterance.lang = 'zh-CN'
      this.ttsUtterance.rate = Number(this.readerSettings.ttsRate) || 1
      this.ttsUtterance.pitch = Number(this.readerSettings.ttsPitch) || 1
      this.ttsUtterance.volume = Number(this.readerSettings.ttsVolume)
      const voice = this.availableTtsVoices.find(item => item.voiceURI === this.readerSettings.ttsVoice)
      if (voice) this.ttsUtterance.voice = voice
      this.ttsUtterance.onstart = () => {
        this.ttsPlaying = true
        this.scrollTtsParagraphIntoView(0)
      }
      this.ttsUtterance.onboundary = event => {
        if (event.name !== 'sentence' && event.name !== 'word') return
        const prefix = text.slice(0, event.charIndex || 0)
        let passed = 0
        for (let i = 0; i < this.chapterContentData.length; i++) {
          const pText = this.getTtsParagraphText(i)
          passed += this.charLength(pText) + 1
          if (prefix.length <= passed) {
            if (this.activeTtsParagraphIndex !== i) this.scrollTtsParagraphIntoView(i)
            break
          }
        }
      }
      this.ttsUtterance.onend = () => {
        this.ttsPlaying = false
        this.activeTtsParagraphIndex = -1
      }
      window.speechSynthesis.speak(this.ttsUtterance)
    },
    pauseTts() {
      if (window.speechSynthesis) window.speechSynthesis.pause()
      if (this.ttsAudio) this.ttsAudio.pause()
    },
    resumeTts() {
      if (window.speechSynthesis) window.speechSynthesis.resume()
      if (this.ttsAudio) this.ttsAudio.play().catch(() => {})
    },
    stopTts() {
      this.ttsStopped = true
      this.clearTtsPrefetchMap()
      if (window.speechSynthesis) window.speechSynthesis.cancel()
      if (this.ttsAudio) {
        this.ttsAudio.pause()
        this.ttsAudio.src = ''
        this.ttsAudio = null
      }
      this.ttsQueue = []
      this.ttsQueueMeta = []
      this.ttsQueueIndex = 0
      this.ttsLoading = false
      this.ttsPlaying = false
      this.activeTtsParagraphIndex = -1
      this.revokeTtsAudioUrl()
    },
    toggleTtsQuick() {
      if (this.ttsPlaying || this.ttsLoading) {
        this.stopTts()
        this.$message.info('朗读已停止')
      } else {
        this.startTts()
      }
    }
  }
}
